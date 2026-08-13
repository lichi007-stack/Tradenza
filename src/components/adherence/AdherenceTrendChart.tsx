'use client'

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useChartColors, makeTooltipStyle } from '@/components/dashboard/widgets/shared'
import { ADHERENCE_TARGET, CHECKLIST_BLOCKS, type AdherenceTrend, type TrendPoint } from '@/lib/adherence'
import { blockMeta } from './blockMeta'
import { t } from '@/i18n'

/**
 * Adherence by day, three separate lines, never combined.
 *
 * The x axis is evenly spaced: every point takes the same width whether the next trading
 * day is tomorrow or a fortnight away, so it reads as "the days you traded, in order"
 * rather than as a calendar full of weekend plateaus. Dates stay on the ticks and in the
 * tooltip. `connectNulls` keeps an unreviewed day from tearing a line in half; the tooltip
 * carries each point's sample so a bridged stretch can't be mistaken for evidence.
 */
// "14 Mar", not "2026-03-14" — the axis is read at a glance.
const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function AdherenceTrendChart({ trend }: { trend: AdherenceTrend }) {
  const c = useChartColors()

  // Roughly six labels, whatever the length — a tick per point smears together.
  const tickInterval = Math.max(0, Math.ceil(trend.points.length / 6) - 1)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={trend.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          stroke={c.axis}
          fontSize={11}
          tickLine={false}
          interval={tickInterval}
          tickFormatter={shortDate}
        />
        <YAxis stroke={c.axis} fontSize={11} width={38} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
        <ReferenceLine y={ADHERENCE_TARGET} stroke={c.axis} strokeDasharray="2 2" />
        <Tooltip
          contentStyle={makeTooltipStyle(c)}
          formatter={(value: number, key, entry) => {
            const point = entry?.payload as TrendPoint | undefined
            const n = point?.samples?.[key as keyof TrendPoint['samples']]
            return [
              n ? `${Math.round(value)}% · ${t('adherence.trend.samples', { count: n })}` : `${Math.round(value)}%`,
              t(`adherence.blocks.${key}.short`),
            ]
          }}
          labelFormatter={(_day, payload) => {
            const point = payload?.[0]?.payload as TrendPoint | undefined
            if (!point) return ''
            return point.endDate === point.date
              ? shortDate(point.date)
              : `${shortDate(point.date)} – ${shortDate(point.endDate)}`
          }}
        />
        {CHECKLIST_BLOCKS.map((block) => (
          <Line
            key={block}
            type="monotone"
            dataKey={block}
            stroke={blockMeta(block).accent}
            strokeWidth={2}
            // Dots only while the series is short enough to read them.
            dot={trend.points.length <= 30 ? { r: 2 } : false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
