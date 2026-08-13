'use client'

import Link from 'next/link'
import Tooltip from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'
import type { BlockReview } from '@/lib/adherence'
import { blockMeta } from './blockMeta'
import { t } from '@/i18n'

/**
 * The three blocks as one glance: G S E, filled where reviewed. No percentage — a score in
 * a list invites comparing trades on adherence, which is not what it is for; the tooltip
 * says the state in words. A block with no criteria is greyed rather than hidden so a
 * column of rows scans evenly, and `locked` draws unreviewed blocks blank rather than as
 * outstanding work nobody can do.
 */
export default function ReviewChips({
  states,
  href,
  locked = false,
}: {
  states: BlockReview[]
  href?: string
  locked?: boolean
}) {
  if (states.every((s) => !s.applicable)) return <span className="text-muted-foreground">—</span>

  const chips = (
    <span className="inline-flex items-center gap-1">
      {states.map((state) => {
        const meta = blockMeta(state.block)
        const label = !state.applicable
          ? t('adherence.review.chip.none', { block: meta.name })
          : state.reviewed
            ? t('adherence.review.chip.done', { block: meta.name, met: state.met, total: state.total })
            : locked
              ? t('adherence.review.chip.closed', { block: meta.name })
              : t('adherence.review.chip.todo', { block: meta.name })
        return (
          <Tooltip key={state.block} label={label}>
            <span
              aria-label={label}
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold leading-none',
                !state.applicable && 'text-muted-foreground/25',
                // Dashed = still to do. Once locked it is blank, not pending.
                state.applicable &&
                  !state.reviewed &&
                  !locked &&
                  'border border-dashed border-border text-muted-foreground',
                state.applicable && !state.reviewed && locked && 'text-muted-foreground/30',
                state.applicable && state.reviewed && 'text-white',
              )}
              style={state.applicable && state.reviewed ? { backgroundColor: meta.accent } : undefined}
            >
              {meta.letter}
            </span>
          </Tooltip>
        )
      })}
    </span>
  )

  if (!href) return chips
  return (
    <Link
      href={href}
      aria-label={t('adherence.review.open')}
      className="inline-flex rounded transition-opacity hover:opacity-80"
    >
      {chips}
    </Link>
  )
}
