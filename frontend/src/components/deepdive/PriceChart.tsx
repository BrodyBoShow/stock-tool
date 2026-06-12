import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { getMacroSeries } from '@/lib/api'
import { MACRO_DISPLAY } from '@/lib/constants'
import { fmtDate } from '@/lib/format'
import type { MacroObservation, PricePoint } from '@/types/api'

/** Range presets. YTD is computed at render (days since Jan 1) so it stays
 *  correct over time. 5Y already covers the full ~5-year price history (a
 *  separate "Max" added nothing and was dropped). */
function buildRanges(): { label: string; days: number }[] {
  const now = new Date()
  const jan1 = new Date(now.getFullYear(), 0, 1)
  const ytd = Math.max(1, Math.ceil((now.getTime() - jan1.getTime()) / 86_400_000))
  return [
    { label: '1M', days: 30 },
    { label: '3M', days: 90 },
    { label: '6M', days: 180 },
    { label: 'YTD', days: ytd },
    { label: '1Y', days: 365 },
    { label: '3Y', days: 1095 },
    { label: '5Y', days: 1825 },
  ]
}

const OVERLAY_COLOR = '#7c3aed' // violet — distinct from the blue price line

function tickLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  return `${names[(m ?? 1) - 1]} '${String(y).slice(2)}`
}

interface ChartRow {
  date: string
  v: number
  macro?: number | null
}

/** Forward-fill the macro value as of each price date (point-in-time join). */
function asOfMerge(rows: ChartRow[], obs: MacroObservation[]): ChartRow[] {
  const sorted = obs.filter((o) => o.value !== null) // API returns oldest-first
  let i = 0
  let last: number | null = null
  return rows.map((p) => {
    while (i < sorted.length && sorted[i].date <= p.date) {
      last = sorted[i].value as number
      i += 1
    }
    return { ...p, macro: last }
  })
}

interface TooltipMeta {
  overlay: boolean
  label: string
  unit: string
  dec: number
}

interface TooltipProps {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number | string }>
  label?: string
}

function makeTooltip(meta: TooltipMeta) {
  return function ChartTooltip({ active, payload, label }: TooltipProps) {
    if (!active || !payload?.length) return null
    const price = payload.find((p) => p.dataKey === 'v')?.value
    const macro = payload.find((p) => p.dataKey === 'macro')?.value
    return (
      <div className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-xs shadow-card">
        <div className="font-semibold text-[#111827]">{fmtDate(label)}</div>
        <div className="mt-0.5 text-[#2563eb]">
          {typeof price === 'number' ? `$${price.toFixed(2)}` : '—'}
        </div>
        {meta.overlay && (
          <div className="mt-0.5" style={{ color: OVERLAY_COLOR }}>
            {meta.label}:{' '}
            {typeof macro === 'number' ? `${macro.toFixed(meta.dec)}${meta.unit}` : '—'}
          </div>
        )}
      </div>
    )
  }
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
  const [overlayOn, setOverlayOn] = useState(false)
  const [seriesId, setSeriesId] = useState('VIXCLS')
  const ranges = useMemo(buildRanges, [])

  const priceRows = useMemo<ChartRow[]>(
    () =>
      prices
        .filter((p) => p.adj_close !== null)
        .map((p) => ({ date: p.date, v: p.adj_close as number })),
    [prices],
  )

  const { data: macroData } = useQuery({
    queryKey: ['macro', 'series', seriesId],
    queryFn: () => getMacroSeries(seriesId),
    enabled: overlayOn,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const data = useMemo<ChartRow[]>(
    () =>
      overlayOn && macroData
        ? asOfMerge(priceRows, macroData.observations)
        : priceRows,
    [priceRows, overlayOn, macroData],
  )

  const meta = MACRO_DISPLAY.find((m) => m.id === seriesId)
  const Tip = makeTooltip({
    overlay: overlayOn,
    label: meta?.label ?? 'Macro',
    unit: meta?.unit ?? '',
    dec: meta?.dec ?? 2,
  })

  return (
    <div className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-bold text-[#111827]">Price history</div>
          <div className="mt-0.5 text-[0.78rem] text-[#6b7280]">
            Adjusted close (splits &amp; dividends) · nightly data
          </div>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-[#f1f5f9] p-1">
          {ranges.map((r) => (
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

      {/* opt-in macro overlay controls (default off) */}
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => setOverlayOn((o) => !o)}
          aria-pressed={overlayOn}
          className={
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[0.76rem] font-semibold transition-colors ' +
            (overlayOn
              ? 'border-violet-200 bg-violet-50 text-violet-700'
              : 'border-[#e5e7eb] bg-white text-[#64748b] hover:bg-[#f8fafc]')
          }
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: overlayOn ? OVERLAY_COLOR : '#cbd5e1' }}
          />
          Macro overlay
        </button>
        {overlayOn && (
          <>
            <select
              value={seriesId}
              onChange={(e) => setSeriesId(e.target.value)}
              aria-label="Macro overlay series"
              className="rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-1 text-[0.76rem] font-semibold text-[#1e293b] focus:border-[#7c3aed] focus:outline-none"
            >
              {MACRO_DISPLAY.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="text-[0.7rem] text-[#9ca3af]">
              right axis · context only, not a signal
            </span>
          </>
        )}
      </div>

      <div
        className="mt-4 transition-opacity"
        style={{ opacity: isFetching ? 0.55 : 1 }}
      >
        {priceRows.length < 2 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-[#9ca3af]">
            Not enough price data for this range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
                yAxisId="price"
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                width={56}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
              />
              {overlayOn && (
                <YAxis
                  yAxisId="macro"
                  orientation="right"
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `${v.toFixed(meta?.dec ?? 0)}${meta?.unit ?? ''}`}
                  width={52}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: OVERLAY_COLOR }}
                />
              )}
              <Tooltip content={<Tip />} />
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="v"
                stroke="#2563eb"
                strokeWidth={2}
                fill="url(#px-fill)"
                isAnimationActive={false}
              />
              {overlayOn && (
                <Line
                  yAxisId="macro"
                  type="monotone"
                  dataKey="macro"
                  stroke={OVERLAY_COLOR}
                  strokeWidth={1.6}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
