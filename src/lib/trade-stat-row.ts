import { multiplierFor, tradeNotional } from '@/lib/breakeven'
import type { TradeRow } from '@/lib/stats-compute'
import type { ChecklistProgress } from '@/lib/adherence'

// Columns needed to build a `TradeRow` for `computeBundle`, plus the adherence fields read
// alongside them. Kept in one place so every surface computes from the same projection.
// Outside the actions modules because a 'use server' file may only export async functions.

export const STAT_COLUMNS = {
  netPnl: true,
  grossPnl: true,
  fees: true,
  direction: true,
  entryDatetime: true,
  exitDatetime: true,
  riskAmount: true,
  riskRewardRatio: true,
  notes: true,
  symbol: true,
  entryPrice: true,
  entryQuantity: true,
  extra: true,
  checklistProgress: true,
  strategyId: true,
  // When the trade was recorded — what the review window counts from.
  createdAt: true,
} as const

export interface StatTradeRow {
  netPnl: string | null
  grossPnl: string | null
  fees: string | null
  direction: 'long' | 'short'
  entryDatetime: Date
  exitDatetime: Date | null
  riskAmount: string | null
  riskRewardRatio: string | null
  notes: string | null
  symbol: string
  entryPrice: string | null
  entryQuantity: string | null
  extra: unknown
  checklistProgress: ChecklistProgress | null
  strategyId: string | null
  createdAt: Date
}

export function toTradeRow(r: StatTradeRow): TradeRow {
  return {
    netPnl: Number(r.netPnl ?? 0),
    grossPnl: Number(r.grossPnl ?? 0),
    fees: Number(r.fees ?? 0),
    direction: r.direction,
    entryDatetime: r.entryDatetime,
    exitDatetime: r.exitDatetime ?? null,
    riskAmount: r.riskAmount != null ? Number(r.riskAmount) : null,
    riskRewardRatio: r.riskRewardRatio != null ? Number(r.riskRewardRatio) : null,
    hasNotes: typeof r.notes === 'string' && r.notes.trim().length > 0,
    notional: tradeNotional(Number(r.entryPrice ?? 0), Number(r.entryQuantity ?? 0), multiplierFor(r.extra, r.symbol)),
  }
}
