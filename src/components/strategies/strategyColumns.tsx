import type { DataTableColumn } from '@/components/ui/DataTable'
import type { StrategyOverviewRow } from '@/lib/actions/strategies'
import { formatCurrency, cn } from '@/lib/utils'
import { t } from '@/i18n'

export const winRateText = (s: StrategyOverviewRow) => (s.tradeCount > 0 ? `${Math.round(s.winRate)}%` : '—')

/**
 * The weakest block, named — an average would hide exactly what the split exists to reveal.
 * Says "not evaluated" rather than 0% when nothing has been assessed.
 */
export const weakestBlockText = (s: StrategyOverviewRow) =>
  s.weakestBlock === null || !s.weakestBlockKey
    ? t('strategies.weakest.none')
    : t('strategies.weakest.label', {
        block: t(`adherence.blocks.${s.weakestBlockKey}.letter`) + ':',
        pct: Math.round(s.weakestBlock),
      })

export const strategyColumns: DataTableColumn<StrategyOverviewRow>[] = [
  {
    key: 'name',
    header: t('strategies.list.name'),
    sortable: true,
    cellClassName: 'font-medium',
    cell: (s) => s.name,
  },
  {
    key: 'tradeCount',
    header: t('strategies.stats.trades'),
    sortable: true,
    align: 'right',
    cellClassName: 'tabular-nums',
    cell: (s) => s.tradeCount,
  },
  {
    key: 'netPnl',
    header: t('strategies.stats.netPnl'),
    sortable: true,
    align: 'right',
    cellClassName: (s) => cn('tabular-nums', s.netPnl > 0 ? 'text-profit' : s.netPnl < 0 ? 'text-loss' : undefined),
    cell: (s) => formatCurrency(s.netPnl),
  },
  {
    key: 'winRate',
    header: t('strategies.stats.winRate'),
    sortable: true,
    align: 'right',
    cellClassName: 'tabular-nums text-muted-foreground',
    cell: winRateText,
  },
  {
    key: 'weakestBlock',
    header: t('strategies.stats.weakestBlock'),
    sortable: true,
    align: 'right',
    cellClassName: 'tabular-nums text-muted-foreground',
    cell: weakestBlockText,
  },
]
