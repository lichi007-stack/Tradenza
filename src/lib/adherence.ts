import { computeBundle, type TradeRow, type PlType } from '@/lib/stats-compute'
import type { BreakevenConfig } from '@/lib/breakeven'

/**
 * How faithfully a trade followed the plan, in three blocks (gate / setup / exit) that are
 * never averaged — one figure can't say whether you broke risk rules, misread the setup or
 * fumbled the exit. Two invariants: an unassessed block scores `null`, never 0, and every
 * aggregate reports its coverage.
 *
 * Pure: day keys and `TradeRow`s are resolved by the caller.
 */

// ─── Blocks & items ───────────────────────────────────────────────────────────

export type ChecklistBlock = 'gate' | 'setup' | 'exit'

/** Decision timeline: before → at → after entry. */
export const CHECKLIST_BLOCKS: readonly ChecklistBlock[] = ['gate', 'setup', 'exit']

/** One criterion, projected out of `checklist_items` onto day keys. */
export interface ChecklistItem {
  id: string
  /** null → applies to every strategy. */
  strategyId: string | null
  block: ChecklistBlock
  label: string
  definition: string | null
  sortOrder: number
  /** Inclusive first day, 'yyyy-MM-dd' in the user's timezone. */
  effectiveFrom: string
  /** Exclusive last day (the day archiving took effect). null = live. */
  archivedDay: string | null
}

// ─── The review window ────────────────────────────────────────────────────────

/**
 * How long after a trade is RECORDED its checklist stays open.
 *
 * The clock runs from when the trade entered the journal, not from when it was taken, so a
 * trade logged today is measured against today's criteria however old its entry date —
 * which is also what makes backtest runs work. While the window is open, edits to the
 * criteria still reach the trade; once it closes nothing about the review can change.
 * Because the lock is derived from the recording time, nothing has to be snapshotted.
 */
export const CRITERIA_WINDOW_HOURS = 24

const WINDOW_MS = CRITERIA_WINDOW_HOURS * 60 * 60 * 1000

/** The moment a trade's checklist freezes. */
export const criteriaLockAt = (recordedAt: Date, now: Date = new Date()): Date =>
  new Date(Math.min(now.getTime(), recordedAt.getTime() + WINDOW_MS))

export const isCriteriaLocked = (recordedAt: Date, now: Date = new Date()): boolean =>
  now.getTime() >= recordedAt.getTime() + WINDOW_MS

/** Milliseconds left before the window shuts, or 0 once it has. */
export const criteriaWindowLeft = (recordedAt: Date, now: Date = new Date()): number =>
  Math.max(0, recordedAt.getTime() + WINDOW_MS - now.getTime())

// ─── Trades ───────────────────────────────────────────────────────────────────

/** A trade as the adherence engine sees it. */
export interface AdherenceTrade {
  /** Stats projection, so outcome splits use the same engine as the rest of the app. */
  row: TradeRow
  strategyId: string | null
  /** Entry day key in the user's timezone — chronology (ordering, trend). */
  entryDay: string
  /** Day whose checklist judges this trade: when the window closed, or today if still open. */
  criteriaDay: string
  locked: boolean
  progress: ChecklistProgress | null
}

type CriteriaScope = Pick<AdherenceTrade, 'strategyId' | 'criteriaDay'>

// ─── Stored progress ──────────────────────────────────────────────────────────

/** Legacy shape: ticked criteria keyed by text. Still read, never written. */
export interface ChecklistProgressV1 {
  v?: undefined
  entry: string[]
  exit: string[]
}

export interface BlockProgress {
  /** Until the user confirms the block, it contributes to nothing. */
  scored: boolean
  /** Ids of the items that were met. Unmet = applicable items minus these, once scored. */
  met: string[]
  scoredAt: string | null
}

export interface ChecklistProgressV2 {
  v: 2
  blocks: Record<ChecklistBlock, BlockProgress>
}

export type ChecklistProgress = ChecklistProgressV1 | ChecklistProgressV2

const emptyBlock = (): BlockProgress => ({ scored: false, met: [], scoredAt: null })

export const emptyProgress = (): ChecklistProgressV2 => ({
  v: 2,
  blocks: { gate: emptyBlock(), setup: emptyBlock(), exit: emptyBlock() },
})

