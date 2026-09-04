'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getActionErrorMessage } from '@/lib/action-error-message'
import { handleRateLimit } from '@/components/ui/rate-limit-toast'
import { Plus, Minus, Trash2, Loader2 } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { t } from '@/i18n'
import { saveManualTrade } from '@/lib/actions/wizard'
import { getCurrentPrices } from '@/lib/actions/quotes'
import { track } from '@/lib/analytics'
import { assetMultiplier, editorDefaultMultiplier } from '@/lib/futures'
import { calcStockCommission } from '@/lib/commission'
import type { AssetType } from '@/lib/brokers'
import DateTimeField from '@/components/ui/DateTimeField'
import TradeSummaryStats from '@/components/trades/detail/TradeSummaryStats'
import { summarizeExecutions } from '@/components/trades/detail/executions'
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeadRow,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table'

type AssetClass = AssetType | 'other'

// This journal is only ever used for stocks, so the asset-class picker is
// locked to a single choice rather than showing futures/forex/crypto/options/
// cfd tabs nobody here picks. (Kept as a function, not a constant, so a future
// broker-driven need to widen this back out only touches this one spot.)
const assetChoicesFor = (_brokerId: string): readonly AssetClass[] => ['stocks']

// The quantity column means different things per market — contracts, shares, or
// units — so its header adapts to the selected asset class.
const qtyHeaderKey = (assetClass: AssetClass): string => {
  if (assetClass === 'futures' || assetClass === 'options') return 'contracts'
  if (assetClass === 'stocks') return 'shares'
  if (assetClass === 'forex') return 'lots'
  if (assetClass === 'crypto' || assetClass === 'cfd') return 'units'
  return 'qty'
}

