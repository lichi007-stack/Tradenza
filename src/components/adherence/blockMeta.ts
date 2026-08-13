import { CHECKLIST_BLOCKS, type ChecklistBlock } from '@/lib/adherence'
import { t } from '@/i18n'

// Presentation of the three blocks in one place, so the trade panel, the strategy page and
// the account overview cannot drift into calling the same block different things.
//
// The colours are NOT the profit/loss palette: a block is a process measurement, and
// tinting it green or red would read as an outcome. Each block gets its own neutral hue
// instead, used consistently as its identity across every surface.

export interface BlockMeta {
  key: ChecklistBlock
  letter: string
  name: string
  short: string
  hint: string
  /** Accent for the block's dot / ring, as a raw CSS colour. */
  accent: string
  dotClass: string
}

const ACCENTS: Record<ChecklistBlock, { accent: string; dotClass: string }> = {
  gate: { accent: 'hsl(217 91% 60%)', dotClass: 'bg-[hsl(217_91%_60%)]' },
  setup: { accent: 'hsl(258 90% 66%)', dotClass: 'bg-[hsl(258_90%_66%)]' },
  exit: { accent: 'hsl(38 92% 50%)', dotClass: 'bg-[hsl(38_92%_50%)]' },
}

export function blockMeta(block: ChecklistBlock): BlockMeta {
  return {
    key: block,
    letter: t(`adherence.blocks.${block}.letter`),
    name: t(`adherence.blocks.${block}.name`),
    short: t(`adherence.blocks.${block}.short`),
    hint: t(`adherence.blocks.${block}.hint`),
    ...ACCENTS[block],
  }
}

export const allBlockMeta = (): BlockMeta[] => CHECKLIST_BLOCKS.map(blockMeta)

/** `86%`, or an em dash when the block was never evaluated — never `0%`. */
export const pctText = (value: number | null): string => (value === null ? '—' : `${Math.round(value)}%`)
