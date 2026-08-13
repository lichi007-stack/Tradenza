'use server'

import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db, strategies, trades } from '@/lib/db'
import { t } from '@/i18n'
import { uuid, uuidArray } from '@/lib/validation'
import { authedAction, mutationAction } from '@/lib/safe-action'
import { NotFoundError } from '@/lib/action-errors'
import { readGlobalSettings } from '@/lib/global-settings'
import { readGlobalFilters } from '@/lib/global-filters'
import { dayKeyInTz } from '@/lib/date-tz'
import { generalConditions } from './filter-sql'
import { computeBundle, type StatsBundle } from '@/lib/stats-compute'
import { STAT_COLUMNS, toTradeRow } from '@/lib/trade-stat-row'
import { criteriaDayOf, loadChecklistItems, toAdherenceTrade } from '@/lib/adherence-server'
import {
  adherenceReport,
  applicableItems,
  isCriteriaLocked,
  blockSummaries,
  resolveTrade,
  reviewStates,
  worstBlock,
  type AdherenceReport,
  type BlockReview,
  type ChecklistBlock,
  type ResolvedTrade,
} from '@/lib/adherence'
import { sanitizeRichTextValue } from '@/lib/rich-text'
import { cleanupOrphanedImages } from '@/lib/orphan-images'
import { r2KeyFromUrl, r2KeysFromHtml } from '@/lib/r2-keys'

export interface StrategyDTO {
  id: string
  name: string
  description: string | null
  imageUrls: string[]
  color: string
  sortOrder: number
}

// Keep only images we produced ourselves (under the R2 public base) — never store
// arbitrary client-supplied URLs. Capped at 8.
function safeImageUrls(urls: string[] | undefined): string[] {
  const base = process.env.R2_PUBLIC_URL
  if (!urls || !base) return []
  return urls.filter((u) => typeof u === 'string' && u.startsWith(base)).slice(0, 8)
}

// The playbook's criteria are not part of this form any more — they live in
// `checklist_items`, and a second text-keyed copy would be a rival source of truth.
const strategySchema = z.object({
  name: z.string().trim().min(1, t('validation.nameRequired')).max(80),
  // Rich-text HTML; large cap because the editor can embed inline (data-URL)
  // images, exactly like trade notes.
  description: z.string().trim().max(8_000_000).optional().nullable().transform(sanitizeRichTextValue),
  imageUrls: z.array(z.string().url().max(2048)).max(8).optional(),
  color: z.string().trim().max(20).default('#6366f1'),
})

export const getStrategies = authedAction([], async ({ userId }): Promise<StrategyDTO[]> => {
  const rows = await db
    .select()
    .from(strategies)
    .where(and(eq(strategies.userId, userId), isNull(strategies.archivedAt)))
    .orderBy(strategies.sortOrder, strategies.name)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    imageUrls: r.imageUrls ?? (r.imageUrl ? [r.imageUrl] : []),
    color: r.color,
    sortOrder: r.sortOrder,
  }))
})

export const createStrategy = mutationAction(
  [strategySchema],
  async ({ userId }, { name, description, imageUrls, color }) => {
    const maxRow = await db
      .select({ m: sql<number>`coalesce(max(${strategies.sortOrder}), -1)`.mapWith(Number) })
      .from(strategies)
      .where(eq(strategies.userId, userId))
    const nextOrder = (maxRow[0]?.m ?? -1) + 1

    const images = safeImageUrls(imageUrls)
    const [strategy] = await db
      .insert(strategies)
      .values({
        userId,
        name,
        description: description || null,
        imageUrls: images.length > 0 ? images : null,
        color,
        sortOrder: nextOrder,
      })
      .returning()
    revalidatePath('/strategies')
    return { success: true, strategy }
  },
)

export const updateStrategy = mutationAction(
  [uuid, strategySchema],
  async ({ userId }, id, { name, description, imageUrls, color }) => {
    const images = safeImageUrls(imageUrls)

    const previous = await db.query.strategies.findFirst({
      where: and(eq(strategies.id, id), eq(strategies.userId, userId)),
      columns: { description: true, imageUrl: true, imageUrls: true },
    })
    const previousKeys = previous
      ? [
          ...r2KeysFromHtml(previous.description),
          ...[previous.imageUrl, ...(previous.imageUrls ?? [])].flatMap((u) => {
            const key = r2KeyFromUrl(u)
            return key ? [key] : []
          }),
        ]
      : []

    const [strategy] = await db
      .update(strategies)
      .set({
        name,
        description: description || null,
        imageUrls: images.length > 0 ? images : null,
        color,
        updatedAt: new Date(),
      })
      .where(and(eq(strategies.id, id), eq(strategies.userId, userId)))
      .returning()

    await cleanupOrphanedImages(userId, previousKeys)

    revalidatePath('/strategies')
    return { success: true, strategy }
  },
)