/**
 * Read any stored shape as v2. v1 text is matched to ids inside its own block (`entry` →
 * setup); those two blocks count as scored, `gate` doesn't because it didn't exist then.
 *
 * `items` must be the criteria applicable to the trade (see {@link tradeProgress}), not
 * every criterion the user has — identical wording under two setups must not cross over.
 */
export function normalizeProgress(
  raw: ChecklistProgress | null | undefined,
  items: ChecklistItem[],
): ChecklistProgressV2 {
  if (!raw) return emptyProgress()

  if (raw.v === 2) {
    const blocks = { ...emptyProgress().blocks }
    for (const block of CHECKLIST_BLOCKS) {
      const b = raw.blocks?.[block]
      if (b) blocks[block] = { scored: !!b.scored, met: b.met ?? [], scoredAt: b.scoredAt ?? null }
    }
    return { v: 2, blocks }
  }

  const idsFor = (block: ChecklistBlock, texts: string[] | undefined): string[] => {
    if (!texts?.length) return []
    const byLabel = new Map(items.filter((i) => i.block === block).map((i) => [i.label, i.id]))
    return texts.flatMap((text) => {
      const id = byLabel.get(text)
      return id ? [id] : []
    })
  }

  return {
    v: 2,
    blocks: {
      gate: emptyBlock(),
      setup: { scored: true, met: idsFor('setup', raw.entry), scoredAt: null },
      exit: { scored: true, met: idsFor('exit', raw.exit), scoredAt: null },
    },
  }
}

// ─── Applicability ────────────────────────────────────────────────────────────

/**
 * Items a single trade is measured against: live on its criteria day, and either universal
 * or belonging to its strategy.
 *
 * A trade with no strategy matches nothing, not even the universal blocks — scoring two of
 * three blocks would average a different measurement into the same figure.
 */
export function applicableItems(items: ChecklistItem[], trade: CriteriaScope): ChecklistItem[] {
  if (trade.strategyId === null) return []
  return items
    .filter(
      (i) =>
        i.effectiveFrom <= trade.criteriaDay &&
        (i.archivedDay === null || i.archivedDay > trade.criteriaDay) &&
        (i.strategyId === null || i.strategyId === trade.strategyId),
    )
    .sort(compareItems)
}

/**
 * Criteria live today but effective after this trade — shown, never scored, so that a
 * criterion added since doesn't just look like it went missing.
 */
export function pendingItems(items: ChecklistItem[], trade: CriteriaScope): ChecklistItem[] {
  if (trade.strategyId === null) return []
  return items
    .filter(
      (i) =>
        i.effectiveFrom > trade.criteriaDay &&
        i.archivedDay === null &&
        (i.strategyId === null || i.strategyId === trade.strategyId),
    )
    .sort(compareItems)
}

export function applicableInBlock(
  items: ChecklistItem[],
  trade: CriteriaScope,
  block: ChecklistBlock,
): ChecklistItem[] {
  return applicableItems(items, trade).filter((i) => i.block === block)
}

export function compareItems(a: ChecklistItem, b: ChecklistItem): number {
  const byBlock = CHECKLIST_BLOCKS.indexOf(a.block) - CHECKLIST_BLOCKS.indexOf(b.block)
  if (byBlock !== 0) return byBlock
  // Universal items lead their block.
  if ((a.strategyId === null) !== (b.strategyId === null)) return a.strategyId === null ? -1 : 1
  return a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
}

/** Stored progress read against the criteria that actually applied to the trade. */
export function tradeProgress(
  trade: CriteriaScope & Pick<AdherenceTrade, 'progress'>,
  items: ChecklistItem[],
): ChecklistProgressV2 {
  return normalizeProgress(trade.progress, applicableItems(items, trade))
}

export function groupByBlock(items: ChecklistItem[]): Record<ChecklistBlock, ChecklistItem[]> {
  return {
    gate: items.filter((i) => i.block === 'gate'),
    setup: items.filter((i) => i.block === 'setup'),
    exit: items.filter((i) => i.block === 'exit'),
  }
}

// ─── Resolution ───────────────────────────────────────────────────────────────

/**
 * A trade with its applicable criteria and normalised progress worked out once. Every
 * aggregate below needs both, and each resolution walks the whole criteria list — doing it
 * per aggregate would repeat that work five or six times over.
 */
export interface ResolvedTrade {
  trade: AdherenceTrade
  /** Applicable items of each block, in display order. */
  items: Record<ChecklistBlock, ChecklistItem[]>
  progress: ChecklistProgressV2
  met: Record<ChecklistBlock, Set<string>>
}

