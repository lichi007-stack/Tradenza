'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Check, CheckCheck, Clock, Info, Lock, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import Tooltip from '@/components/ui/Tooltip'
import { toast } from 'sonner'
import { getActionErrorMessage } from '@/lib/action-error-message'
import { handleRateLimit } from '@/components/ui/rate-limit-toast'
import { confirmTradeAllMet, setTradeBlockProgress, type TradeAdherence } from '@/lib/actions/adherence'
import type { StrategyDTO } from '@/lib/actions/strategies'
import type { NextReviewTrade } from '@/lib/actions/trades'
import { CHECKLIST_BLOCKS, type ChecklistBlock } from '@/lib/adherence'
import { blockMeta } from '@/components/adherence/blockMeta'
import StrategyPanel from './StrategyPanel'
import { t } from '@/i18n'

interface Current {
  id: string
  name: string
}

/**
 * The trade's adherence: three blocks, each reviewed or not. A block contributes nothing
 * until confirmed, and only then are unticked criteria drawn as failures.
 */
export default function AdherencePanel({
  tradeId,
  strategies,
  current,
  initial,
  nextToReview,
}: {
  tradeId: string
  strategies: StrategyDTO[]
  current: Current | null
  initial: TradeAdherence | null
  /** Next trade in the review queue, if any. */
  nextToReview?: NextReviewTrade | null
}) {
  return (
    <div className="space-y-4">
      <StrategyPanel tradeId={tradeId} strategies={strategies} current={current} />
      {/* No setup, no checklist. Adherence asks how faithfully you followed *a setup*, so
          until one is named there is nothing to score — see lib/adherence. The panel says
          that plainly instead of showing an empty list or the "define criteria" onboarding,
          neither of which is the thing standing in the way. */}
      {!current ? <NeedsStrategy /> : initial && <AdherenceCard tradeId={tradeId} initial={initial} />}
      {nextToReview && <NextInQueue next={nextToReview} />}
    </div>
  )
}

const NeedsStrategy = () => (
  <p className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
    {t('adherence.needsStrategy')}
  </p>
)

/** The way out of a finished review: straight into the next trade that needs one. */
function NextInQueue({ next }: { next: NextReviewTrade }) {
  return (
    <Link
      href={`/trades/${next.id}?tab=playbook`}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50"
    >
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{t('adherence.queue.next')}</span>
        <span className="block truncate text-sm font-medium">{next.symbol}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {next.remaining > 0 && t('adherence.queue.remaining', { count: next.remaining })}
        <ArrowRight className="h-4 w-4" />
      </span>
    </Link>
  )
}