export const deleteStrategy = mutationAction([uuid], async ({ userId }, id) => {
  // Soft-delete: archive so past trades keep their link + per-strategy history.
  // It leaves the strategies list but its stats stay computable.
  await db
    .update(strategies)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(strategies.id, id), eq(strategies.userId, userId)))
  revalidatePath('/strategies')
  return { success: true }
})

export const reorderStrategies = mutationAction([uuidArray], async ({ userId }, orderedIds) => {
  await Promise.all(
    orderedIds.map((id, i) =>
      db
        .update(strategies)
        .set({ sortOrder: i })
        .where(and(eq(strategies.id, id), eq(strategies.userId, userId))),
    ),
  )
  revalidatePath('/strategies')
  return { success: true }
})

// ─── Assignment ───────────────────────────────────────────────────────────────

const nullableStrategyId = z.string().uuid().nullable()

async function assertOwnedOrNull(userId: string, strategyId: string | null): Promise<void> {
  if (!strategyId) return
  const owned = await db.query.strategies.findFirst({
    where: and(eq(strategies.id, strategyId), eq(strategies.userId, userId)),
    columns: { id: true },
  })
  if (!owned) throw new NotFoundError(t('errors.strategy.notFound'))
}

// Assign (or clear, when null) the strategy of a single trade.
export const setTradeStrategy = mutationAction([uuid, nullableStrategyId], async ({ userId }, tradeId, strategyId) => {
  await assertOwnedOrNull(userId, strategyId)
  await db
    .update(trades)
    .set({ strategyId, updatedAt: new Date() })
    .where(and(eq(trades.id, tradeId), eq(trades.userId, userId)))
  revalidatePath('/trades')
  revalidatePath('/strategies')
  return { success: true }
})

// Bulk-assign (or clear) the strategy of many trades at once.
export const setTradesStrategy = mutationAction(
  [uuidArray, nullableStrategyId],
  async ({ userId }, ids, strategyId) => {
    if (ids.length === 0) return { success: true, count: 0 }
    await assertOwnedOrNull(userId, strategyId)
    await db
      .update(trades)
      .set({ strategyId, updatedAt: new Date() })
      .where(and(eq(trades.userId, userId), inArray(trades.id, ids)))
    revalidatePath('/trades')
    revalidatePath('/strategies')
    return { success: true, count: ids.length }
  },
)

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface StrategyOverviewRow extends StrategyDTO {
  tradeCount: number
  netPnl: number
  winRate: number
  /** The weakest of the three blocks, not their mean — labelled as such wherever shown. */
  weakestBlock: number | null
  /** Which block that was, so the cell can name it. */
  weakestBlockKey: ChecklistBlock | null
  daily: { date: string; cumulative: number }[]
}

// Every (live) strategy with its headline numbers, computed via the shared stats
// engine so they match the rest of the app. One query loads the user's closed,
// strategy-tagged trades; they're grouped and each group run through computeBundle.
// Honours the global header filter (account/date/tags/…) like the dashboard.
export const getStrategyOverview = authedAction([], async ({ userId }): Promise<StrategyOverviewRow[]> => {
  const [settings, gf] = await Promise.all([readGlobalSettings(), readGlobalFilters()])
  const filterConds = generalConditions(gf, { includeStatus: false, breakeven: settings.breakeven })

  const [list, rows, items] = await Promise.all([
    db
      .select()
      .from(strategies)
      .where(and(eq(strategies.userId, userId), isNull(strategies.archivedAt)))
      .orderBy(strategies.sortOrder, strategies.name),
    db.query.trades.findMany({
      where: and(eq(trades.userId, userId), eq(trades.status, 'closed'), isNotNull(trades.strategyId), ...filterConds),
      columns: STAT_COLUMNS,
    }),
    loadChecklistItems(userId, settings.timezone),
  ])

  // Grouped once: the headline stats and the per-block adherence are two readings of the
  // same trades and must never come from different queries.
  const grouped = new Map<string, ResolvedTrade[]>()
  for (const r of rows) {
    if (!r.strategyId) continue
    const arr = grouped.get(r.strategyId) ?? []
    arr.push(resolveTrade(toAdherenceTrade(r, settings.timezone), items))
    grouped.set(r.strategyId, arr)
  }

  return list.map((s) => {
    const group = grouped.get(s.id) ?? []
    const bundle = group.length
      ? computeBundle(
          group.map((g) => g.trade.row),
          'net',
          settings.breakeven,
        )
      : null

    const summaries = blockSummaries(group)
    const scores = {
      gate: summaries.gate.adherencePct,
      setup: summaries.setup.adherencePct,
      exit: summaries.exit.adherencePct,
    }
    const weakest = worstBlock(scores)

    const byDay = new Map<string, number>()
    for (const { trade } of group) {
      const key = (trade.row.exitDatetime ?? trade.row.entryDatetime).toISOString().slice(0, 10)
      byDay.set(key, (byDay.get(key) ?? 0) + trade.row.netPnl)
    }
    let running = 0
    const daily = [...byDay.keys()].sort().map((date) => ({ date, cumulative: (running += byDay.get(date)!) }))

    return {
      id: s.id,
      name: s.name,
      description: s.description,
      imageUrls: s.imageUrls ?? (s.imageUrl ? [s.imageUrl] : []),
      color: s.color,
      sortOrder: s.sortOrder,
      tradeCount: bundle?.totalTrades ?? 0,
      netPnl: bundle?.totalPnl ?? 0,
      winRate: bundle?.winPct ?? 0,
      weakestBlock: weakest,
      weakestBlockKey:
        weakest === null
          ? null
          : ((Object.keys(scores) as ChecklistBlock[]).find((b) => scores[b] === weakest) ?? null),
      daily,
    }
  })
})

