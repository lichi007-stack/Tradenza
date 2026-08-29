import { roundMoney } from './trade-pnl'

// Per-fill commission auto-calculation.
//
// One broker plan, hardcoded on purpose rather than made a setting: $1.5 flat
// per buy or sell order, or $0.01/share if that's higher. It only applies to
// stocks — the per-share formula has no natural meaning for futures contracts,
// forex lots or crypto units, so those asset classes keep manual commission
// entry unchanged.

export const COMMISSION_FLAT = 1.5
export const COMMISSION_PER_SHARE = 0.01

/** $1.5 flat, or $0.01/share, whichever is higher. 0 for a non-positive quantity. */
export function calcStockCommission(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0
  return roundMoney(Math.max(COMMISSION_FLAT, quantity * COMMISSION_PER_SHARE), 2)
}
