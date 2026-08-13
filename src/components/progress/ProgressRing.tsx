'use client'

import { cn } from '@/lib/utils'

export default function ProgressRing({
  ratio,
  size = 64,
  stroke = 6,
  label,
  sublabel,
  className,
  neutral = false,
}: {
  ratio: number
  size?: number
  stroke?: number
  label?: React.ReactNode
  sublabel?: React.ReactNode
  className?: string
  /** "No value at all" as opposed to 0%: a dashed track and no arc, since an empty ring
   *  would read as zero. */
  neutral?: boolean
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, ratio))
  const offset = c * (1 - clamped)
  const perfect = clamped >= 1

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={neutral ? Math.max(2, stroke - 3) : stroke}
          strokeDasharray={neutral ? '3 5' : undefined}
          opacity={neutral ? 0.8 : 1}
        />
        {!neutral && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{
              transition: 'stroke-dashoffset 0.5s cubic-bezier(0.2,0,0,1)',
              filter: perfect ? 'drop-shadow(0 0 4px hsl(var(--primary) / 0.6))' : undefined,
              opacity: clamped === 0 ? 0.35 : 1,
            }}
          />
        )}
      </svg>
      {(label !== undefined || sublabel !== undefined) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          {label !== undefined && <span className="font-bold tabular text-foreground">{label}</span>}
          {sublabel !== undefined && <span className="mt-0.5 text-[10px] text-muted-foreground">{sublabel}</span>}
        </div>
      )}
    </div>
  )
}
