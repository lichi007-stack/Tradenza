import { describe, it, expect } from 'vitest'
import {
  applicableItems,
  blockAnalytics,
  blockScore,
  blockSummaries,
  diagnose,
  emptyProgress,
  intervalsOverlap,
  mostMissedItems,
  criteriaLockAt,
  criteriaWindowLeft,
  isCriteriaLocked,
  normalizeProgress,
  pendingItems,
  CRITERIA_WINDOW_HOURS,
  resolveTrade,
  resolveTrades,
  reviewStates,
  adherenceTrend,
  trendBucketDays,
  tradeProgress,
  wilsonInterval,
  worstBlock,
  type AdherenceTrade,
  type ChecklistBlock,
  type ChecklistItem,
  type ChecklistProgress,
} from './adherence'
import type { TradeRow } from './stats-compute'

function row(netPnl: number, day = '2026-03-02'): TradeRow {
  return {
    netPnl,
    grossPnl: netPnl,
    fees: 0,
    direction: 'long',
    entryDatetime: new Date(`${day}T10:00:00Z`),
    exitDatetime: new Date(`${day}T11:00:00Z`),
    riskAmount: null,
    riskRewardRatio: null,
    hasNotes: false,
    notional: null,
  }
}

let seq = 0
function item(partial: Partial<ChecklistItem> & { block: ChecklistBlock; label: string }): ChecklistItem {
  return {
    id: partial.id ?? `item-${++seq}`,
    strategyId: partial.strategyId ?? null,
    definition: partial.definition ?? null,
    sortOrder: partial.sortOrder ?? 0,
    effectiveFrom: partial.effectiveFrom ?? '2020-01-01',
    archivedDay: partial.archivedDay ?? null,
    ...partial,
  } as ChecklistItem
}

function trade(
  netPnl: number,
  progress: ChecklistProgress | null,
  opts: { strategyId?: string | null; entryDay?: string; criteriaDay?: string; locked?: boolean } = {},
): AdherenceTrade {
  const entryDay = opts.entryDay ?? '2026-03-02'
  return {
    row: row(netPnl, entryDay),
    strategyId: opts.strategyId ?? 'strat-1',
    entryDay,
    // Normally the trade is still inside its review window, so its criteria day is
    // "today"; a locked one passes the day its window closed.
    criteriaDay: opts.criteriaDay ?? entryDay,
    locked: opts.locked ?? false,
    progress,
  }
}

const scored = (met: string[]) => ({ scored: true, met, scoredAt: null })
const progressOf = (
  blocks: Partial<Record<ChecklistBlock, { scored: boolean; met: string[]; scoredAt: string | null }>>,
): ChecklistProgress => ({
  ...emptyProgress(),
  blocks: { ...emptyProgress().blocks, ...blocks },
})

describe('applicableItems', () => {
  const universal = item({ id: 'g1', block: 'gate', label: 'In window' })
  const mine = item({ id: 's1', block: 'setup', label: 'Break confirmed', strategyId: 'strat-1' })
  const other = item({ id: 's2', block: 'setup', label: 'Other setup', strategyId: 'strat-2' })
  const future = item({ id: 'g2', block: 'gate', label: 'Later', effectiveFrom: '2026-06-01' })
  const archived = item({ id: 'g3', block: 'gate', label: 'Retired', archivedDay: '2026-02-01' })
  const items = [universal, mine, other, future, archived]

  it('keeps universal items and the trade’s own strategy items', () => {
    const ids = applicableItems(items, { strategyId: 'strat-1', criteriaDay: '2026-03-02' }).map((i) => i.id)
    expect(ids).toEqual(['g1', 's1'])
  })

  it('excludes items that did not exist yet on the entry day', () => {
    const ids = applicableItems(items, { strategyId: 'strat-1', criteriaDay: '2026-06-05' }).map((i) => i.id)
    expect(ids).toContain('g2')
    const before = applicableItems(items, { strategyId: 'strat-1', criteriaDay: '2026-05-31' }).map((i) => i.id)
    expect(before).not.toContain('g2')
  })

  it('still counts an archived item toward the trades it governed', () => {
    const during = applicableItems(items, { strategyId: 'strat-1', criteriaDay: '2026-01-15' }).map((i) => i.id)
    expect(during).toContain('g3')
    const after = applicableItems(items, { strategyId: 'strat-1', criteriaDay: '2026-02-01' }).map((i) => i.id)
    expect(after).not.toContain('g3')
  })

  it('orders universal items before setup-specific ones', () => {
    const order = applicableItems(items, { strategyId: 'strat-1', criteriaDay: '2026-03-02' }).map((i) => i.block)
    expect(order).toEqual(['gate', 'setup'])
  })
})