export interface StrategyDetail {
  strategy: {
    id: string
    name: string
    description: string | null
    imageUrls: string[]
    color: string
  }
  stats: StatsBundle
  curve: { i: number; value: number }[]
  adherence: AdherenceReport
  /** The criteria in force today, so the page can show what it is measuring against. */
  criteria: { id: string; block: ChecklistBlock; label: string; definition: string | null; universal: boolean }[]
  recentTrades: {
    id: string
    symbol: string
    direction: string
    status: string
    netPnl: number | null
    entryDatetime: string
    review: BlockReview[]
    /** Its review window has closed — nothing there is outstanding. */
    reviewLocked: boolean
  }[]
}

// Full analytics for one strategy: the complete stats bundle, a cumulative net-P&L
// equity curve, and its most recent trades. Archived strategies are still viewable
// so their history isn't lost. Returns null for an unknown/other-user id (→ 404).
export const getStrategyDetail = authedAction([uuid], async ({ userId }, id): Promise<StrategyDetail | null> => {
  const row = await db.query.strategies.findFirst({
    where: and(eq(strategies.id, id), eq(strategies.userId, userId)),
    columns: { id: true, name: true, description: true, imageUrl: true, imageUrls: true, color: true },
  })
  if (!row) return null
  const strategy = {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    imageUrls: row.imageUrls ?? (row.imageUrl ? [row.imageUrl] : []),
  }

  // Honour the global header filter (account/date/tags/…) like the dashboard, so
  // the detail stats/curve/recent match whatever the user has filtered to.
  const [settings, gf] = await Promise.all([readGlobalSettings(), readGlobalFilters()])
  const filterConds = generalConditions(gf, { includeStatus: false, breakeven: settings.breakeven })

  const [closed, items] = await Promise.all([
    db.query.trades.findMany({
      where: and(eq(trades.userId, userId), eq(trades.strategyId, id), eq(trades.status, 'closed'), ...filterConds),
      columns: STAT_COLUMNS,
    }),
    loadChecklistItems(userId, settings.timezone),
  ])
  const stats = computeBundle(closed.map(toTradeRow), 'net', settings.breakeven)

  // Over the same closed trades as the stats above. Universal criteria are scored against
  // this strategy's trades on purpose — "my exit falls apart on this one setup" is exactly
  // what the model should be able to say.
  const adherenceTrades = closed.map((c) => resolveTrade(toAdherenceTrade(c, settings.timezone), items))
  const adherence = adherenceReport(adherenceTrades, 'net', settings.breakeven)

  const today = dayKeyInTz(new Date(), settings.timezone)
  const criteria = applicableItems(items, { strategyId: id, criteriaDay: today }).map((i) => ({
    id: i.id,
    block: i.block,
    label: i.label,
    definition: i.definition,
    universal: i.strategyId === null,
  }))

  // Equity curve: cumulative net P&L over closed trades in chronological order.
  // Starts at a zero baseline (index 0) so the line visually begins from 0 —
  // i.e. starting equity — instead of jumping to the first trade's P&L.
  const ordered = [...closed].sort(
    (a, b) => (a.exitDatetime ?? a.entryDatetime).getTime() - (b.exitDatetime ?? b.entryDatetime).getTime(),
  )
  let running = 0
  const curve = [
    { i: 0, value: 0 },
    ...ordered.map((r, i) => {
      running += Number(r.netPnl ?? 0)
      return { i: i + 1, value: running }
    }),
  ]

  const recent = await db.query.trades.findMany({
    where: and(eq(trades.userId, userId), eq(trades.strategyId, id), ...filterConds),
    orderBy: [desc(trades.entryDatetime)],
    limit: 20,
    columns: {
      id: true,
      symbol: true,
      direction: true,
      status: true,
      netPnl: true,
      entryDatetime: true,
      strategyId: true,
      checklistProgress: true,
      createdAt: true,
    },
  })
  const recentTrades = recent.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    direction: r.direction,
    status: r.status,
    netPnl: r.netPnl != null ? Number(r.netPnl) : null,
    entryDatetime: r.entryDatetime.toISOString(),
    review: reviewStates(
      {
        strategyId: r.strategyId,
        criteriaDay: criteriaDayOf(r, settings.timezone),
        progress: r.checklistProgress,
      },
      items,
    ),
    reviewLocked: isCriteriaLocked(r.createdAt),
  }))

  return { strategy, stats, curve, adherence, criteria, recentTrades }
})