export function resolveTrade(trade: AdherenceTrade, items: ChecklistItem[]): ResolvedTrade {
  const applicable = applicableItems(items, trade)
  const progress = normalizeProgress(trade.progress, applicable)
  const byBlock = groupByBlock(applicable)
  return {
    trade,
    items: byBlock,
    progress,
    met: {
      gate: new Set(progress.blocks.gate.met),
      setup: new Set(progress.blocks.setup.met),
      exit: new Set(progress.blocks.exit.met),
    },
  }
}

export const resolveTrades = (trades: AdherenceTrade[], items: ChecklistItem[]): ResolvedTrade[] =>
  trades.map((trade) => resolveTrade(trade, items))

function resolvedBlockScore(r: ResolvedTrade, block: ChecklistBlock): number | null {
  const applicable = r.items[block]
  if (applicable.length === 0) return null
  if (!r.progress.blocks[block].scored) return null
  return (applicable.filter((i) => r.met[block].has(i.id)).length / applicable.length) * 100
}

// ─── Per-trade scores ─────────────────────────────────────────────────────────

export type BlockScores = Record<ChecklistBlock, number | null>

/**
 * Share (0–100) of the block's applicable items this trade met, or `null` when the block
 * wasn't assessed or had no items that day — never 0 for "unknown".
 */
export function blockScore(trade: AdherenceTrade, items: ChecklistItem[], block: ChecklistBlock): number | null {
  const applicable = applicableInBlock(items, trade, block)
  if (applicable.length === 0) return null
  const state = tradeProgress(trade, items).blocks[block]
  if (!state.scored) return null
  const met = new Set(state.met)
  return (applicable.filter((i) => met.has(i.id)).length / applicable.length) * 100
}

export interface BlockReview {
  block: ChecklistBlock
  applicable: boolean
  reviewed: boolean
  met: number
  total: number
}

/** What a trade list needs: reviewed / still to review, without a score. */
export function reviewStates(
  trade: CriteriaScope & Pick<AdherenceTrade, 'progress'>,
  items: ChecklistItem[],
): BlockReview[] {
  const progress = tradeProgress(trade, items)
  return CHECKLIST_BLOCKS.map((block) => {
    const applicable = applicableInBlock(items, trade, block)
    const state = progress.blocks[block]
    const met = new Set(state.met)
    return {
      block,
      applicable: applicable.length > 0,
      reviewed: state.scored,
      met: applicable.filter((i) => met.has(i.id)).length,
      total: applicable.length,
    }
  })
}

