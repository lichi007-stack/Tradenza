import { and, eq } from 'drizzle-orm'
import { db, checklistItems, trades } from '@/lib/db'
import { dayKeyInTz } from '@/lib/date-tz'
import { readGlobalSettings } from '@/lib/global-settings'
import { readGlobalFilters } from '@/lib/global-filters'
import { generalConditions } from '@/lib/actions/filter-sql'
import { STAT_COLUMNS, toTradeRow, type StatTradeRow } from '@/lib/trade-stat-row'
import { criteriaLockAt, isCriteriaLocked, type AdherenceTrade, type ChecklistItem } from '@/lib/adherence'

// Database side of adherence: loads criteria and trades and projects both onto the day
// keys `lib/adherence` reasons in. Separate from the actions module because several
// surfaces share these loaders and a 'use server' file may only export async functions.

const toItem =
  (tz: string | null) =>
  (r: typeof checklistItems.$inferSelect): ChecklistItem => ({
    id: r.id,
    strategyId: r.strategyId,
    block: r.block,
    label: r.label,
    definition: r.definition,
    sortOrder: r.sortOrder,
    effectiveFrom: r.effectiveFrom,
    archivedDay: r.archivedAt ? dayKeyInTz(r.archivedAt, tz) : null,
  })

/** Every criterion the user has ever had, archived included — history is scored against
 *  the criteria that were live at the time. */
export async function loadChecklistItems(userId: string, tz: string | null): Promise<ChecklistItem[]> {
  const rows = await db.select().from(checklistItems).where(eq(checklistItems.userId, userId))
  return rows.map(toItem(tz))
}

/** The day a trade's checklist is resolved against — see `AdherenceTrade.criteriaDay`. */
export function criteriaDayOf(trade: { createdAt: Date }, tz: string | null): string {
  return dayKeyInTz(criteriaLockAt(trade.createdAt), tz)
}

export function toAdherenceTrade(r: StatTradeRow, tz: string | null): AdherenceTrade {
  return {
    row: toTradeRow(r),
    strategyId: r.strategyId,
    entryDay: dayKeyInTz(r.entryDatetime, tz),
    criteriaDay: criteriaDayOf(r, tz),
    locked: isCriteriaLocked(r.createdAt),
    progress: r.checklistProgress ?? null,
  }
}

/** Closed trades, honouring the global header filter exactly like the dashboard does. */
export async function loadAdherenceTrades(
  userId: string,
  opts: { strategyId?: string } = {},
): Promise<AdherenceTrade[]> {
  const [settings, gf] = await Promise.all([readGlobalSettings(), readGlobalFilters()])
  const rows = await db.query.trades.findMany({
    where: and(
      eq(trades.userId, userId),
      eq(trades.status, 'closed'),
      ...(opts.strategyId ? [eq(trades.strategyId, opts.strategyId)] : []),
      ...generalConditions(gf, { includeStatus: false, breakeven: settings.breakeven }),
    ),
    columns: STAT_COLUMNS,
  })
  return rows.map((r) => toAdherenceTrade(r, settings.timezone))
}