describe('the review window', () => {
  const RECORDED = new Date('2026-03-02T09:00:00Z')
  const within = new Date('2026-03-02T20:00:00Z')
  const after = new Date('2026-03-04T09:00:00Z')

  it('stays open for the window and shuts after it', () => {
    expect(isCriteriaLocked(RECORDED, within)).toBe(false)
    expect(isCriteriaLocked(RECORDED, after)).toBe(true)
  })

  it('tracks the checklist while open, then freezes at the closing moment', () => {
    // Inside the window the trade follows "now", so criteria written since are picked up.
    expect(criteriaLockAt(RECORDED, within)).toEqual(within)
    // Afterwards it is pinned to when the window shut — never to "now".
    expect(criteriaLockAt(RECORDED, after)).toEqual(new Date(RECORDED.getTime() + CRITERIA_WINDOW_HOURS * 3600_000))
  })

  it('counts down to zero and stops there', () => {
    expect(criteriaWindowLeft(RECORDED, within)).toBeGreaterThan(0)
    expect(criteriaWindowLeft(RECORDED, after)).toBe(0)
  })

  it('lets a trade logged today be judged by criteria written today, whatever its entry date', () => {
    const writtenToday = item({ id: 'g9', block: 'gate', label: 'Written today', effectiveFrom: '2026-03-02' })
    // Entered months ago (an import, or a backtest run), recorded today.
    const logged = trade(1, null, { entryDay: '2025-11-04', criteriaDay: '2026-03-02' })
    expect(applicableItems([writtenToday], logged).map((i) => i.id)).toEqual(['g9'])
  })

  it('keeps the entry day for chronology even when the criteria day differs', () => {
    const items = [item({ id: 'g1', block: 'gate', label: 'A' })]
    const logged = trade(1, progressOf({ gate: scored(['g1']) }), {
      entryDay: '2025-11-04',
      criteriaDay: '2026-03-02',
    })
    const [point] = adherenceTrend(resolveTrades([logged], items)).points
    // The trend is drawn against when the trade happened, not when it was reviewed.
    expect(point.date).toBe('2025-11-04')
    expect(point.samples.gate).toBe(1)
  })
})

describe('pendingItems', () => {
  const live = item({ id: 'new', block: 'gate', label: 'Written today', effectiveFrom: '2026-04-01' })
  const applies = item({ id: 'old', block: 'gate', label: 'Was there', effectiveFrom: '2020-01-01' })
  const retired = item({
    id: 'gone',
    block: 'gate',
    label: 'Retired since',
    effectiveFrom: '2026-04-01',
    archivedDay: '2026-04-10',
  })
  const otherSetup = item({ id: 'mine', block: 'setup', label: 'Elsewhere', strategyId: 'strat-2' })
  const items = [live, applies, retired, otherSetup]
  const trade = { strategyId: 'strat-1', criteriaDay: '2026-03-02' }

  it('lists what was added after the trade, and nothing that already applied', () => {
    expect(pendingItems(items, trade).map((i) => i.id)).toEqual(['new'])
  })

  it('never lists a retired criterion — it is not live today either', () => {
    expect(pendingItems(items, trade).map((i) => i.id)).not.toContain('gone')
  })

  it('respects the trade’s scope, like applicability does', () => {
    expect(pendingItems(items, trade).map((i) => i.id)).not.toContain('mine')
  })

  it('never overlaps with the criteria the trade is scored on', () => {
    const scored = applicableItems(items, trade).map((i) => i.id)
    const shown = pendingItems(items, trade).map((i) => i.id)
    expect(shown.filter((id) => scored.includes(id))).toEqual([])
  })
})

