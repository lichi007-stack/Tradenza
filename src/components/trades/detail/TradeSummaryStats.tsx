'use client'

import type { ReactNode } from 'react'
import { cn, formatCurrency } from '@/lib/utils'
import { t } from '@/i18n'
import type { TradeSummary } from './executions'

/**
 * The one "trade management" summary strip: position size, avg entry/exit,
 * fees, status and realized P&L. Rendered from a live `TradeSummary` — which
 * both the add-trade manual entry screen and the trade detail executions
 * editor recompute on every row change — so the numbers you see while adding
 * or editing executions are exactly what gets saved, in both places.
 */
export default function TradeSummaryStats({
  summary,
  className,
}: {
  summary: TradeSummary | null
  className?: string
}) {
  if (!summary) return null
  const { direction, openQty, avgEntry, avgExit, fees, status, netPnl } = summary

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm',
        className,
      )}
    >
      <Stat label={t('trades.detail.summary.direction')}>
        <span className={cn('font-medium uppercase', direction === 'long' ? 'text-profit' : 'text-loss')}>
          {t(`trades.detail.summary.${direction}`)}
        </span>
      </Stat>

      <Stat label={t('trades.detail.summary.positionSize')}>
        <span className={cn('font-medium tabular', openQty !== 0 ? 'text-primary' : 'text-muted-foreground')}>
          {openQty !== 0 ? t('trades.detail.exec.openQty', { qty: openQty }) : t('trades.detail.exec.flat')}
        </span>
      </Stat>

      <Stat label={t('trades.detail.summary.avgEntry')}>
        <span className="font-medium tabular">{avgEntry.toLocaleString()}</span>
      </Stat>

      {avgExit !== null && (
        <Stat label={t('trades.detail.summary.avgExit')}>
          <span className="font-medium tabular">{avgExit.toLocaleString()}</span>
        </Stat>
      )}

      <Stat label={t('trades.detail.summary.fees')}>
        <span className="font-medium tabular">{fees.toLocaleString()}</span>
      </Stat>

      <Stat label={t('trades.detail.summary.status')}>
        <span className="font-medium">{t(`trades.detail.summary.${status}`)}</span>
      </Stat>

      {netPnl !== null && (
        <Stat label={t('trades.detail.summary.realizedPnl')} className="ml-auto">
          <span className={cn('font-semibold tabular', netPnl >= 0 ? 'text-profit' : 'text-loss')}>
            {formatCurrency(netPnl)}
          </span>
        </Stat>
      )}
    </div>
  )
}

function Stat({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <span className={className}>
      <span className="text-muted-foreground">{label}: </span>
      {children}
    </span>
  )
}
