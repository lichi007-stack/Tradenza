import { cn } from '@/lib/utils'
import { allBlockMeta } from './blockMeta'

/** What G / S / E stand for, said once per page. Server-safe, so lists can render it. */
export default function ReviewLegend({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground', className)}>
      {allBlockMeta().map((meta) => (
        <span key={meta.key} className="inline-flex items-center gap-1.5">
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-semibold leading-none text-white"
            style={{ backgroundColor: meta.accent }}
          >
            {meta.letter}
          </span>
          {meta.name}
        </span>
      ))}
    </span>
  )
}