describe('normalizeProgress', () => {
  const items = [
    item({ id: 's1', block: 'setup', label: 'Above VWAP' }),
    item({ id: 's2', block: 'setup', label: 'Volume spike' }),
    item({ id: 'e1', block: 'exit', label: 'Target hit' }),
  ]

  it('reads null as nothing evaluated', () => {
    const p = normalizeProgress(null, items)
    expect(p.blocks.gate.scored).toBe(false)
    expect(p.blocks.setup.met).toEqual([])
  })

  it('maps v1 text to item ids within its own block', () => {
    const p = normalizeProgress({ entry: ['Above VWAP', 'Target hit'], exit: ['Target hit'] }, items)
    // "Target hit" is an exit criterion — it must not leak into the setup block.
    expect(p.blocks.setup.met).toEqual(['s1'])
    expect(p.blocks.exit.met).toEqual(['e1'])
  })

  it('treats a v1 row as evaluated for setup and exit, never for gate', () => {
    const p = normalizeProgress({ entry: [], exit: [] }, items)
    expect(p.blocks.setup.scored).toBe(true)
    expect(p.blocks.exit.scored).toBe(true)
    expect(p.blocks.gate.scored).toBe(false)
  })

  it('drops v1 text that matches no current item', () => {
    const p = normalizeProgress({ entry: ['Deleted criterion'], exit: [] }, items)
    expect(p.blocks.setup.met).toEqual([])
  })

  it('fills in blocks a v2 row is missing', () => {
    const partial = { v: 2, blocks: { setup: scored(['s1']) } } as unknown as ChecklistProgress
    const p = normalizeProgress(partial, items)
    expect(p.blocks.setup.met).toEqual(['s1'])
    expect(p.blocks.gate).toEqual({ scored: false, met: [], scoredAt: null })
  })
})

describe('tradeProgress', () => {
  it('resolves legacy text within the trade’s OWN criteria, not another setup’s', () => {
    // Same wording under two setups — the classic way a text-keyed row crosses over.
    const mine = item({ id: 'a', block: 'setup', label: 'Break confirmed', strategyId: 'strat-1' })
    const theirs = item({ id: 'b', block: 'setup', label: 'Break confirmed', strategyId: 'strat-2' })
    const items = [theirs, mine] // deliberately ordered so a naive lookup finds the wrong one
    const p = tradeProgress(
      { strategyId: 'strat-1', criteriaDay: '2026-03-02', progress: { entry: ['Break confirmed'], exit: [] } },
      items,
    )
    expect(p.blocks.setup.met).toEqual(['a'])
  })

  it('drops legacy text for a criterion that did not apply on the entry day', () => {
    const later = item({ id: 'a', block: 'setup', label: 'Break confirmed', effectiveFrom: '2026-04-01' })
    const p = tradeProgress(
      { strategyId: 'strat-1', criteriaDay: '2026-03-02', progress: { entry: ['Break confirmed'], exit: [] } },
      [later],
    )
    expect(p.blocks.setup.met).toEqual([])
  })
})

