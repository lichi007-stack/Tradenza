'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import UiModal from '@/components/ui/Modal'
import { inputClass, labelClass } from '@/components/settings/tags/shared'
import { handleRateLimit } from '@/components/ui/rate-limit-toast'
import { getActionErrorMessage } from '@/lib/action-error-message'
import { createChecklistItem, updateChecklistItem, type ChecklistItemDTO } from '@/lib/actions/adherence'
import { DEFINITION_MAX, LABEL_MAX, type ChecklistBlock } from '@/lib/adherence'
import { blockMeta } from './blockMeta'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

type EditMode = 'fix' | 'replace'

/**
 * Create or edit one criterion. Block and scope come from the button that opened it, so
 * the dialog states where the criterion lands instead of asking again. On edit the user
 * picks fix vs. replace — guessing wrong would corrupt the history.
 */
export default function CriterionDialog({
  item,
  block,
  strategyId,
  strategies,
  onClose,
  onSaved,
}: {
  item: ChecklistItemDTO | null
  block: ChecklistBlock
  strategyId: string | null
  strategies: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [label, setLabel] = useState(item?.label ?? '')
  const [definition, setDefinition] = useState(item?.definition ?? '')
  const [mode, setMode] = useState<EditMode>('fix')
  const [saving, startSaving] = useTransition()

  const targetBlock = item?.block ?? block
  const targetStrategyId = item?.strategyId ?? strategyId
  const scopeName = targetStrategyId
    ? (strategies.find((s) => s.id === targetStrategyId)?.name ?? '')
    : t('adherence.criteria.form.scopeUniversal')

  // Two checks in one line mean a miss can't say which half failed. A warning, not a block.
  const compound = /\b(and|or)\b/i.test(label)

  const save = () => {
    const trimmed = label.trim()
    if (!trimmed || saving) return
    startSaving(async () => {
      try {
        const res = item
          ? await updateChecklistItem(item.id, { label: trimmed, definition: definition.trim() || null }, mode)
          : await createChecklistItem({
              block: targetBlock,
              strategyId: targetStrategyId,
              label: trimmed,
              definition: definition.trim() || null,
            })
        if (handleRateLimit(res)) return
        toast.success(t(item ? 'adherence.toast.saved' : 'adherence.toast.created'))
        await onSaved()
        onClose()
      } catch (err) {
        toast.error(getActionErrorMessage(err, 'adherence.toast.saveError'))
      }
    })
  }

  return (
    <UiModal
      title={t(item ? 'adherence.criteria.form.editTitle' : 'adherence.criteria.form.newTitle')}
      onClose={onClose}
      onConfirm={save}
      confirmLabel={saving ? t('adherence.criteria.form.saving') : t('adherence.criteria.form.save')}
      confirmDisabled={saving || label.trim().length === 0}
      cancelLabel={t('adherence.criteria.form.cancel')}
    >
      {/* Where the criterion goes — decided by the button that opened the dialog. */}
      {!item && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          {t('adherence.criteria.form.context')}
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', blockMeta(targetBlock).dotClass)} />
            {scopeName} · {blockMeta(targetBlock).name}
          </span>
        </p>
      )}

      <div>
        <label className={labelClass}>{t('adherence.criteria.form.label')}</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('adherence.criteria.form.labelPlaceholder')}
          maxLength={LABEL_MAX}
          autoFocus
          className={inputClass}
        />
        <p className={cn('mt-1.5 text-xs leading-relaxed', compound ? 'text-amber-500' : 'text-muted-foreground')}>
          {t('adherence.criteria.form.labelHint')}
        </p>
      </div>

      <div>
        <label className={labelClass}>{t('adherence.criteria.form.definition')}</label>
        <textarea
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
          placeholder={t('adherence.criteria.form.definitionPlaceholder')}
          maxLength={DEFINITION_MAX}
          rows={3}
          className={cn(inputClass, 'resize-y')}
        />
      </div>

      {item && (
        <div>
          <label className={labelClass}>{t('adherence.criteria.form.mode')}</label>
          <div className="space-y-2">
            {(['fix', 'replace'] as EditMode[]).map((value) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
                  mode === value ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/20',
                )}
              >
                <input
                  type="radio"
                  name="edit-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-0.5 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t(`adherence.criteria.form.mode${value === 'fix' ? 'Fix' : 'Replace'}`)}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {t(`adherence.criteria.form.mode${value === 'fix' ? 'Fix' : 'Replace'}Hint`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </UiModal>
  )
}
