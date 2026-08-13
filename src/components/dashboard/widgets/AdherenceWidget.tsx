'use client'

import { memo, useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardCheck, Gauge } from 'lucide-react'
import ProgressRing from '@/components/progress/ProgressRing'
import VerdictBanner from '@/components/adherence/VerdictBanner'
import { blockMeta, pctText } from '@/components/adherence/blockMeta'
import { getAdherenceSnapshot, type AdherenceSnapshot } from '@/lib/actions/adherence'
import { useDashboardData } from '@/components/dashboard/DashboardDataContext'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { WidgetShell, WidgetEmpty } from './shared'

/**
 * Which block is slipping and how many trades still wait for review. Fetches its own data,
 * so a user who never places the widget doesn't pay for the query.
 */
function AdherenceWidget() {
  const [data, setData] = useState<AdherenceSnapshot | null>(null)
  const [failed, setFailed] = useState(false)
  // The shared payload's identity changes on every server re-render (i.e. on a filter
  // change), which is what keeps this self-fetched slice in step.
  const { data: shared } = useDashboardData()

  useEffect(() => {
    let cancelled = false
    getAdherenceSnapshot()
      .then((res) => !cancelled && setData(res))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [shared])

  return (
    <WidgetShell
      title={t('dashboard.widgets.adherence.label')}
      icon={<Gauge className="h-3.5 w-3.5 text-muted-foreground" />}
      className="h-full min-h-[20rem]"
      bodyClassName="flex flex-col gap-3 px-4 pb-4 pt-1"
    >
      {failed ? (
        <WidgetEmpty label={t('dashboard.noData')} />
      ) : !data ? (
        <div className="flex-1 animate-pulse rounded-lg bg-muted/40" />
      ) : data.definedCriteria === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{t('adherence.empty.description')}</p>
          <Link
            href="/strategies?tab=criteria"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
          >
            {t('adherence.empty.cta')}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {data.summaries.map((summary) => {
              const meta = blockMeta(summary.block)
              return (
                <div key={summary.block} className="flex flex-col items-center gap-1.5">
                  <ProgressRing
                    ratio={summary.adherencePct === null ? 0 : summary.adherencePct / 100}
                    neutral={summary.adherencePct === null}
                    size={58}
                    label={pctText(summary.adherencePct)}
                    sublabel={meta.letter}
                  />
                  <span className="flex items-center gap-1 text-center text-[11px] leading-tight text-muted-foreground">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dotClass)} />
                    <span className="truncate">{meta.short}</span>
                  </span>
                  {/* Coverage never travels apart from adherence — see lib/adherence. */}
                  <span className="text-[10px] tabular-nums text-muted-foreground/70">
                    {summary.scoredTrades}/{summary.applicableTrades}
                  </span>
                </div>
              )
            })}
          </div>

          <VerdictBanner verdict={data.verdict} className="text-xs" href="/strategies?tab=adherence" />

          {data.toReview > 0 && (
            <Link
              href="/trades?review=pending"
              className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              {t('trades.review.filter', { count: data.toReview })}
            </Link>
          )}
        </>
      )}
    </WidgetShell>
  )
}

export default memo(AdherenceWidget)