/** The single value a column may show: the worst block, never the mean. */
export function worstBlock(scores: BlockScores): number | null {
  const present = CHECKLIST_BLOCKS.map((b) => scores[b]).filter((v): v is number => v !== null)
  return present.length === 0 ? null : Math.min(...present)
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

export const LABEL_MAX = 140
export const DEFINITION_MAX = 500

export const ADHERENCE_TARGET = 85

/** Minimum trades on each side before a followed-vs-skipped split is shown. */
export const MIN_SAMPLE = 10

/** Scored trades a block needs before its per-item numbers are shown. */
export const ITEM_STATS_MIN_SAMPLE = 20

/** Trades before "your playbook may be the problem" may be said at all. */
export const PLAYBOOK_MIN_SAMPLE = 50

export const MISSED_MIN_SAMPLE = 5

// ─── Aggregates ───────────────────────────────────────────────────────────────

export interface ItemPerformance {
  itemId: string
  label: string
  definition: string | null
  block: ChecklistBlock
  strategyId: string | null
  followed: number
  /** Scored trades this item applied to — the item's own denominator. */
  total: number
  followedPct: number
  winRateFollowed: number | null
  winRateMissed: number | null
  avgPnlFollowed: number | null
  avgPnlMissed: number | null
  /** Both sides ≥ MIN_SAMPLE and the two win rates' Wilson intervals don't overlap. */
  separated: boolean
}

export interface BlockAnalytics {
  block: ChecklistBlock
  /** Mean of the per-trade block scores over the trades that were assessed. */
  adherencePct: number | null
  /** Coverage: assessed trades out of the trades the block applied to. */
  scoredTrades: number
  applicableTrades: number
  items: ItemPerformance[]
  itemStatsReady: boolean
}

function splitStats(rows: TradeRow[], mode: PlType, cfg: BreakevenConfig | null) {
  if (rows.length === 0) return { winRate: null, avgPnl: null, wins: 0 }
  const b = computeBundle(rows, mode, cfg)
  return { winRate: b.winPct, avgPnl: b.avgTradePnl, wins: b.winningTrades }
}

/**
 * One block over a set of trades: adherence, coverage, and each item's followed-vs-skipped
 * outcome split.
 */
export function blockAnalytics(
  trades: ResolvedTrade[],
  block: ChecklistBlock,
  mode: PlType,
  cfg: BreakevenConfig | null,
): BlockAnalytics {
  let applicableTrades = 0
  let scoreSum = 0
  const scored: { trade: AdherenceTrade; met: Set<string>; applicable: ChecklistItem[] }[] = []

  for (const r of trades) {
    const applicable = r.items[block]
    if (applicable.length === 0) continue
    applicableTrades++
    if (!r.progress.blocks[block].scored) continue
    const met = r.met[block]
    scoreSum += (applicable.filter((i) => met.has(i.id)).length / applicable.length) * 100
    scored.push({ trade: r.trade, met, applicable })
  }

  // One row per item any assessed trade was measured against.
  const seen = new Map<string, ChecklistItem>()
  for (const s of scored) for (const i of s.applicable) seen.set(i.id, i)

  const itemPerf = [...seen.values()].sort(compareItems).map<ItemPerformance>((item) => {
    const followedRows: TradeRow[] = []
    const missedRows: TradeRow[] = []
    for (const s of scored) {
      if (!s.applicable.some((i) => i.id === item.id)) continue
      ;(s.met.has(item.id) ? followedRows : missedRows).push(s.trade.row)
    }
    const f = splitStats(followedRows, mode, cfg)
    const m = splitStats(missedRows, mode, cfg)
    const total = followedRows.length + missedRows.length
    return {
      itemId: item.id,
      label: item.label,
      definition: item.definition,
      block: item.block,
      strategyId: item.strategyId,
      followed: followedRows.length,
      total,
      followedPct: total > 0 ? (followedRows.length / total) * 100 : 0,
      winRateFollowed: f.winRate,
      winRateMissed: m.winRate,
      avgPnlFollowed: f.avgPnl,
      avgPnlMissed: m.avgPnl,
      separated:
        followedRows.length >= MIN_SAMPLE &&
        missedRows.length >= MIN_SAMPLE &&
        !intervalsOverlap(wilsonInterval(f.wins, followedRows.length), wilsonInterval(m.wins, missedRows.length)),
    }
  })

  return {
    block,
    adherencePct: scored.length > 0 ? scoreSum / scored.length : null,
    scoredTrades: scored.length,
    applicableTrades,
    items: itemPerf,
    itemStatsReady: scored.length >= ITEM_STATS_MIN_SAMPLE,
  }
}

/** Adherence + coverage for all three blocks, without the per-item work. */
export function blockSummaries(trades: ResolvedTrade[]): Record<ChecklistBlock, BlockSummary> {
  const out = {} as Record<ChecklistBlock, BlockSummary>
  for (const block of CHECKLIST_BLOCKS) {
    let applicable = 0
    let scored = 0
    let sum = 0
    for (const r of trades) {
      if (r.items[block].length === 0) continue
      applicable++
      const value = resolvedBlockScore(r, block)
      if (value === null) continue
      scored++
      sum += value
    }
    out[block] = {
      block,
      adherencePct: scored > 0 ? sum / scored : null,
      scoredTrades: scored,
      applicableTrades: applicable,
    }
  }
  return out
}

export interface BlockSummary {
  block: ChecklistBlock
  adherencePct: number | null
  scoredTrades: number
  applicableTrades: number
}

export interface MissedItem {
  itemId: string
  label: string
  block: ChecklistBlock
  strategyId: string | null
  missed: number
  total: number
  missedPct: number
}

export function mostMissedItems(trades: ResolvedTrade[], limit = 8): MissedItem[] {
  const tally = new Map<string, { item: ChecklistItem; missed: number; total: number }>()
  for (const r of trades) {
    for (const block of CHECKLIST_BLOCKS) {
      if (!r.progress.blocks[block].scored) continue
      for (const item of r.items[block]) {
        const entry = tally.get(item.id) ?? { item, missed: 0, total: 0 }
        entry.total++
        if (!r.met[block].has(item.id)) entry.missed++
        tally.set(item.id, entry)
      }
    }
  }
  return [...tally.values()]
    .filter((e) => e.missed > 0 && e.total >= MISSED_MIN_SAMPLE)
    .map(({ item, missed, total }) => ({
      itemId: item.id,
      label: item.label,
      block: item.block,
      strategyId: item.strategyId,
      missed,
      total,
      missedPct: (missed / total) * 100,
    }))
    .sort((a, b) => b.missed - a.missed || b.missedPct - a.missedPct)
    .slice(0, limit)
}

// ─── Trend ────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  /** First day in the bucket, 'yyyy-MM-dd'. */
  date: string
  /** Last day in the bucket — equal to `date` while one point is one day. */
  endDate: string
  gate: number | null
  setup: number | null
  exit: number | null
  /** Reviewed trades behind each mean. */
  samples: Record<ChecklistBlock, number>
}

