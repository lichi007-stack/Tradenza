'use client'

import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { inputClass, labelClass } from '@/components/settings/tags/shared'
import { blockMeta } from '@/components/adherence/blockMeta'
import { getStrategyCriteria, type ChecklistItemDTO } from '@/lib/actions/adherence'
import { CHECKLIST_BLOCKS, LABEL_MAX, type ChecklistBlock } from '@/lib/adherence'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

/** A criterion typed here but not yet saved — it needs the strategy's id first. */
export interface DraftCriterion {
  block: ChecklistBlock
  label: string
}

/**
 * This setup's own criteria, written where the setup is. All three blocks are offered and
 * what is typed adds to the universal criteria rather than replacing them. Only new lines
 * are collected — editing an existing one is the fix-vs-replace question this form has no
 * room to ask, so it stays in the criteria manager.
 */
export default function StrategyCriteriaField({
  strategyId,
  value,
  onChange,
}: {
  strategyId?: string
  value: DraftCriterion[]
  onChange: (items: DraftCriterion[]) => void
}) {
  const [existing, setExisting] = useState<ChecklistItemDTO[]>([])
  const [draft, setDraft] = useState('')
  // Most setup-specific criteria belong to `setup`, so it opens there.
  const [block, setBlock] = useState<ChecklistBlock>('setup')

  useEffect(() => {
    if (!strategyId) return
    let cancelled = false
    getStrategyCriteria(strategyId)
      .then((rows) => !cancelled && Array.isArray(rows) && setExisting(rows))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [strategyId])

  const add = () => {
    const label = draft.trim()
    setDraft('')
    if (!label) return
    // Only an exact block+label repeat is a duplicate — wording can travel across blocks.
    if (value.some((v) => v.block === block && v.label.toLowerCase() === label.toLowerCase())) return
    onChange([...value, { block, label }])
  }

  // Two checks in one line mean a miss can't say which half failed — a nudge, not a rule.
  const compound = /\b(and|or)\b/i.test(draft)

  const inBlock = (b: ChecklistBlock) => ({
    saved: existing.filter((i) => i.block === b),
    drafts: value.filter((v) => v.block === b),
  })

  return (
    <div>
      <label className={labelClass}>{t('strategies.form.criteria')}</label>
      <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">{t('strategies.form.criteriaHint')}</p>

      {/* Which block the next line goes into. Also the only place the three blocks are
          named in this form, so it doubles as the explanation of what they are. */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {CHECKLIST_BLOCKS.map((b) => {
          const meta = blockMeta(b)
          const selected = b === block
          return (
            <button
              key={b}
              type="button"
              onClick={() => setBlock(b)}
              aria-pressed={selected}
              title={meta.hint}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                selected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dotClass)} />
              {meta.name}
            </button>
          )
        })}
      </div>

      <div className="flex items-start gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds a line rather than submitting the form — the field is a list.
            if (e.key !== 'Enter') return
            e.preventDefault()
            add()
          }}
          placeholder={t('strategies.form.criteriaPlaceholder')}
          maxLength={LABEL_MAX}
          className={cn(inputClass, 'flex-1')}
        />
        <button
          type="button"
          onClick={add}
          disabled={draft.trim().length === 0}
          className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {t('strategies.form.criteriaAdd')}
        </button>
      </div>
      {compound && (
        <p className="mt-1.5 text-xs leading-relaxed text-amber-500">{t('strategies.form.criteriaSplit')}</p>
      )}

      {/* Blocks with nothing in them stay out of the way: this setup simply relies on the
          universal criteria there, which is the normal case. */}
      <div className="mt-3 space-y-3">
        {CHECKLIST_BLOCKS.map((b) => {
          const { saved, drafts } = inBlock(b)
          if (saved.length === 0 && drafts.length === 0) return null
          const meta = blockMeta(b)
          return (
            <div key={b}>
              <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dotClass)} />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{meta.name}</span>
              </div>
              <ul className="space-y-1.5">
                {saved.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 px-1 text-sm text-muted-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                    <span className="min-w-0">{item.label}</span>
                  </li>
                ))}
                {drafts.map((item) => {
                  const index = value.indexOf(item)
                  return (
                    <li
                      key={`${item.block}-${item.label}`}
                      className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                      <button
                        type="button"
                        onClick={() => onChange(value.filter((_, j) => j !== index))}
                        aria-label={t('strategies.form.criteriaRemove')}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-loss/10 hover:text-loss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
