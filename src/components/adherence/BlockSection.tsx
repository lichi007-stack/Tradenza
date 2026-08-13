import { Info } from 'lucide-react'
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
import Tooltip from '@/components/ui/Tooltip'
import { formatCurrency, cn } from '@/lib/utils'
import { ITEM_STATS_MIN_SAMPLE, MIN_SAMPLE, type BlockAnalytics, type ItemPerformance } from '@/lib/adherence'
import { blockMeta, pctText } from './blockMeta'
import { t } from '@/i18n'

// One block's numbers. Adherence never appears without its coverage, and the per-criterion
// table is withheld below ITEM_STATS_MIN_SAMPLE — compare a dozen criteria at once and
// some separate by chance.

const asMoney = (v: number | null): string => (v === null ? '—' : formatCurrency(v))

function pnlClass(v: number | null): string | undefined {
  if (v === null || v === 0) return undefined
  return v > 0 ? 'text-profit' : 'text-loss'
}

export default function BlockSection({ analytics }: { analytics: BlockAnalytics }) {
  const meta = blockMeta(analytics.block)
  if (analytics.applicableTrades === 0 && analytics.items.length === 0) return null

  const remaining = ITEM_STATS_MIN_SAMPLE - analytics.scoredTrades

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dotClass)} />
          <h3 className="text-sm font-semibold">{meta.name}</h3>
          <Tooltip label={<span className="block max-w-xs font-normal">{meta.hint}</span>}>
            <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Tooltip>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tabular-nums">{pctText(analytics.adherencePct)}</span>
          <span className="text-xs text-muted-foreground">
            {t('adherence.coverage', { scored: analytics.scoredTrades, total: analytics.applicableTrades })}
          </span>
        </div>
      </div>

      {!analytics.itemStatsReady ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {t('adherence.sample.needMore', { remaining: Math.max(1, remaining) })}
        </p>
      ) : (
        <>
          <TableContainer bordered={false}>
            <Table>
              <TableHead>
                <TableHeadRow className="bg-transparent uppercase tracking-wide">
                  <TableHeaderCell className="py-2 pl-0 pr-3">{t('adherence.table.criterion')}</TableHeaderCell>
                  <TableHeaderCell align="right" className="px-3 py-2">
                    {t('adherence.table.followed')}
                  </TableHeaderCell>
                  <TableHeaderCell align="right" className="px-3 py-2">
                    {t('adherence.table.winFollowed')}
                  </TableHeaderCell>
                  <TableHeaderCell align="right" className="px-3 py-2">
                    {t('adherence.table.winSkipped')}
                  </TableHeaderCell>
                  <TableHeaderCell align="right" className="px-3 py-2">
                    {t('adherence.table.pnlFollowed')}
                  </TableHeaderCell>
                  <TableHeaderCell align="right" className="py-2 pl-3 pr-0">
                    {t('adherence.table.pnlSkipped')}
                  </TableHeaderCell>
                </TableHeadRow>
              </TableHead>
              <TableBody>
                {analytics.items.map((item) => (
                  <CriterionRow key={item.itemId} item={item} />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {analytics.items.some((i) => i.separated) && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('adherence.table.separatedNote')}</p>
          )}
        </>
      )}
    </div>
  )
}

function CriterionRow({ item }: { item: ItemPerformance }) {
  const skipped = item.total - item.followed
  // Under MIN_SAMPLE the side is faded: shown for completeness, not to act on.
  const followedThin = item.followed < MIN_SAMPLE
  const skippedThin = skipped < MIN_SAMPLE
  const thin = 'text-muted-foreground/40'

  return (
    <TableRow className="border-border">
      <TableCell className="py-2 pl-0 pr-3">
        <span className="flex items-start gap-1.5">
          <span className={cn('leading-snug', item.separated && 'font-medium')}>{item.label}</span>
          {item.definition && (
            <Tooltip label={<span className="block max-w-xs font-normal">{item.definition}</span>}>
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Tooltip>
          )}
          {item.strategyId === null && (
            <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('adherence.universal')}
            </span>
          )}
        </span>
      </TableCell>
      <TableCell align="right" className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
        {item.followed}/{item.total} · {Math.round(item.followedPct)}%
      </TableCell>
      <TableCell align="right" className={cn('px-3 py-2 tabular-nums', followedThin && thin)}>
        {pctText(item.winRateFollowed)}
      </TableCell>
      <TableCell align="right" className={cn('px-3 py-2 tabular-nums text-muted-foreground', skippedThin && thin)}>
        {pctText(item.winRateMissed)}
      </TableCell>
      <TableCell
        align="right"
        className={cn('px-3 py-2 tabular-nums', followedThin ? thin : pnlClass(item.avgPnlFollowed))}
      >
        {asMoney(item.avgPnlFollowed)}
      </TableCell>
      <TableCell
        align="right"
        className={cn('py-2 pl-3 pr-0 tabular-nums', skippedThin ? thin : pnlClass(item.avgPnlMissed))}
      >
        {asMoney(item.avgPnlMissed)}
      </TableCell>
    </TableRow>
  )
}