export interface AdherenceTrend {
  points: TrendPoint[]
  /** Days folded into one point. 1 until the range is long enough to need more. */
  bucketDays: number
}

/** Most points a trend may draw before it reads as noise rather than drift. */
export const TREND_MAX_POINTS = 60

/** Steps people think in. An arbitrary "every 9 days" is unreadable on the axis. */
const BUCKET_STEPS = [1, 2, 3, 7, 14, 30] as const

/** The smallest step that keeps the range under {@link TREND_MAX_POINTS}. */
export function trendBucketDays(spanDays: number, maxPoints = TREND_MAX_POINTS): number {
  return BUCKET_STEPS.find((step) => Math.ceil(spanDays / step) <= maxPoints) ?? Math.ceil(spanDays / maxPoints)
}

const DAY_MS = 86_400_000
// Day keys are already resolved in the user's timezone, so UTC midnight is exact here.
const dayToMs = (day: string): number => Date.parse(`${day}T00:00:00Z`)
const msToDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/**
 * Adherence by calendar day: one point per day that had a reviewed trade, averaged per
 * block. Days rather than trades because drift is asked about over weeks, and averaging
 * within the day damps single-trade spikes.
 *
 * Past {@link TREND_MAX_POINTS} days the points fold into equal steps. A bucket averages
 * the trades inside it, not the day means — otherwise a one-trade Tuesday would outvote a
 * twelve-trade Wednesday. Days with nothing reviewed emit no point, so the series is the
 * days you traded, in order.
 */
export function adherenceTrend(trades: ResolvedTrade[], maxPoints = TREND_MAX_POINTS): AdherenceTrend {
  type Bucket = { sum: Record<ChecklistBlock, number>; n: Record<ChecklistBlock, number> }
  const reviewed: { day: string; scores: BlockScores }[] = []

  for (const r of trades) {
    const scores: BlockScores = {
      gate: resolvedBlockScore(r, 'gate'),
      setup: resolvedBlockScore(r, 'setup'),
      exit: resolvedBlockScore(r, 'exit'),
    }
    if (CHECKLIST_BLOCKS.every((b) => scores[b] === null)) continue
    reviewed.push({ day: r.trade.entryDay, scores })
  }
  if (reviewed.length === 0) return { points: [], bucketDays: 1 }

  const days = reviewed.map((r) => dayToMs(r.day))
  const first = Math.min(...days)
  const last = Math.max(...days)
  const bucketDays = trendBucketDays(Math.floor((last - first) / DAY_MS) + 1, maxPoints)

  const buckets = new Map<number, Bucket>()
  for (const { day, scores } of reviewed) {
    const index = Math.floor((dayToMs(day) - first) / DAY_MS / bucketDays)
    const bucket = buckets.get(index) ?? { sum: { gate: 0, setup: 0, exit: 0 }, n: { gate: 0, setup: 0, exit: 0 } }
    for (const block of CHECKLIST_BLOCKS) {
      const value = scores[block]
      if (value === null) continue
      bucket.sum[block] += value
      bucket.n[block] += 1
    }
    buckets.set(index, bucket)
  }

  const points = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, bucket]): TrendPoint => {
      const startMs = first + index * bucketDays * DAY_MS
      const mean = (block: ChecklistBlock) => (bucket.n[block] === 0 ? null : bucket.sum[block] / bucket.n[block])
      return {
        date: msToDay(startMs),
        endDate: msToDay(Math.min(startMs + (bucketDays - 1) * DAY_MS, last)),
        gate: mean('gate'),
        setup: mean('setup'),
        exit: mean('exit'),
        samples: { ...bucket.n },
      }
    })

  return { points, bucketDays }
}