function AdherenceCard({ tradeId, initial }: { tradeId: string; initial: TradeAdherence }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [progress, setProgress] = useState(initial.progress)

  // Adopt the server's answer after every confirmed write, so a failed mutation can't
  // leave a checkbox showing a state the database never took.
  useEffect(() => setProgress(initial.progress), [initial.progress])

  // Ticks land in local state and are flushed after a pause; only confirming a block —
  // the moment the page's other numbers change — refreshes the page.
  const progressRef = useRef(progress)
  useEffect(() => {
    progressRef.current = initial.progress
  }, [initial.progress])
  const dirty = useRef(new Set<ChecklistBlock>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(
    (refresh: boolean) => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const blocks = [...dirty.current]
      dirty.current.clear()
      if (blocks.length === 0) return
      startTransition(async () => {
        try {
          for (const block of blocks) {
            const b = progressRef.current.blocks[block]
            const res = await setTradeBlockProgress(tradeId, block, { met: b.met, scored: b.scored })
            if (handleRateLimit(res)) return
          }
          if (refresh) router.refresh()
        } catch (err) {
          // The window can shut mid-review: say so and re-render as the read-only record.
          toast.error(getActionErrorMessage(err, 'adherence.toast.saveError'))
          router.refresh()
        }
      })
    },
    [router, tradeId],
  )

  // Flush unsaved ticks on unmount, so navigating away mid-review loses nothing.
  useEffect(() => {
    const d = dirty.current
    return () => {
      for (const block of d) {
        const b = progressRef.current.blocks[block]
        void setTradeBlockProgress(tradeId, block, { met: b.met, scored: b.scored })
      }
    }
  }, [tradeId])

  const byBlock = useMemo(
    () => ({
      gate: initial.items.filter((i) => i.block === 'gate'),
      setup: initial.items.filter((i) => i.block === 'setup'),
      exit: initial.items.filter((i) => i.block === 'exit'),
    }),
    [initial.items],
  )

  // Criteria written after this trade: shown so they aren't missed, never scored.
  const pendingByBlock = useMemo(
    () => ({
      gate: initial.pending.filter((i) => i.block === 'gate'),
      setup: initial.pending.filter((i) => i.block === 'setup'),
      exit: initial.pending.filter((i) => i.block === 'exit'),
    }),
    [initial.pending],
  )

  // The ref is updated first, synchronously, so a flush can't read a stale version.
  const apply = (next: typeof progress) => {
    progressRef.current = next
    setProgress(next)
  }

  const toggle = (block: ChecklistBlock, itemId: string) => {
    const p = progressRef.current
    const met = p.blocks[block].met
    const nextMet = met.includes(itemId) ? met.filter((id) => id !== itemId) : [...met, itemId]
    apply({ ...p, blocks: { ...p.blocks, [block]: { ...p.blocks[block], met: nextMet } } })
    dirty.current.add(block)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(false), 600)
  }

  /** Immediate write + refresh — the confirm path, where the page's numbers change. */
  const persist = (block: ChecklistBlock, met: string[], scored: boolean) => {
    const p = progressRef.current
    apply({
      ...p,
      blocks: {
        ...p.blocks,
        [block]: { ...p.blocks[block], met, scored, scoredAt: scored ? new Date().toISOString() : null },
      },
    })
    dirty.current.add(block)
    flush(true)
  }

  // The most common review by far, so it costs one click. Blocks stay editable afterwards.
  const confirmAll = () => {
    if (timer.current) clearTimeout(timer.current)
    dirty.current.clear()
    const now = new Date().toISOString()
    const p = progressRef.current
    const blocks = { ...p.blocks }
    for (const block of CHECKLIST_BLOCKS) {
      if (byBlock[block].length === 0) continue
      blocks[block] = { scored: true, met: byBlock[block].map((i) => i.id), scoredAt: now }
    }
    apply({ ...p, blocks })
    startTransition(async () => {
      try {
        const res = await confirmTradeAllMet(tradeId)
        if (handleRateLimit(res)) return
      } catch (err) {
        toast.error(getActionErrorMessage(err, 'adherence.toast.saveError'))
      }
      router.refresh()
    })
  }

  // Hours are enough — a live-ticking countdown would be noise.
  const hoursLeft = Math.max(1, Math.ceil(initial.windowLeftMs / 3_600_000))
  const windowLeftLabel = t('adherence.window.hours', { count: hoursLeft })

  // The genuine empty state. A trade that merely predates every criterion falls through to
  // the block cards, where the "added after this trade" note explains itself.
  if (initial.items.length === 0 && initial.pending.length === 0) return <EmptyCriteria />

  const fullyConfirmed = CHECKLIST_BLOCKS.every(
    (b) =>
      byBlock[b].length === 0 ||
      (progress.blocks[b].scored && byBlock[b].every((i) => progress.blocks[b].met.includes(i.id))),
  )

  return (
    <div className="space-y-3">
      {/* The window, stated where the work happens: a countdown while it is open, a plain
          "closed" once it isn't. Adherence is a record of what you decided at the time,
          so the moment it stops being editable is worth showing, not hiding. */}
      <p
        className={cn(
          'flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-relaxed',
          initial.locked
            ? 'border-border bg-muted/30 text-muted-foreground'
            : 'border-dashed border-border bg-card/40 text-muted-foreground',
        )}
      >
        {initial.locked ? (
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        {initial.locked ? t('adherence.window.locked') : t('adherence.window.open', { left: windowLeftLabel })}
      </p>

      {!initial.locked && !fullyConfirmed && (
        <button
          type="button"
          onClick={confirmAll}
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
        >
          <CheckCheck className="h-4 w-4" />
          {t('adherence.action.confirmAll')}
        </button>
      )}
      {CHECKLIST_BLOCKS.filter((b) => byBlock[b].length > 0 || pendingByBlock[b].length > 0).map((block) => (
        <BlockCard
          key={block}
          block={block}
          items={byBlock[block]}
          pending={pendingByBlock[block]}
          met={progress.blocks[block].met}
          scored={progress.blocks[block].scored}
          busy={pending}
          locked={initial.locked}
          onToggle={(itemId) => toggle(block, itemId)}
          onMetAll={() =>
            persist(
              block,
              byBlock[block].map((i) => i.id),
              true,
            )
          }
          onScored={(scored) => persist(block, progress.blocks[block].met, scored)}
        />
      ))}
    </div>
  )
}

function EmptyCriteria() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-4 text-center">
      <p className="text-sm font-medium">{t('adherence.empty.title')}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('adherence.empty.description')}</p>
      <Link
        href="/strategies?tab=criteria"
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
      >
        {t('adherence.empty.cta')}
      </Link>
    </div>
  )
}