describe('blockScore', () => {
  const items = [
    item({ id: 'g1', block: 'gate', label: 'A' }),
    item({ id: 'g2', block: 'gate', label: 'B' }),
    item({ id: 's1', block: 'setup', label: 'C' }),
  ]

  it('is null while the block has not been evaluated — never 0', () => {
    expect(blockScore(trade(100, null), items, 'gate')).toBeNull()
  })

  it('is null when the block has no items on that day', () => {
    const t = trade(100, progressOf({ exit: scored([]) }))
    expect(blockScore(t, items, 'exit')).toBeNull()
  })

  it('is 0 for an evaluated block with nothing met', () => {
    expect(blockScore(trade(100, progressOf({ gate: scored([]) })), items, 'gate')).toBe(0)
  })

  it('scores the met share of the applicable items', () => {
    expect(blockScore(trade(100, progressOf({ gate: scored(['g1']) })), items, 'gate')).toBe(50)
    expect(blockScore(trade(100, progressOf({ gate: scored(['g1', 'g2']) })), items, 'gate')).toBe(100)
  })

  it('ignores met ids for items that did not apply', () => {
    const t = trade(100, progressOf({ gate: scored(['g1', 's1']) }))
    expect(blockScore(t, items, 'gate')).toBe(50)
  })
})

describe('worstBlock', () => {
  it('takes the minimum, not the mean, and ignores unevaluated blocks', () => {
    expect(worstBlock({ gate: 100, setup: 60, exit: null })).toBe(60)
    expect(worstBlock({ gate: null, setup: null, exit: null })).toBeNull()
  })
})

describe('resolveTrade', () => {
  const items = [
    item({ id: 'g1', block: 'gate', label: 'In window' }),
    item({ id: 's1', block: 'setup', label: 'Break confirmed', strategyId: 'strat-1' }),
    item({ id: 's2', block: 'setup', label: 'Other setup', strategyId: 'strat-2' }),
    item({ id: 'g0', block: 'gate', label: 'Retired', archivedDay: '2026-01-01' }),
  ]

  it('groups only the applicable criteria, by block', () => {
    const r = resolveTrade(trade(1, progressOf({ gate: scored(['g1']) })), items)
    expect(r.items.gate.map((i) => i.id)).toEqual(['g1'])
    expect(r.items.setup.map((i) => i.id)).toEqual(['s1'])
    expect(r.items.exit).toEqual([])
  })

  it('carries the met ids as a set, per block', () => {
    const r = resolveTrade(trade(1, progressOf({ gate: scored(['g1']) })), items)
    expect(r.met.gate.has('g1')).toBe(true)
    expect(r.met.setup.size).toBe(0)
  })

  it('resolves legacy text against the trade’s own criteria', () => {
    const r = resolveTrade(trade(1, { entry: ['Break confirmed'], exit: [] }), items)
    expect([...r.met.setup]).toEqual(['s1'])
    expect(r.progress.blocks.setup.scored).toBe(true)
    expect(r.progress.blocks.gate.scored).toBe(false)
  })

  it('agrees with the per-trade helpers it replaces', () => {
    const t = trade(1, progressOf({ gate: scored(['g1']) }))
    const r = resolveTrade(t, items)
    expect(r.items.gate).toEqual(applicableItems(items, t).filter((i) => i.block === 'gate'))
    expect(r.progress).toEqual(tradeProgress(t, items))
    expect(blockSummaries([r]).gate.adherencePct).toBe(blockScore(t, items, 'gate'))
  })
})

describe('blockAnalytics', () => {
  const items = [
    item({ id: 'g1', block: 'gate', label: 'In window' }),
    item({ id: 'g2', block: 'gate', label: 'No news' }),
  ]
  const trades = [
    trade(100, progressOf({ gate: scored(['g1', 'g2']) })),
    trade(50, progressOf({ gate: scored(['g1']) })),
    trade(-80, progressOf({ gate: scored([]) })),
    trade(-40, null), // never evaluated
  ]

  it('averages only the evaluated trades and reports coverage beside it', () => {
    const a = blockAnalytics(resolveTrades(trades, items), 'gate', 'net', null)
    // 100, 50, 0 → 50; the unevaluated trade is excluded from BOTH numerator and mean.
    expect(a.adherencePct).toBeCloseTo(50)
    expect(a.scoredTrades).toBe(3)
    expect(a.applicableTrades).toBe(4)
  })

  it('splits each item’s outcomes by followed vs skipped', () => {
    const a = blockAnalytics(resolveTrades(trades, items), 'gate', 'net', null)
    const news = a.items.find((i) => i.itemId === 'g2')!
    expect(news.followed).toBe(1)
    expect(news.total).toBe(3)
    expect(news.avgPnlFollowed).toBeCloseTo(100)
    expect(news.avgPnlMissed).toBeCloseTo((50 - 80) / 2)
  })

  it('withholds the per-item verdict until the sample is big enough', () => {
    const a = blockAnalytics(resolveTrades(trades, items), 'gate', 'net', null)
    expect(a.itemStatsReady).toBe(false)
    expect(a.items.every((i) => i.separated === false)).toBe(true)
  })

  it('is empty rather than zero when nothing applied', () => {
    const a = blockAnalytics(resolveTrades(trades, items), 'exit', 'net', null)
    expect(a.adherencePct).toBeNull()
    expect(a.applicableTrades).toBe(0)
    expect(a.items).toEqual([])
  })
})