// ─── Verdict ──────────────────────────────────────────────────────────────────

export type AdherenceVerdict =
  | { kind: 'noData' }
  /** A block below target, on a sample worth acting on. */
  | { kind: 'gate'; pct: number; trades: number }
  | { kind: 'setup'; pct: number; trades: number }
  | { kind: 'exit'; pct: number; trades: number }
  /** Below target, but on too few reviews to name it as the problem. */
  | { kind: 'thin'; block: ChecklistBlock; pct: number; trades: number; remaining: number }
  | { kind: 'playbook'; trades: number }
  | { kind: 'smallSample'; remaining: number }
  | { kind: 'clean' }

/**
 * Reviewed trades a block needs before the verdict may blame it. Without it the precedence
 * order is a trap: a gate reviewed once at 22% would out-shout a setup measured over twenty.
 */
export const VERDICT_MIN_SAMPLE = 10

/**
 * One sentence about what to work on, in strict precedence: gate, setup, exit, then the
 * playbook. The order is the point — break your own gate and the exit statistics describe
 * trades that should never have existed.
 */
export function diagnose(
  blocks: Record<ChecklistBlock, { pct: number | null; scoredTrades: number }>,
  sample: { trades: number; expectancy: number | null },
  target = ADHERENCE_TARGET,
): AdherenceVerdict {
  const below = (b: ChecklistBlock) => blocks[b].pct !== null && (blocks[b].pct as number) < target
  if (CHECKLIST_BLOCKS.every((b) => blocks[b].pct === null)) return { kind: 'noData' }

  // Blame the earliest failing block we can actually measure.
  for (const block of CHECKLIST_BLOCKS) {
    if (below(block) && blocks[block].scoredTrades >= VERDICT_MIN_SAMPLE) {
      return { kind: block, pct: blocks[block].pct as number, trades: blocks[block].scoredTrades }
    }
  }
  // Failing, but not measured well enough to name it. Say so, and name where to review.
  for (const block of CHECKLIST_BLOCKS) {
    if (below(block)) {
      const trades = blocks[block].scoredTrades
      return {
        kind: 'thin',
        block,
        pct: blocks[block].pct as number,
        trades,
        remaining: VERDICT_MIN_SAMPLE - trades,
      }
    }
  }

  if (sample.expectancy !== null && sample.expectancy < 0) {
    return sample.trades >= PLAYBOOK_MIN_SAMPLE
      ? { kind: 'playbook', trades: sample.trades }
      : { kind: 'smallSample', remaining: PLAYBOOK_MIN_SAMPLE - sample.trades }
  }
  return { kind: 'clean' }
}

// ─── Report ───────────────────────────────────────────────────────────────────

export interface AdherenceReport {
  /** One entry per block, in decision order — never merged into a single figure. */
  blocks: BlockAnalytics[]
  verdict: AdherenceVerdict
  trades: number
}

/** Everything one surface needs in one pass, so no two pages can disagree. */
export function adherenceReport(trades: ResolvedTrade[], mode: PlType, cfg: BreakevenConfig | null): AdherenceReport {
  const blocks = CHECKLIST_BLOCKS.map((block) => blockAnalytics(trades, block, mode, cfg))
  const scores = {
    gate: { pct: blocks[0].adherencePct, scoredTrades: blocks[0].scoredTrades },
    setup: { pct: blocks[1].adherencePct, scoredTrades: blocks[1].scoredTrades },
    exit: { pct: blocks[2].adherencePct, scoredTrades: blocks[2].scoredTrades },
  }
  return {
    blocks,
    verdict: diagnose(scores, { trades: trades.length, expectancy: expectancyOf(trades) }),
    trades: trades.length,
  }
}

/** Average P&L per trade. Only its sign matters to {@link diagnose}. */
export function expectancyOf(trades: ResolvedTrade[]): number | null {
  if (trades.length === 0) return null
  return trades.reduce((sum, r) => sum + r.trade.row.netPnl, 0) / trades.length
}

// ─── Statistics helpers ───────────────────────────────────────────────────────

/** Wilson interval — stays sane at journal-sized samples, unlike the normal approximation. */
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null
  const p = successes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const spread = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)]
}

/** A missing interval counts as overlapping (unknown). */
export function intervalsOverlap(a: [number, number] | null, b: [number, number] | null): boolean {
  if (!a || !b) return true
  return a[0] <= b[1] && b[0] <= a[1]
}
