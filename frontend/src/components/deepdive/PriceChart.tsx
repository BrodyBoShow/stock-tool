import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { fmtDate } from '@/lib/format'
import type { PricePoint } from '@/types/api'

export const RANGES = [
  { label: '1Y', days: 365 },
  { label: '3Y', days: 1095 },
  { label: '5Y', days: 1825 },
] as const

function tickLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  return `${names[(m ?? 1) - 1]} '${String(y).slice(2)}`
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value?: number | string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value
  return (
    <div className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-xs shadow-card">
      <div className="font-semibold text-[#111827]">{fmtDate(label)}</div>
      <div className="mt-0.5 text-[#2563eb]">
        {typeof v === 'number' ? `$${v.toFixed(2)}` : '—'}
      </div>
    </div>
  )
}

export function PriceChart({
  prices,
  days,
  onDaysChange,
  isFetching,
}: {
  prices: PricePoint[]
  days: number
  onDaysChange: (d: number) => void
  isFetching: boolean
}) {
  const data = useMemo(
    () =>
      prices
        .filter((p) => p.adj_close !== null)
        .map((p) => ({ date: p.date, v: p.adj_close as number })),
    [prices],
  )

  return (
    <div className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-bold text-[#111827]">Price history</div>
          <div className="mt-0.5 text-[0.78rem] text-[#6b7280]">
            Adjusted close (splits &amp; dividends) · nightly data
          </div>
        </div>
        <div className="flex gap-1 rounded-lg bg-[#f1f5f9] p-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onDaysChange(r.days)}
              className={
                'rounded-md px-3 py-1 text-xs font-bold transition-colors ' +
                (days === r.days
                  ? 'bg-white text-[#111827] shadow-sm'
                  : 'text-[#64748b] hover:text-[#111827]')
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="mt-4 transition-opacity"
        style={{ opacity: isFetching ? 0.55 : 1 }}
      >
        {data.length < 2 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-[#9ca3af]">
            Not enough price data for this range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="px-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity={0.16} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={tickLabel}
                minTickGap={56}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
              />
              <YAxis
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                width={56}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="v"
                stroke="#2563eb"
                strokeWidth={2}
                fill="url(#px-fill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
