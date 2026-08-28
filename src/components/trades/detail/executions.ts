import type { Trade } from '@/lib/db'
import { calculatePnl } from '@/lib/utils'
import { roundMoney } from '@/lib/trade-pnl'

export interface NormalizedExecution {
  /** Unix seconds. */
  time: number
  side: 'buy' | 'sell'
  quantity: number
  price: number
  commission: number
  fee: number
}

interface RawExecution {
  datetime?: unknown
  side?: unknown
  quantity?: unknown
  price?: unknown
  commission?: unknown
  fee?: unknown
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : 0
}

export function normalizeExecutions(trade: Trade): NormalizedExecution[] {
  const extra = trade.extra as { executions?: RawExecution[] } | null
  const raw = Array.isArray(extra?.executions) ? extra!.executions! : null

  if (raw && raw.length > 0) {
    const out: NormalizedExecution[] = []
    for (const e of raw) {
      const ts = typeof e.datetime === 'string' ? Date.parse(e.datetime) : NaN
      const price = toNum(e.price)
      const qty = toNum(e.quantity)
      if (!Number.isFinite(ts) || price <= 0 || qty <= 0) continue
      out.push({
        time: Math.floor(ts / 1000),
        side: e.side === 'sell' ? 'sell' : 'buy',
        quantity: qty,
        price,
        commission: toNum(e.commission),
        fee: toNum(e.fee),
      })
    }
    if (out.length > 0) return out.sort((a, b) => a.time - b.time)
  }

  // Fallback: synthesize an entry (+ exit) execution from the trade itself
  const out: NormalizedExecution[] = []
  const entrySide = trade.direction === 'long' ? 'buy' : 'sell'
  out.push({
    time: Math.floor(new Date(trade.entryDatetime).getTime() / 1000),
    side: entrySide,
    quantity: toNum(trade.entryQuantity),
    price: toNum(trade.entryPrice),
    commission: 0,
    fee: toNum(trade.fees),
  })
  if (trade.exitPrice && trade.exitDatetime) {
    out.push({
      time: Math.floor(new Date(trade.exitDatetime).getTime() / 1000),
      side: entrySide === 'buy' ? 'sell' : 'buy',
      quantity: toNum(trade.exitQuantity ?? trade.entryQuantity),
      price: toNum(trade.exitPrice),
      commission: 0,
      fee: 0,
    })
  }
  return out
}

export interface PositionState {
  entrySide: 'buy' | 'sell'
  openQty: number
}

/**
 * Net position implied by a set of executions, using the same rule the server
 * applies when it derives a trade's status: the earliest execution opens the
 * position and everything on the opposite side closes it. Executions without a
 * usable time or a positive quantity are ignored, so a half-filled draft row
 * never distorts the result.
 */
export function positionState(
  execs: readonly { time: number; side: 'buy' | 'sell'; quantity: number }[],
): PositionState {
  const usable = execs.filter((e) => Number.isFinite(e.time) && e.quantity > 0).sort((a, b) => a.time - b.time)
  if (usable.length === 0) return { entrySide: 'buy', openQty: 0 }
  const entrySide = usable[0].side
  const signed = usable.reduce((s, e) => s + (e.side === entrySide ? e.quantity : -e.quantity), 0)
  return { entrySide, openQty: signed }
}

export function storedMultiplier(trade: Trade): number | undefined {
  const extra = trade.extra as { contractMultiplier?: unknown } | null
  const m = toNum(extra?.contractMultiplier)
  return m > 0 ? m : undefined
}

export interface RiskPlanLeg {
  ticks: number
  qty: number
}

export interface RiskPlan {
  tickValue: number
  profitTargets: RiskPlanLeg[]
  stopLosses: RiskPlanLeg[]
}

