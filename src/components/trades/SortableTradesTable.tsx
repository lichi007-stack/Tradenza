'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import DataTable, { type DataTableColumn } from '@/components/ui/DataTable'
import ReviewChips from '@/components/adherence/ReviewChips'
import { formatCurrency, cn } from '@/lib/utils'
import type { BlockReview } from '@/lib/adherence'
import { t } from '@/i18n'

export interface TradeTableRow {
  id: string
  symbol: string
  direction: string
  status: string
  netPnl: number | null
  entryDatetime: string
  /** Optional: when present, the table gains a review column. */
  review?: BlockReview[]
  /** The review window has closed, so nothing here is outstanding. */
  reviewLocked?: boolean
}

function formatDate(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-CA')
}

function pnlClass(v: number | null): string | undefined {
  if (v === null || v === 0) return undefined
  return v > 0 ? 'text-profit' : 'text-loss'
}

interface Props {
  trades: TradeTableRow[]
  storageKey: string
  /** i18n prefix for column labels, e.g. `strategies.detail.columns` */
  columnsKey: string
  /** When set, rows navigate to `${rowBasePath}/${id}` on click. Serializable so
      it can be passed from a Server Component. */
  rowBasePath?: string
}

/** Unreviewed blocks first when ascending, which turns the column into a queue. */
const pendingCount = (r: TradeTableRow): number =>
  r.reviewLocked ? 0 : (r.review ?? []).filter((s) => s.applicable && !s.reviewed).length

export default function SortableTradesTable({ trades, storageKey, columnsKey, rowBasePath }: Props) {
  const router = useRouter()
  const showReview = trades.some((r) => r.review && r.review.some((s) => s.applicable))

  const columns = useMemo<DataTableColumn<TradeTableRow>[]>(() => {
    const col = (name: string) => t(`${columnsKey}.${name}`)
    return [
      {
        key: 'symbol',
        header: col('symbol'),
        sortable: true,
        sortValue: (r) => r.symbol.toLowerCase(),
        cellClassName: 'font-medium',
        cell: (r) => r.symbol,
      },
      {
        key: 'direction',
        header: col('direction'),
        sortable: true,
        sortValue: (r) => r.direction.toLowerCase(),
        cellClassName: 'capitalize text-muted-foreground',
        cell: (r) => r.direction,
      },
      {
        key: 'status',
        header: col('status'),
        sortable: true,
        sortValue: (r) => r.status.toLowerCase(),
        cellClassName: 'capitalize text-muted-foreground',
        cell: (r) => r.status,
      },
      {
        key: 'entryDatetime',
        header: col('entry'),
        sortable: true,
        initialSortDir: 'desc',
        sortValue: (r) => new Date(r.entryDatetime).getTime(),
        cellClassName: 'whitespace-nowrap text-muted-foreground',
        cell: (r) => formatDate(r.entryDatetime),
      },
      ...(showReview
        ? [
            {
              key: 'review',
              header: t('trades.col.review'),
              sortable: true,
              sortValue: (r: TradeTableRow) => -pendingCount(r),
              cell: (r: TradeTableRow) => (
                <ReviewChips
                  states={r.review ?? []}
                  locked={r.reviewLocked}
                  href={`${rowBasePath ?? '/trades'}/${r.id}?tab=playbook`}
                />
              ),
            } satisfies DataTableColumn<TradeTableRow>,
          ]
        : []),
      {
        key: 'netPnl',
        header: col('netPnl'),
        sortable: true,
        align: 'right',
        initialSortDir: 'desc',
        // Trades without a P&L sort to the bottom of a descending list.
        sortValue: (r) => r.netPnl ?? Number.NEGATIVE_INFINITY,
        cellClassName: (r) => cn('tabular-nums', pnlClass(r.netPnl)),
        cell: (r) => (r.netPnl === null ? '—' : formatCurrency(r.netPnl)),
      },
    ]
  }, [columnsKey, showReview, rowBasePath])

  return (
    <DataTable
      columns={columns}
      data={trades}
      rowKey={(r) => r.id}
      sortStorageKey={storageKey}
      defaultSort={{ by: 'entryDatetime', order: 'desc' }}
      onRowClick={rowBasePath ? (r) => router.push(`${rowBasePath}/${r.id}`) : undefined}
    />
  )
}
