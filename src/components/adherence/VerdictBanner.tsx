import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, Compass, Hourglass } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ADHERENCE_TARGET, type AdherenceVerdict } from '@/lib/adherence'
import { blockMeta } from './blockMeta'
import { t } from '@/i18n'

// The diagnosis as one sentence, plus the figure behind it — a verdict without its number
// asks to be believed, one with it can be checked.
export default function VerdictBanner({
  verdict,
  className,
  href,
  linkLabel,
}: {
  verdict: AdherenceVerdict
  className?: string
  href?: string
  linkLabel?: string
}) {
  const message =
    verdict.kind === 'smallSample'
      ? t('adherence.verdict.smallSample', { remaining: verdict.remaining })
      : verdict.kind === 'thin'
        ? t('adherence.verdict.thin', {
            block: blockMeta(verdict.block).name,
            remaining: verdict.remaining,
          })
        : t(`adherence.verdict.${verdict.kind}`)

  const stat =
    verdict.kind === 'gate' || verdict.kind === 'setup' || verdict.kind === 'exit'
      ? t('adherence.verdict.stat', {
          block: blockMeta(verdict.kind).name,
          pct: Math.round(verdict.pct),
          count: verdict.trades,
          target: ADHERENCE_TARGET,
        })
      : verdict.kind === 'thin'
        ? t('adherence.verdict.stat', {
            block: blockMeta(verdict.block).name,
            pct: Math.round(verdict.pct),
            count: verdict.trades,
            target: ADHERENCE_TARGET,
          })
        : verdict.kind === 'playbook'
          ? t('adherence.verdict.playbookStat', { trades: verdict.trades })
          : null

  const tone = {
    noData: 'border-border bg-muted/30 text-muted-foreground',
    gate: 'border-loss/40 bg-loss/10 text-foreground',
    setup: 'border-amber-500/40 bg-amber-500/10 text-foreground',
    exit: 'border-amber-500/40 bg-amber-500/10 text-foreground',
    playbook: 'border-loss/40 bg-loss/10 text-foreground',
    // Neutral on purpose: "not enough evidence" is not a warning about the trading.
    thin: 'border-border bg-muted/30 text-foreground',
    smallSample: 'border-border bg-muted/30 text-foreground',
    clean: 'border-primary/40 bg-primary/10 text-foreground',
  }[verdict.kind]

  const Icon = {
    noData: Compass,
    gate: AlertTriangle,
    setup: Compass,
    exit: Compass,
    playbook: AlertTriangle,
    thin: Hourglass,
    smallSample: Hourglass,
    clean: CheckCircle2,
  }[verdict.kind]

  return (
    <div
      className={cn('flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm leading-relaxed', tone, className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-pretty">{message}</p>
        {(stat || href) && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {stat && (
              <span className="inline-flex rounded bg-background/60 px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {stat}
              </span>
            )}
            {href && (
              <Link
                href={href}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                {linkLabel ?? t('adherence.verdict.open')}
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
