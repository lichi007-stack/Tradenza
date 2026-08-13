'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import UiModal from '@/components/ui/Modal'
import RichTextEditor from '@/components/ui/RichTextEditor'
import StrategyImagesField from '@/components/strategies/StrategyImagesField'
import StrategyCriteriaField, { type DraftCriterion } from '@/components/strategies/StrategyCriteriaField'
import { inputClass, labelClass } from '@/components/settings/tags/shared'
import { handleRateLimit } from '@/components/ui/rate-limit-toast'
import { createStrategy, updateStrategy } from '@/lib/actions/strategies'
import { createStrategyCriteria } from '@/lib/actions/adherence'
import { track } from '@/lib/analytics'
import { isEmptyHtml } from '@/lib/html'
import { t } from '@/i18n'

// Minimal, serializable shape both StrategyDTO and the detail page's strategy
// object satisfy — so the same modal edits a strategy from either surface.
// Minimal shape both StrategyDTO and the detail page's strategy object satisfy. The
// playbook's criteria are absent on purpose: they live in `checklist_items` now.
export interface StrategyFormValue {
  id: string
  name: string
  description: string | null
  imageUrls: string[]
}

interface Props {
  /** null → create a new strategy; otherwise edit the given one. */
  strategy: StrategyFormValue | null
  onClose: () => void
  onSaved?: () => void
}

type FormState = {
  id: string
  name: string
  description: string
  imageUrls: string[]
}

export default function StrategyFormModal({ strategy, onClose, onSaved }: Props) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(() => ({
    id: strategy?.id ?? '',
    name: strategy?.name ?? '',
    description: strategy?.description ?? '',
    imageUrls: strategy?.imageUrls ?? [],
  }))
  // Criteria typed here are written after the strategy exists, since they need its id.
  const [criteria, setCriteria] = useState<DraftCriterion[]>([])
  const [saving, startSaving] = useTransition()

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }))

  function save() {
    if (saving) return
    const name = form.name.trim()
    if (!name) return
    const payload = {
      name,
      description: isEmptyHtml(form.description) ? null : form.description,
      imageUrls: form.imageUrls,
    }
    startSaving(async () => {
      const res = form.id ? await updateStrategy(form.id, payload) : await createStrategy(payload)
      if (handleRateLimit(res)) return
      if (!res.success) return

      // Written second (they need the id), so a failure here must not read as "the strategy
      // wasn't saved" — it was.
      const strategyId = form.id || ('strategy' in res ? (res.strategy as { id: string }).id : '')
      let criteriaCreated = 0
      if (strategyId && criteria.length > 0) {
        try {
          const added = await createStrategyCriteria(strategyId, criteria)
          if (!handleRateLimit(added) && added.success) criteriaCreated = added.created
        } catch {
          toast.error(t('strategies.toast.criteriaFailed'))
        }
      }

      if (!form.id) track({ name: 'strategy_created' })
      if (form.id) {
        toast.success(t('strategies.toast.updated'))
      } else if (criteriaCreated > 0) {
        toast.success(t('strategies.toast.created'), {
          description: t('strategies.toast.createdWithCriteria', { count: criteriaCreated }),
        })
      } else {
        // Without criteria adherence can say nothing about this setup, so offer the shortcut.
        toast.success(t('strategies.toast.created'), {
          description: t('strategies.toast.createdCriteria'),
          action: {
            label: t('strategies.toast.createdCriteriaCta'),
            onClick: () => router.push('/strategies?tab=criteria'),
          },
          duration: 8000,
        })
      }
      onSaved?.()
      onClose()
    })
  }

  return (
    <UiModal
      title={form.id ? t('strategies.edit') : t('strategies.new')}
      onClose={onClose}
      onConfirm={save}
      confirmLabel={saving ? t('strategies.form.saving') : t('strategies.form.save')}
      confirmDisabled={saving || form.name.trim().length === 0}
      cancelLabel={t('strategies.form.cancel')}
      className="max-w-2xl"
    >
      <div>
        <label className={labelClass}>{t('strategies.form.name')}</label>
        <input
          value={form.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder={t('strategies.form.namePlaceholder')}
          maxLength={80}
          autoFocus
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>{t('strategies.form.description')}</label>
        <div className="overflow-hidden rounded-md border border-border bg-input/30 focus-within:border-primary">
          <RichTextEditor
            value={form.description}
            onChange={(html) => patch({ description: html })}
            placeholder={t('strategies.form.descriptionPlaceholder')}
            minHeight={140}
          />
        </div>
      </div>

      <StrategyCriteriaField strategyId={form.id || undefined} value={criteria} onChange={setCriteria} />

      <StrategyImagesField value={form.imageUrls} onChange={(urls) => patch({ imageUrls: urls })} />
    </UiModal>
  )
}
