'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { getActionErrorMessage } from '@/lib/action-error-message'
import { handleRateLimit } from '@/components/ui/rate-limit-toast'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { updateTradeExecutions } from '@/lib/actions/trades'
import { editorDefaultMultiplier } from '@/lib/futures'
import { calcStockCommission } from '@/lib/commission'
import DateTimeField from '@/components/ui/DateTimeField'
import Modal from '@/components/ui/Modal'
import { normalizeExecutions, positionState, storedMultiplier } from '@/components/trades/detail/executions'
import type { Trade } from '@/lib/db'

const num = (s: string) => {
  const n = parseFloat(s.replace(',', '.'))
  return isNaN(n) ? 0 : n
}
const pad = (n: number) => String(n).padStart(2, '0')
const nowLocalInput = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const autoCommEnabled = (assetClass: string) => assetClass === 'stocks'

const cellCls =
  'w-full rounded-md border border-border bg-input/40 px-2 py-1.5 text-sm tabular focus:border-primary focus:outline-none'
const miniLabel = 'mb-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground'

/**
 * A one-field-set shortcut to "add an execution to this trade", opened straight
 * from the trades list — the full round trip used to be trade row → trade
 * detail page → Executions tab → New execution, which is a lot of clicks for
 * the single most common action (adding the fill that closes out the rest of
 * an open position). This reuses the exact same save path
 * (updateTradeExecutions) and defaulting rules as ExecutionsEditor's "New
 * execution" — quantity defaults to whatever is left open, price defaults to
 * the live quote already fetched for the trades table — so the two stay in
 * sync without duplicating the persistence logic.
 */
export default function QuickAddExecutionDialog({
  trade,
  currentPrice,
  onClose,
  onSaved,
}: {
  trade: Trade
  currentPrice: number | null | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const executions = normalizeExecutions(trade)
  const { entrySide, openQty } = positionState(executions.map((e) => ({ time: e.time, side: e.side, quantity: e.quantity })))
  const isOpen = openQty > 0
  const closingSide: 'buy' | 'sell' = entrySide === 'buy' ? 'sell' : 'buy'
  const initialSide = isOpen ? closingSide : entrySide
  const initialQty = isOpen ? String(openQty) : ''
  const autoComm = autoCommEnabled(trade.assetClass)

  const [datetime, setDatetime] = useState(nowLocalInput())
  const [side, setSide] = useState<'buy' | 'sell'>(initialSide)
  const [qty, setQty] = useState(initialQty)
  const [price, setPrice] = useState(typeof currentPrice === 'number' ? String(currentPrice) : '')
  const [comm, setComm] = useState(
    autoComm && num(initialQty) > 0 ? String(calcStockCommission(num(initialQty))) : '',
  )
  const [commAuto, setCommAuto] = useState(true)
  const [saving, setSaving] = useState(false)

  const handleQtyChange = (v: string) => {
    setQty(v)
    if (commAuto && autoComm) {
      const q = num(v)
      setComm(q > 0 ? String(calcStockCommission(q)) : '')
    }
  }
  const handleCommChange = (v: string) => {
    setComm(v)
    setCommAuto(false)
  }

  const multiplier = storedMultiplier(trade) ?? editorDefaultMultiplier(trade.assetClass, trade.symbol)

  const projectedOpenQty = (() => {
    if (!datetime || num(qty) <= 0) return openQty
    const next = positionState([
      ...executions.map((e) => ({ time: e.time, side: e.side, quantity: e.quantity })),
      { time: Math.floor(new Date(datetime).getTime() / 1000), side, quantity: num(qty) },
    ])
    return next.openQty
  })()

  const isValid = !!datetime && !isNaN(new Date(datetime).getTime()) && num(qty) > 0 && num(price) > 0

  const save = async () => {
    if (!isValid || saving) return
    setSaving(true)
    try {
      const nextExecutions = [
        ...executions.map((e) => ({
          datetime: new Date(e.time * 1000).toISOString(),
          side: e.side,
          quantity: e.quantity,
          price: e.price,
          commission: e.commission,
          fee: e.fee,
        })),
        {
          datetime: new Date(datetime).toISOString(),
          side,
          quantity: num(qty),
          price: num(price),
          commission: num(comm),
          fee: 0,
        },
      ]
      const res = await updateTradeExecutions(trade.id, {
        contractMultiplier: multiplier || undefined,
        executions: nextExecutions,
      })
      if (handleRateLimit(res)) return
      toast.success(t('trades.detail.exec.saved'))
      onSaved()
      onClose()
    } catch (e) {
      toast.error(getActionErrorMessage(e, 'trades.detail.exec.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t('trades.quickAdd.title', { symbol: trade.symbol })}
      onClose={onClose}
      onConfirm={save}
      confirmLabel={t('trades.detail.exec.save')}
      confirmDisabled={!isValid || saving}
      cancelLabel={t('trades.detail.exec.cancel')}
      className="max-w-sm"
    >
      <div>
        <label className={miniLabel}>{t('trades.detail.exec.time')}</label>
        <DateTimeField value={datetime} onChange={setDatetime} />
      </div>
      <div>
        <label className={miniLabel}>{t('trades.detail.exec.side')}</label>
        <div className="inline-flex rounded-md bg-muted/50 p-0.5">
          {(['buy', 'sell'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={cn(
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                side === s
                  ? s === 'buy'
                    ? 'bg-profit/20 text-profit'
                    : 'bg-loss/20 text-loss'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`trades.detail.exec.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={miniLabel}>{t('trades.detail.exec.qty')}</label>
          <input
            autoFocus
            inputMode="decimal"
            value={qty}
            onChange={(e) => handleQtyChange(e.target.value)}
            className={cellCls}
          />
        </div>
        <div>
          <label className={miniLabel}>{t('trades.detail.exec.price')}</label>
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={cellCls}
          />
        </div>
        <div>
          <label className={miniLabel}>{t('trades.detail.exec.commission')}</label>
          <input
            inputMode="decimal"
            value={comm}
            onChange={(e) => handleCommChange(e.target.value)}
            className={cellCls}
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {projectedOpenQty <= 0
          ? t('trades.detail.exec.willClose')
          : t('trades.detail.exec.willRemain', { qty: projectedOpenQty })}
      </p>
    </Modal>
  )
}