describe('blockSummaries', () => {
  it('reports each block independently', () => {
    const items = [item({ id: 'g1', block: 'gate', label: 'A' }), item({ id: 'e1', block: 'exit', label: 'B' })]
    const s = blockSummaries(resolveTrades([trade(10, progressOf({ gate: scored(['g1']), exit: scored([]) }))], items))
    expect(s.gate.adherencePct).toBe(100)
    expect(s.exit.adherencePct).toBe(0)
    expect(s.setup.adherencePct).toBeNull()
  })
})

describe('mostMissedItems', () => {
  const two = [item({ id: 'g1', block: 'gate', label: 'A' }), item({ id: 'g2', block: 'gate', label: 'B' })]

  it('ranks by how often a reviewed item was skipped', () => {
    const trades = [
      ...Array.from({ length: 4 }, () => trade(1, progressOf({ gate: scored(['g1']) }))),
      trade(1, progressOf({ gate: scored(['g1', 'g2']) })),
      trade(1, null), // never reviewed — contributes to neither side
    ]
    const missed = mostMissedItems(resolveTrades(trades, two))
    expect(missed).toHaveLength(1)
    expect(missed[0]).toMatchObject({ itemId: 'g2', missed: 4, total: 5 })
  })

  it('withholds an item until it has been reviewed enough times', () => {
    // Skipped every time, but only twice — the list must not open with noise.
    const trades = [trade(1, progressOf({ gate: scored(['g1']) })), trade(1, progressOf({ gate: scored(['g1']) }))]
    expect(mostMissedItems(resolveTrades(trades, two))).toEqual([])
  })
})

describe('reviewStates', () => {
  const items = [
    item({ id: 'g1', block: 'gate', label: 'A' }),
    item({ id: 'g2', block: 'gate', label: 'B' }),
    item({ id: 's1', block: 'setup', label: 'C', strategyId: 'other' }),
  ]
  const scope = (progress: ChecklistProgress | null, strategyId: string | null = 'strat-1') => ({
    strategyId,
    criteriaDay: '2026-03-02',
    progress,
  })

  it('separates "nothing to review" from "not reviewed yet"', () => {
    const states = reviewStates(scope(progressOf({ gate: scored(['g1']) })), items)
    const by = Object.fromEntries(states.map((s) => [s.block, s]))
    expect(by.gate).toMatchObject({ applicable: true, reviewed: true, met: 1, total: 2 })
    // The setup criterion belongs to another strategy, so this trade has none.
    expect(by.setup).toMatchObject({ applicable: false, reviewed: false })
    expect(by.exit).toMatchObject({ applicable: false, reviewed: false })
  })

  it('reports a trade with no progress as applicable but unreviewed', () => {
    const states = reviewStates(scope(null), items)
    expect(states.find((s) => s.block === 'gate')).toMatchObject({ applicable: true, reviewed: false, met: 0 })
  })

  it('has nothing to review at all until a setup is named', () => {
    // Not even the universal blocks: with no setup there is nothing to be faithful to,
    // and scoring two blocks out of three would split the sample. See applicableItems.
    const states = reviewStates(scope(progressOf({ gate: scored(['g1']) }), null), items)
    expect(states.every((s) => !s.applicable)).toBe(true)
    expect(applicableItems(items, { strategyId: null, criteriaDay: '2026-03-02' })).toEqual([])
    expect(pendingItems(items, { strategyId: null, criteriaDay: '2026-03-02' })).toEqual([])
  })
})