function BlockCard({
  block,
  items,
  pending,
  met,
  scored,
  busy,
  locked,
  onToggle,
  onMetAll,
  onScored,
}: {
  block: ChecklistBlock
  items: { id: string; label: string; definition: string | null; strategyId: string | null }[]
  pending: { id: string; label: string; definition: string | null; strategyId: string | null }[]
  met: string[]
  scored: boolean
  /** A write is in flight. Only the confirm actions wait for it; ticking never does. */
  busy: boolean
  /** The review window has closed: a record now, not a form. */
  locked: boolean
  onToggle: (itemId: string) => void
  onMetAll: () => void
  onScored: (scored: boolean) => void
}) {
  const meta = blockMeta(block)
  const checked = new Set(met)
  const done = items.filter((i) => checked.has(i.id)).length
  const allMet = done === items.length

  return (
    <div className={cn('rounded-xl border bg-card p-4', scored ? 'border-border' : 'border-dashed border-border')}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dotClass)} />
          <h2 className="truncate text-sm font-semibold">{meta.name}</h2>
          <Tooltip label={<span className="block max-w-xs font-normal">{meta.hint}</span>}>
            <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Tooltip>
        </div>
        {items.length > 0 && (
          <span className="shrink-0 text-xs tabular text-muted-foreground">
            {t('adherence.score', { met: done, total: items.length })}
          </span>
        )}
      </div>

      <p className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-relaxed text-muted-foreground">
        {items.length === 0
          ? t('adherence.pending.blockOnly')
          : scored
            ? t('adherence.state.done')
            : t('adherence.state.todo')}
      </p>

      <ul className="space-y-1">
        {items.map((item) => {
          const isMet = checked.has(item.id)
          // Only a reviewed block may draw a miss as a failure; before that it is neutral.
          const failed = scored && !isMet
          return (
            <li key={item.id}>
              <div className="flex w-full items-start gap-2">
                <button
                  type="button"
                  onClick={() => !locked && onToggle(item.id)}
                  disabled={locked}
                  aria-pressed={isMet}
                  aria-label={item.label}
                  className={cn(
                    'flex min-w-0 flex-1 items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm leading-snug transition-colors',
                    locked ? 'cursor-default' : 'hover:bg-accent',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      isMet && 'border-primary bg-primary text-primary-foreground',
                      failed && 'border-loss/60 bg-loss/10 text-loss',
                      !isMet && !failed && 'border-border',
                    )}
                  >
                    {isMet && <Check className="h-3 w-3" />}
                    {failed && <X className="h-3 w-3" />}
                  </span>
                  <span className={cn('min-w-0', failed && 'text-loss')}>
                    {item.label}
                    {item.strategyId === null && (
                      <span className="ml-1.5 align-middle text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t('adherence.universal')}
                      </span>
                    )}
                  </span>
                </button>
                {item.definition && (
                  <Tooltip label={<span className="block max-w-xs font-normal">{item.definition}</span>}>
                    <Info className="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Tooltip>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Written after this trade: listed so they are visibly there, greyed and without a
          checkbox so it is equally visible that they are not part of this trade's score. */}
      {pending.length > 0 && (
        <div className="mt-2 rounded-lg border border-dashed border-border px-3 py-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t('adherence.pending.note')}</p>
          <ul className="mt-1.5 space-y-1">
            {pending.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-xs leading-snug text-muted-foreground/70">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                <span className="min-w-0">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions after the list, in the order the work happens: tick what held, then
          confirm. "All held" is the one-click shortcut for the common case. A block with
          nothing applicable has nothing to confirm, so it gets no actions at all. */}
      <div
        className={cn(
          'mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3',
          (items.length === 0 || locked) && 'hidden',
        )}
      >
        <button
          type="button"
          onClick={() => onScored(!scored)}
          disabled={busy}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
            scored
              ? 'border border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {scored ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {scored ? t('adherence.action.redo') : t('adherence.action.confirm')}
        </button>
        {!allMet && (
          <button
            type="button"
            onClick={onMetAll}
            disabled={busy}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            {t('adherence.action.allMet')}
          </button>
        )}
      </div>
    </div>
  )
}
