import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import { getStrategyDetail } from '@/lib/actions/strategies'
import StrategyEquityChart from '@/components/strategies/StrategyEquityChart'
import StrategyDetailActions from '@/components/strategies/StrategyDetailActions'
import StrategyImageGallery from '@/components/strategies/StrategyImageGallery'
import SortableTradesTable from '@/components/trades/SortableTradesTable'
import BlockSection from '@/components/adherence/BlockSection'
import VerdictBanner from '@/components/adherence/VerdictBanner'
import { blockMeta } from '@/components/adherence/blockMeta'
import { formatCurrency, cn } from '@/lib/utils'
import { sanitizeRichText } from '@/lib/rich-text'
import { CHECKLIST_BLOCKS, type ChecklistBlock } from '@/lib/adherence'
import { t } from '@/i18n'

export const metadata: Metadata = { title: t('strategies.title') }
export const dynamic = 'force-dynamic'

function pnlClass(v: number): string | undefined {
  if (v === 0) return undefined
  return v > 0 ? 'text-profit' : 'text-loss'
}

export default async function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getStrategyDetail(id)
  if (!detail) notFound()

  const { strategy, stats, curve, adherence, criteria, recentTrades } = detail
  const hasData = stats.totalTrades > 0
  const hasImages = strategy.imageUrls.length > 0
  const hasCriteria = criteria.length > 0

  return (
    <div className="p-4 sm:p-6 w-full animate-in">
      <Link
        href="/strategies"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('strategies.detail.back')}
      </Link>

      <div className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 text-xl font-semibold tracking-tight">{strategy.name}</h1>
          <StrategyDetailActions strategy={strategy} />
        </div>
        {strategy.description && (
          <div className="bg-card rounded-lg mt-4 p-4">
            <div
              className="rte mt-2 w-full text-sm text-foreground"
              dangerouslySetInnerHTML={{ __html: sanitizeRichText(strategy.description) }}
            />
          </div>
        )}
      </div>

      {/* Playbook definition — the criteria in force today, grouped by block. */}
      {(hasCriteria || hasImages) && (
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start">
          {hasCriteria && (
            <div className="w-full space-y-4 rounded-xl border border-border bg-card p-4 lg:flex-1">
              {CHECKLIST_BLOCKS.filter((b) => criteria.some((c) => c.block === b)).map((block) => (
                <CriteriaList key={block} block={block} items={criteria.filter((c) => c.block === block)} />
              ))}
            </div>
          )}
          {hasImages && (
            <div className="w-full rounded-xl border border-border bg-card p-4 lg:flex-1">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('strategies.detail.referenceTitle')}
              </h2>
              <StrategyImageGallery images={strategy.imageUrls} />
            </div>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t('strategies.stats.trades')} value={String(stats.totalTrades)} />
        <Tile
          label={t('strategies.stats.netPnl')}
          value={formatCurrency(stats.totalPnl)}
          valueClass={pnlClass(stats.totalPnl)}
        />
        <Tile label={t('strategies.stats.winRate')} value={hasData ? `${Math.round(stats.winPct)}%` : '—'} />
        <Tile label={t('strategies.stats.expectancy')} value={hasData ? formatCurrency(stats.tradeExpectancy) : '—'} />
        <Tile label={t('strategies.stats.avgR')} value={hasData ? `${stats.avgRealizedR.toFixed(2)}R` : '—'} />
        <Tile
          label={t('strategies.stats.profitFactor')}
          value={hasData && Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '—'}
        />
      </div>

      {/* Adherence, per block. The universal gate and exit criteria are scored against
          THIS strategy's trades on purpose — "my exit falls apart on this one setup" is
          one of the most useful sentences the model can produce. */}
      {hasData && (
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">{t('adherence.title')}</h2>
            <Link
              href="/strategies?tab=adherence"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('strategies.detail.adherenceAllLink')}
            </Link>
          </div>
          <VerdictBanner verdict={adherence.verdict} />
          {adherence.blocks.map((block) => (
            <BlockSection key={block.block} analytics={block} />
          ))}
        </div>
      )}

      {/* Equity curve */}
      {curve.length > 1 && (
        <div className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">{t('strategies.detail.equity')}</h2>
          <div className="h-64 rounded-xl border border-border bg-card p-3">
            <StrategyEquityChart data={curve} />
          </div>
        </div>
      )}

      {/* Recent trades */}
      <div className="mb-4">
        <h2 className="mb-3 text-sm font-semibold">{t('strategies.detail.recent')}</h2>
        {recentTrades.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            {t('strategies.detail.noTrades')}
          </div>
        ) : (
          <SortableTradesTable
            trades={recentTrades}
            storageKey="tradenza-strategy-trades-sort"
            columnsKey="strategies.detail.columns"
            rowBasePath="/trades"
          />
        )}
      </div>
    </div>
  )
}

function CriteriaList({
  block,
  items,
}: {
  block: ChecklistBlock
  items: { id: string; label: string; definition: string | null; universal: boolean }[]
}) {
  const meta = blockMeta(block)
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dotClass)} />
        {meta.name}
      </h2>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm leading-snug">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
            <span>
              {item.label}
              {item.definition && <span className="block text-xs text-muted-foreground">{item.definition}</span>}
            </span>
            {item.universal && (
              <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('adherence.universal')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Tile({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className={cn('text-lg font-semibold tabular-nums', valueClass)}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