describe('adherenceTrend', () => {
  const items = [item({ id: 'g1', block: 'gate', label: 'A' })]
  const reviewed = (day: string, met: string[]) => trade(1, progressOf({ gate: scored(met) }), { entryDay: day })
  const unreviewed = (day: string) => trade(1, null, { entryDay: day })

  it('averages the reviewed trades of each day', () => {
    const trades = [
      reviewed('2026-03-01', ['g1']), // 100
      reviewed('2026-03-01', []), //   0  → the day averages to 50
      reviewed('2026-03-02', ['g1']),
    ]
    const { points } = adherenceTrend(resolveTrades(trades, items))
    expect(points.map((p) => [p.date, p.gate])).toEqual([
      ['2026-03-01', 50],
      ['2026-03-02', 100],
    ])
  })

  it('emits no point for a day nobody reviewed, and never a null day in between', () => {
    const trades = [reviewed('2026-03-01', ['g1']), unreviewed('2026-03-02'), reviewed('2026-03-05', ['g1'])]
    const { points } = adherenceTrend(resolveTrades(trades, items))
    // Two points, and the quiet days show as distance on a time axis rather than a gap.
    expect(points.map((p) => p.date)).toEqual(['2026-03-01', '2026-03-05'])
    expect(points.every((p) => p.gate !== null)).toBe(true)
  })

  it('reports the trades behind each point, per block', () => {
    const trades = [reviewed('2026-03-01', ['g1']), reviewed('2026-03-01', ['g1'])]
    const [point] = adherenceTrend(resolveTrades(trades, items)).points
    expect(point.samples.gate).toBe(2)
    // A block nobody reviewed carries no sample and no value.
    expect(point.samples.setup).toBe(0)
    expect(point.setup).toBeNull()
  })

  it('keeps one point per day while the range is short', () => {
    const trades = ['2026-03-01', '2026-03-02', '2026-03-03'].map((d) => reviewed(d, ['g1']))
    const { bucketDays, points } = adherenceTrend(resolveTrades(trades, items))
    expect(bucketDays).toBe(1)
    expect(points).toHaveLength(3)
    expect(points.every((p) => p.date === p.endDate)).toBe(true)
  })

  it('folds days together once the range would draw too many points', () => {
    // 90 days of trading, one trade a day.
    const trades = Array.from({ length: 90 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
      return reviewed(day, i % 2 === 0 ? ['g1'] : [])
    })
    const { bucketDays, points } = adherenceTrend(resolveTrades(trades, items))
    expect(bucketDays).toBe(2)
    expect(points.length).toBeLessThanOrEqual(60)
    // A folded point says which span it covers instead of pretending to be one day.
    expect(points[0].endDate).not.toBe(points[0].date)
    // Each bucket holds both of its days' trades.
    expect(points[0].samples.gate).toBe(2)
  })

  it('weights a bucket by trades, not by days', () => {
    // A ten-trade Monday and a one-trade Tuesday inside one bucket: the mean must not
    // let the quiet day count for half.
    const trades = [...Array.from({ length: 10 }, () => reviewed('2026-01-01', ['g1'])), reviewed('2026-01-02', [])]
    const { points } = adherenceTrend(resolveTrades(trades, items), 1)
    expect(points).toHaveLength(1)
    expect(points[0].gate).toBeCloseTo((10 * 100) / 11)
  })

  it('says nothing at all when nothing has been reviewed', () => {
    const { points } = adherenceTrend(resolveTrades([unreviewed('2026-03-01')], items))
    expect(points).toEqual([])
  })
})