export function storedRiskPlan(trade: Trade): RiskPlan | undefined {
  const extra = trade.extra as { riskPlan?: unknown } | null
  const rp = extra?.riskPlan as Partial<RiskPlan> | undefined
  if (!rp || typeof rp !== 'object') return undefined
  const legs = (arr: unknown): RiskPlanLeg[] =>
    Array.isArray(arr)
      ? arr.map((l) => ({ ticks: toNum((l as RiskPlanLeg)?.ticks), qty: toNum((l as RiskPlanLeg)?.qty) }))
      : []
  return {
    tickValue: toNum(rp.tickValue),
    profitTargets: legs(rp.profitTargets),
    stopLosses: legs(rp.stopLosses),
  }
}

export interface SummaryExecution {
  time: number
  side: 'buy' | 'sell'
  quantity: number
  price: number
  commission: number
  fee: number
}

export interface TradeSummary {
  direction: 'long' | 'short'
  /** Total quantity filled on the opening side. */
  entryQty: number
  /** Total quantity filled on the closing side. */
  exitQty: number
  /** Signed quantity still open (0 = flat, matches {@link positionState}). */
  openQty: number
  avgEntry: number
  avgExit: number | null
  /** Sum of commissions + fees across every execution. */
  fees: number
  /** min(entryQty, exitQty) — the quantity a realized P&L can be computed on. */
  matchedQty: number
  /** Realized gross P&L on the matched quantity, with the multiplier applied. Null until something has closed. */
  grossPnl: number | null
  /** Realized gross P&L minus fees. Null until something has closed. */
  netPnl: number | null
  status: 'open' | 'closed'
}

/**
 * One-shot summary of a (possibly still-being-edited) execution list: position
 * size, average entry/exit, fees and realized P&L. Mirrors exactly what the
 * server derives when persisting executions (see `updateTradeExecutions` and
 * `saveManualTrade`), so a live preview while adding/editing never disagrees
 * with what gets saved. Shared by the add-trade manual entry screen and the
 * trade detail executions editor so the two never drift apart.
 */
export function summarizeExecutions(execs: readonly SummaryExecution[], multiplier?: number): TradeSummary | null {
  const usable = execs.filter((e) => Number.isFinite(e.time) && e.quantity > 0 && e.price > 0)
  if (usable.length === 0) return null

  const sorted = [...usable].sort((a, b) => a.time - b.time)
  const entrySide = sorted[0].side
  const direction: 'long' | 'short' = entrySide === 'buy' ? 'long' : 'short'
  const entries = sorted.filter((e) => e.side === entrySide)
  const exits = sorted.filter((e) => e.side !== entrySide)

  const sumQty = (rows: typeof sorted) => rows.reduce((s, e) => s + e.quantity, 0)
  const avgPrice = (rows: typeof sorted) => {
    const q = sumQty(rows)
    return q === 0 ? 0 : rows.reduce((s, e) => s + e.price * e.quantity, 0) / q
  }

  const entryQty = sumQty(entries)
  const exitQty = sumQty(exits)
  const avgEntry = avgPrice(entries)
  const avgExit = exits.length > 0 ? avgPrice(exits) : null
  const fees = sorted.reduce((s, e) => s + e.commission + e.fee, 0)
  const matchedQty = Math.min(entryQty, exitQty)
  const mult = multiplier && multiplier > 0 ? multiplier : 1

  let grossPnl: number | null = null
  let netPnl: number | null = null
  if (avgExit !== null && matchedQty > 0) {
    const pnl = calculatePnl(direction, avgEntry, avgExit, matchedQty, 0)
    grossPnl = roundMoney(pnl.grossPnl * mult)
    netPnl = roundMoney(grossPnl - fees)
  }

  const openQty = positionState(sorted).openQty
  const status: 'open' | 'closed' = exitQty >= entryQty && exits.length > 0 ? 'closed' : 'open'

  return { direction, entryQty, exitQty, openQty, avgEntry, avgExit, fees, matchedQty, grossPnl, netPnl, status }
}