interface Execution {
  id: string
  dateTime: string // "YYYY-MM-DDTHH:mm:ss"
  multiplier: string
  qty: string
  side: 'buy' | 'sell'
  price: string
  comm: string
  fee: string
  /** False once the trader edits the commission field directly — stops the qty-driven auto-calc from overwriting it. */
  commAuto: boolean
  /** False once the trader edits the price field directly — stops the live-quote auto-fill from overwriting it. */
  priceAuto: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "Right now", in the shape DateTimeField/the store format expects — a sane default so a
 * one-account trader entering today's trade never has to touch the date picker. */
const nowLocalInput = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const emptyExec = (side: 'buy' | 'sell' = 'buy', multiplier = ''): Execution => ({
  id: Math.random().toString(36).slice(2),
  dateTime: nowLocalInput(),
  multiplier,
  qty: '',
  side,
  price: '',
  comm: '',
  // No input for this anymore — Comm alone covers "total per-trade cost" for
  // this journal (see ExecutionsEditor.tsx for the fuller rationale). Kept as
  // a field, not removed, purely so the save payload shape stays identical to
  // what the server and the other execution editors expect.
  fee: '0',
  commAuto: true,
  priceAuto: true,
})

const cellInput = 'w-full bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50'

/** $ risked per "R" unit in the stop-based position-size calculator below. */
const RISK_PER_R = 100

const num = (s: string) => {
  const n = parseFloat(s.replace(',', '.'))
  return isNaN(n) ? 0 : n
}

// Default per-execution multiplier for a market, from the one shared rule:
// futures pull the contract size (0 when unknown, so the user is prompted to fill
// it), options ×100, forex the standard-lot size, everything else 1. Stays
// editable per row.
const rowMultiplier = (assetClass: AssetClass, symbol: string): string =>
  String(editorDefaultMultiplier(assetClass, symbol))

export default function ManualEntry({
  brokerId,
  accountId,
  cancelHref,
}: {
  brokerId: string
  accountId: string
  cancelHref?: string
}) {
  const router = useRouter()
  const assetChoices = useMemo(() => assetChoicesFor(brokerId), [brokerId])
  const [assetClass, setAssetClass] = useState<AssetClass>(assetChoices[0])
  const [symbol, setSymbol] = useState('')
  const [execs, setExecs] = useState<Execution[]>([emptyExec()])
  const [saving, setSaving] = useState(false)
  const [livePrice, setLivePrice] = useState<number | null>(null)

  // Stop-based position sizing: give a stop price + a risk budget (in "R",
  // stepped in $100 jumps) and the entry row's quantity is solved for —
  // qty = risk$ ÷ |entry − stop| — instead of the trader doing that math by
  // hand. Only ever drives the first (entry) row; a second/exit row keeps its
  // own qty logic in addRow().
  const [stopPrice, setStopPrice] = useState('')
  const [riskR, setRiskR] = useState(1)
  const [qtyAuto, setQtyAuto] = useState(true)

  const hasSymbol = symbol.trim().length > 0

  // Auto-calculated commission (see lib/commission) only makes sense for
  // stocks — futures/forex/crypto/options/cfd keep manual entry untouched.
  const autoCommEnabled = (ac: AssetClass) => ac === 'stocks'

  // Fetch the current market price for whatever symbol is typed in, the same
  // free-source lookup the trades table uses (see lib/actions/quotes) — so the
  // Price field can default to "what it's trading at right now" instead of a
  // blank the trader has to fill in from another tab.
  useEffect(() => {
    const trimmed = symbol.trim().toUpperCase()
    if (!trimmed) {
      setLivePrice(null)
      return
    }
    let cancelled = false
    getCurrentPrices([{ assetClass, symbol: trimmed }])
      .then((prices) => {
        if (cancelled) return
        const price = prices?.[`${assetClass}:${trimmed}`]
        setLivePrice(typeof price === 'number' ? price : null)
      })
      .catch(() => {
        if (!cancelled) setLivePrice(null)
      })
    return () => {
      cancelled = true
    }
  }, [assetClass, symbol])

  // Once a live price comes back, drop it into any row still on auto-fill
  // (i.e. the trader hasn't typed a price of their own yet).
  useEffect(() => {
    if (livePrice === null) return
    setExecs((rows) => rows.map((r) => (r.priceAuto && !r.price ? { ...r, price: String(livePrice) } : r)))
  }, [livePrice])

  const riskDollars = riskR * RISK_PER_R
  const entryPriceForSizing = num(execs[0]?.price ?? '')
  const stopPriceNum = num(stopPrice)
  const stopDistance = Math.abs(entryPriceForSizing - stopPriceNum)
  const suggestedQty =
    stopPriceNum > 0 && entryPriceForSizing > 0 && stopDistance > 0 && riskDollars > 0
      ? Math.floor(riskDollars / stopDistance)
      : null

  // Drive the entry row's quantity from the calculator as long as the trader
  // hasn't overridden it by hand — re-solving whenever the stop, the risk
  // budget, or the (possibly live-filled) entry price changes.
  useEffect(() => {
    if (!qtyAuto || suggestedQty === null || suggestedQty <= 0) return
    setExecs((rows) => {
      const first = rows[0]
      if (!first || first.qty === String(suggestedQty)) return rows
      const next = { ...first, qty: String(suggestedQty) }
      if (next.commAuto && autoCommEnabled(assetClass)) next.comm = String(calcStockCommission(suggestedQty))
      return [next, ...rows.slice(1)]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately not depending on execs/assetClass identity, only the solved qty
  }, [suggestedQty, qtyAuto])

  const update = (id: string, patch: Partial<Execution>) =>
    setExecs((rows) =>
      rows.map((r) => {
        if (r.id !== id) return r
        const next = { ...r, ...patch }
        if ('qty' in patch && next.commAuto && autoCommEnabled(assetClass)) {
          const q = num(next.qty)
          next.comm = q > 0 ? String(calcStockCommission(q)) : ''
        }
        // A direct edit to the commission field itself is a manual override —
        // stop recalculating it from qty from here on.
        if ('comm' in patch) next.commAuto = false
        // Same for price: once the trader types their own, stop overwriting it
        // with the live quote.
        if ('price' in patch) next.priceAuto = false
        return next
      }),
    )

  // Switching market resets each row's multiplier to that market's default,
  // and (for rows still on auto) recalculates commission for the new market.
  const selectAssetClass = (ac: AssetClass) => {
    setAssetClass(ac)
    const mult = rowMultiplier(ac, symbol)
    setExecs((rows) =>
      rows.map((r) => ({
        ...r,
        multiplier: mult,
        comm: r.commAuto && autoCommEnabled(ac) && num(r.qty) > 0 ? String(calcStockCommission(num(r.qty))) : r.comm,
      })),
    )
  }

  const handleSymbolChange = (raw: string) => {
    const next = raw.toUpperCase()
    setSymbol(next)
    const mult = rowMultiplier(assetClass, next)
    setExecs((rows) => rows.map((r) => ({ ...r, multiplier: mult })))
  }

  const addRow = () =>
    setExecs((rows) => {
      const side = rows.length > 0 && rows[0].side === 'buy' ? 'sell' : 'buy'
      const last = rows[rows.length - 1]
      const row = emptyExec(side, rowMultiplier(assetClass, symbol))
      if (livePrice !== null) row.price = String(livePrice)
      if (last) {
        row.qty = last.qty
        if (autoCommEnabled(assetClass) && num(row.qty) > 0) row.comm = String(calcStockCommission(num(row.qty)))
      }
      return [...rows, row]
    })

  const validExecs = execs.filter((r) => r.dateTime && num(r.qty) > 0 && num(r.price) > 0)
  const canSave = hasSymbol && validExecs.length > 0 && validExecs.length === execs.length

  const summary = useMemo(() => {
    if (validExecs.length === 0) return null
    // Mirror the server's fallback exactly. The preview used to drop to ×1 when
    // the field was cleared while the save fell back to the instrument's real
    // multiplier, so the number shown was not the number stored.
    const rawMult = num(validExecs[0].multiplier)
    const mult = rawMult > 0 ? rawMult : assetMultiplier(assetClass, symbol.trim().toUpperCase())
    return summarizeExecutions(
      validExecs.map((e) => ({
        time: Math.floor(new Date(e.dateTime).getTime() / 1000),
        side: e.side,
        quantity: num(e.qty),
        price: num(e.price),
        commission: num(e.comm),
        fee: num(e.fee),
      })),
      mult,
    )
  }, [validExecs, assetClass, symbol])

  const save = async (addNext: boolean) => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      const trimmed = symbol.trim().toUpperCase()
      const res = await saveManualTrade({
        accountId,
        assetClass,
        symbol: trimmed,
        contractMultiplier: num(execs[0]?.multiplier) || assetMultiplier(assetClass, trimmed),
        executions: execs.map((e) => ({
          datetime: new Date(e.dateTime).toISOString(),
          side: e.side,
          quantity: num(e.qty),
          price: num(e.price),
          commission: num(e.comm),
          fee: num(e.fee),
        })),
        stopLoss: stopPriceNum > 0 ? stopPriceNum : undefined,
        riskAmount: riskDollars > 0 && stopPriceNum > 0 ? riskDollars : undefined,
      })
      if (handleRateLimit(res)) {
        setSaving(false)
        return
      }
      track({ name: 'trade_created', props: { source: 'manual', assetClass } })
      toast.success(t('addTrades.manual.saved', { symbol: trimmed }))
      if (addNext) {
        setSymbol('')
        setExecs([emptyExec()])
        setStopPrice('')
        setRiskR(1)
        setQtyAuto(true)
        setSaving(false)
      } else {
        router.push('/trades')
      }
    } catch (e) {
      toast.error(getActionErrorMessage(e, 'addTrades.manual.saveError'))
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
      <h2 className="text-lg font-semibold">{t('addTrades.manual.details')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('addTrades.manual.timezoneNote')}</p>

      <div className="mt-6">
        <p className="mb-2 text-xs font-medium text-primary">{t('addTrades.manual.type')}</p>
        {assetChoices.length === 1 ? (
          // Only one market is ever offered here, so there's nothing to pick —
          // show it as a plain, non-interactive label instead of a one-button
          // tab group that looks clickable but does nothing.
          <div className="inline-flex rounded-lg bg-muted/50 p-1">
            <span className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              {t(`addTrades.assets.${assetChoices[0]}`)}
            </span>
          </div>
        ) : (
          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1">
            {assetChoices.map((ac) => {
              const active = ac === assetClass
              return (
                <button
                  key={ac}
                  type="button"
                  onClick={() => selectAssetClass(ac)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm transition-colors',
                    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`addTrades.assets.${ac}`)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Symbol */}
      <div className="mt-6 max-w-sm">
        <p className="mb-2 text-xs font-medium text-primary">{t('addTrades.manual.symbol')}</p>
        <input
          value={symbol}
          onChange={(e) => handleSymbolChange(e.target.value)}
          placeholder={t('addTrades.manual.symbolPlaceholder')}
          className="w-full rounded-md border border-border bg-input/40 px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {!hasSymbol ? (
        <p className="mt-6 rounded-xl border border-dashed border-border bg-muted/10 px-4 py-6 text-center text-sm text-muted-foreground">
          {t('addTrades.manual.symbolFirst')}
        </p>
      ) : (
        <>
          {/* Stop-based position sizing: solves the entry row's quantity from a
              stop price and a risk budget, instead of the trader doing the math. */}
          <div className="mt-6 flex flex-wrap items-end gap-4">
            <div className="w-36">
              <p className="mb-2 text-xs font-medium text-primary">{t('addTrades.manual.stopPrice')}</p>
              <input
                inputMode="decimal"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-md border border-border bg-input/40 px-3 py-2.5 text-sm tabular focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-primary">{t('addTrades.manual.riskR')}</p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setRiskR((r) => Math.max(0, r - 1))}
                  aria-label={t('addTrades.manual.riskDecrease')}
                  className="rounded-md border border-border p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <div className="w-28 rounded-md border border-border bg-input/40 px-2 py-2.5 text-center text-sm tabular">
                  R={riskR} <span className="text-muted-foreground">({formatCurrency(riskDollars)})</span>
                </div>
                <button
                  type="button"
                  onClick={() => setRiskR((r) => r + 1)}
                  aria-label={t('addTrades.manual.riskIncrease')}
                  className="rounded-md border border-border p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {suggestedQty !== null && qtyAuto && (
              <p className="pb-3 text-xs text-muted-foreground">
                {t('addTrades.manual.riskSizingNote', { qty: suggestedQty })}
              </p>
            )}
          </div>

          <TableContainer className="mt-6">
            <Table className="min-w-[56rem]">
              <TableHead>
                <TableHeadRow className="border-b-0 bg-muted/40">
                  <TableHeaderCell className="px-3 py-2.5">{t('addTrades.manual.col.dateTime')}</TableHeaderCell>
                  <TableHeaderCell className="px-3 py-2.5">{t('addTrades.manual.col.multiplier')}</TableHeaderCell>
                  <TableHeaderCell className="px-3 py-2.5">
                    {t(`addTrades.manual.col.${qtyHeaderKey(assetClass)}`)}
                  </TableHeaderCell>
                  <TableHeaderCell className="px-3 py-2.5">{t('addTrades.manual.col.side')}</TableHeaderCell>
                  <TableHeaderCell className="px-3 py-2.5">{t('addTrades.manual.col.positionSize')}</TableHeaderCell>
                  <TableHeaderCell className="px-3 py-2.5">{t('addTrades.manual.col.price')}</TableHeaderCell>
                  <TableHeaderCell className="px-3 py-2.5">{t('addTrades.manual.col.comm')}</TableHeaderCell>
                  <TableHeaderCell className="w-16 py-2.5 pl-3 pr-5" />
                </TableHeadRow>
              </TableHead>
              <TableBody>
                {execs.map((r) => (
                  <TableRow key={r.id} className="border-b-0 border-t border-border align-middle">
                    <TableCell className="px-3 py-2 max-w-[1rem]">
                      <DateTimeField value={r.dateTime} onChange={(v) => update(r.id, { dateTime: v })} />
                    </TableCell>
                    <TableCell className="px-3 py-2 w-24">
                      <input
                        inputMode="decimal"
                        value={r.multiplier}
                        onChange={(e) => update(r.id, { multiplier: e.target.value })}
                        placeholder="0"
                        className={cn(cellInput, 'tabular')}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2 w-24">
                      <input
                        inputMode="decimal"
                        value={r.qty}
                        onChange={(e) => {
                          // Typing into the entry row's own qty is a manual
                          // override — stop letting the stop/risk calculator
                          // below overwrite it.
                          if (execs[0]?.id === r.id) setQtyAuto(false)
                          update(r.id, { qty: e.target.value })
                        }}
                        placeholder="0"
                        className={cn(cellInput, 'tabular')}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <div className="inline-flex rounded-md bg-muted/50 p-0.5">
                        {(['buy', 'sell'] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => update(r.id, { side: s })}
                            className={cn(
                              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                              r.side === s
                                ? s === 'buy'
                                  ? 'bg-profit/20 text-profit'
                                  : 'bg-loss/20 text-loss'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {t(`addTrades.manual.${s}`)}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2 w-28 tabular text-sm">
                      {(() => {
                        // Position size = quantity × price for this fill (not the
                        // share/contract count alone) — positive for a BUY,
                        // negative for a SELL.
                        const q = num(r.qty)
                        const p = num(r.price)
                        if (q <= 0 || p <= 0) return <span className="text-muted-foreground">—</span>
                        const signed = (r.side === 'buy' ? q : -q) * p
                        return (
                          <span className={signed >= 0 ? 'text-profit' : 'text-loss'}>
                            {signed >= 0 ? '+' : ''}
                            {formatCurrency(signed)}
                          </span>
                        )
                      })()}
                    </TableCell>
                    <TableCell className="px-3 py-2 w-28">
                      <input
                        inputMode="decimal"
                        value={r.price}
                        onChange={(e) => update(r.id, { price: e.target.value })}
                        placeholder="0.00"
                        className={cn(cellInput, 'tabular')}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2 w-24">
                      <input
                        inputMode="decimal"
                        value={r.comm}
                        onChange={(e) => update(r.id, { comm: e.target.value })}
                        placeholder="0.00"
                        className={cn(cellInput, 'tabular')}
                      />
                    </TableCell>
                    <TableCell className="w-16 pl-3 pr-4 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setExecs((rows) => rows.filter((x) => x.id !== r.id))}
                        disabled={execs.length === 1}
                        className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-loss disabled:pointer-events-none disabled:opacity-30"
                        aria-label={t('addTrades.manual.removeExecution')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-b-0 border-t border-border">
                  <TableCell colSpan={8} className="px-4 py-3">
                    <button
                      type="button"
                      onClick={addRow}
                      className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    >
                      <Plus className="h-4 w-4" />
                      {t('addTrades.manual.createExecution')}
                    </button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {/* Live "trade management" summary — position size + realized P&L, updated on every row change */}
          <TradeSummaryStats summary={summary} className="mt-5" />
        </>
      )}

      {/* Footer */}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push(cancelHref ?? `/trade-import/method?broker=${brokerId}&account=${accountId}`)}
          className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          {t('addTrades.common.cancel')}
        </button>
        <button
          type="button"
          disabled={!canSave || saving}
          onClick={() => save(true)}
          className={cn(
            'rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors',
            canSave && !saving
              ? 'border-primary/50 text-primary hover:bg-primary/10'
              : 'cursor-not-allowed border-border text-muted-foreground',
          )}
        >
          {t('addTrades.manual.saveAndNext')}
        </button>
        <button
          type="button"
          disabled={!canSave || saving}
          onClick={() => save(false)}
          className={cn(
            'flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors',
            canSave && !saving
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'cursor-not-allowed bg-muted text-muted-foreground',
          )}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('addTrades.manual.save')}
        </button>
      </div>
    </div>
  )
}