describe('trendBucketDays', () => {
  it('steps up through units people think in', () => {
    expect(trendBucketDays(30)).toBe(1)
    expect(trendBucketDays(90)).toBe(2)
    expect(trendBucketDays(365)).toBe(7)
  })

  it('keeps every range under the point ceiling', () => {
    for (const span of [1, 45, 200, 800, 5000]) {
      expect(Math.ceil(span / trendBucketDays(span))).toBeLessThanOrEqual(60)
    }
  })
})

describe('diagnose', () => {
  const sample = { trades: 60, expectancy: 10 }
  /** A block with enough reviews behind it to be acted on. */
  const measured = (pct: number | null, scoredTrades = 20) => ({ pct, scoredTrades })
  const blocks = (gate: number | null, setup: number | null, exit: number | null) => ({
    gate: measured(gate),
    setup: measured(setup),
    exit: measured(exit),
  })

  it('says nothing at all without data', () => {
    expect(diagnose(blocks(null, null, null), sample).kind).toBe('noData')
  })

  it('reports the earliest failing block and stops there', () => {
    expect(diagnose(blocks(70, 20, 20), sample).kind).toBe('gate')
    expect(diagnose(blocks(90, 70, 20), sample).kind).toBe('setup')
    expect(diagnose(blocks(90, 90, 70), sample).kind).toBe('exit')
  })

  it('carries the figures the sentence rests on', () => {
    expect(diagnose(blocks(70, 90, 90), sample)).toMatchObject({ kind: 'gate', pct: 70, trades: 20 })
  })

  it('will not blame a block measured on a handful of trades', () => {
    // The case that made this necessary: gate reviewed once at 22%, setup measured over
    // twenty at 33%. Blaming the gate would be an accident of the precedence order.
    const v = diagnose(
      { gate: measured(22, 1), setup: measured(33, 22), exit: measured(90, 24) },
      { trades: 28, expectancy: 10 },
    )
    expect(v).toMatchObject({ kind: 'setup', pct: 33, trades: 22 })
  })

  it('says "too few reviews" rather than picking the next block down', () => {
    // Only the gate is failing, and only one trade says so — the honest answer is that
    // there is nothing to conclude, not that the setup (which holds) is fine.
    const v = diagnose({ gate: measured(22, 1), setup: measured(90, 22), exit: measured(90, 24) }, sample)
    expect(v).toMatchObject({ kind: 'thin', block: 'gate', pct: 22, trades: 1, remaining: 9 })
  })

  it('blames the playbook only on a real sample', () => {
    const clean = blocks(95, 90, 100)
    expect(diagnose(clean, { trades: 50, expectancy: -20 }).kind).toBe('playbook')
    expect(diagnose(clean, { trades: 22, expectancy: -20 })).toEqual({ kind: 'smallSample', remaining: 28 })
  })

  it('is clean when every block holds and expectancy is positive', () => {
    expect(diagnose(blocks(95, 90, 100), sample).kind).toBe('clean')
  })
})

describe('wilsonInterval', () => {
  it('stays inside [0, 1] at the extremes', () => {
    const [lo, hi] = wilsonInterval(0, 10)!
    expect(lo).toBe(0)
    expect(hi).toBeGreaterThan(0)
    const [lo2, hi2] = wilsonInterval(10, 10)!
    expect(hi2).toBe(1)
    expect(lo2).toBeLessThan(1)
  })

  it('narrows as the sample grows', () => {
    const small = wilsonInterval(5, 10)!
    const large = wilsonInterval(500, 1000)!
    expect(large[1] - large[0]).toBeLessThan(small[1] - small[0])
  })

  it('has no interval for an empty sample', () => {
    expect(wilsonInterval(0, 0)).toBeNull()
  })
})

describe('intervalsOverlap', () => {
  it('treats an unknown interval as overlapping', () => {
    expect(intervalsOverlap(null, [0, 0.1])).toBe(true)
  })

  it('separates disjoint intervals', () => {
    expect(intervalsOverlap([0, 0.2], [0.3, 0.9])).toBe(false)
    expect(intervalsOverlap([0, 0.4], [0.3, 0.9])).toBe(true)
  })
})
