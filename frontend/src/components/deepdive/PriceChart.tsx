import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { WyckoffChart } from '@/components/deepdive/WyckoffChart'
import { getEvents, getInsiders, getMacroSeries } from '@/lib/api'
import { MACRO_DISPLAY } from '@/lib/constants'
import { fmtDate } from '@/lib/format'
import { computeVsa } from '@/lib/wyckoff'
import type { MacroObservation, PricePoint } from '@/types/api'

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

const OVERLAY_COLOR = '#7c3aed'
const MA50_COLOR = '#06b6d4'   // cyan
const MA200_COLOR = '#f97316'  // orange

function tickLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${names[(m ?? 1) - 1]} '${String(y).slice(2)}`
}

interface ChartRow {
  date: string
  v: number
  vol: number | null
  upDay: boolean
  macro?: number | null
  ma50?: number | null
  ma200?: number | null
}

function asOfMerge(rows: ChartRow[], obs: MacroObservation[]): ChartRow[] {
  const sorted = obs.filter((o) => o.value !== null)
  let i = 0
  let last: number | null = null
  return rows.map((p) => {
    while (i < sorted.length && sorted[i].date <= p.date) {
      last = sorted[i].value as number
      i++
    }
    return { ...p, macro: last }
  })
}

function rollingMean(vals: (number | null)[], n: number): (number | null)[] {
  return vals.map((_, i) => {
    if (i < n - 1) return null
    const slice = vals.slice(i - n + 1, i + 1)
    const nums = slice.filter((v): v is number => v !== null)
    return nums.length === n ? nums.reduce((a, b) => a + b, 0) / n : null
  })
}

function fmtVol(v: number | null): string {
  if (v == null) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(v)
}

interface TooltipProps {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number | string | null }>
  label?: string
}

function PriceTooltip({
  active,
  payload,
  label,
  overlayMeta,
  showMA,
}: TooltipProps & { overlayMeta?: { label: string; unit: string; dec: number } | null; showMA: boolean }) {
  if (!active || !payload?.length) return null
  const price = payload.find((p) => p.dataKey === 'v')?.value
  const macro = payload.find((p) => p.dataKey === 'macro')?.value
  const ma50 = payload.find((p) => p.dataKey === 'ma50')?.value
  const ma200 = payload.find((p) => p.dataKey === 'ma200')?.value
  return (
    <div className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-xs shadow-card">
      <div className="font-semibold text-[#111827]">{fmtDate(label)}</div>
      <div className="mt-0.5 text-[#2563eb]">
        {typeof price === 'number' ? `$${price.toFixed(2)}` : '—'}
      </div>
      {showMA && (
        <>
          {typeof ma50 === 'number' && <div style={{ color: MA50_COLOR }}>MA50: ${ma50.toFixed(2)}</div>}
          {typeof ma200 === 'number' && <div style={{ color: MA200_COLOR }}>MA200: ${ma200.toFixed(2)}</div>}
        </>
      )}
      {overlayMeta && typeof macro === 'number' && (
        <div style={{ color: OVERLAY_COLOR }}>
          {overlayMeta.label}: {macro.toFixed(overlayMeta.dec)}{overlayMeta.unit}
        </div>
      )}
    </div>
  )
}

function VolumeTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null
  const vol = payload.find((p) => p.dataKey === 'vol')?.value
  return (
    <div className="rounded-lg border border-[#e5e7eb] bg-white px-2 py-1 text-xs shadow-card">
      <div className="font-semibold text-[#111827]">{fmtDate(label)}</div>
      <div className="text-[#6b7280]">Vol {fmtVol(typeof vol === 'number' ? vol : null)}</div>
    </div>
  )
}

type OverlayToggleProps = {
  on: boolean
  onToggle: () => void
  label: string
  color: string
  bgOn: string
  textOn: string
  borderOn: string
}

function OverlayToggle({ on, onToggle, label, color, bgOn, textOn, borderOn }: OverlayToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[0.76rem] font-semibold transition-colors ${
        on
          ? `${borderOn} ${bgOn} ${textOn}`
          : 'border-[#e5e7eb] bg-white text-[#64748b] hover:bg-[#f8fafc]'
      }`}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: on ? color : '#cbd5e1' }} />
      {label}
    </button>
  )
}

export function PriceChart({
  prices,
  days,
  onDaysChange,
  isFetching,
  ticker,
}: {
  prices: PricePoint[]
  days: number
  onDaysChange: (d: number) => void
  isFetching: boolean
  ticker: string
}) {
  const [mode, setMode] = useState<'price' | 'wyckoff'>('price')
  const [overlayOn, setOverlayOn] = useState(false)
  const [seriesId, setSeriesId] = useState('VIXCLS')
  const [showMA50, setShowMA50] = useState(false)
  const [showMA200, setShowMA200] = useState(false)
  const [showVolume, setShowVolume] = useState(false)
  const [showEvents, setShowEvents] = useState(false)
  const ranges = useMemo(buildRanges, [])

  const vsaBars = useMemo(() => computeVsa(prices), [prices])

  const priceRows = useMemo<ChartRow[]>(() => {
    const filtered = prices.filter((p) => p.adj_close !== null)
    const ma50Vals = rollingMean(filtered.map((p) => p.adj_close), 50)
    const ma200Vals = rollingMean(filtered.map((p) => p.adj_close), 200)
    return filtered.map((p, i) => ({
      date: p.date,
      v: p.adj_close as number,
      vol: p.volume ?? null,
      upDay: i === 0 ? true : (p.adj_close ?? 0) >= (filtered[i - 1].adj_close ?? 0),
      ma50: ma50Vals[i],
      ma200: ma200Vals[i],
    }))
  }, [prices])

  const hasVolume = priceRows.some((r) => r.vol !== null)
  const dateRange = priceRows.length > 0
    ? { start: priceRows[0].date, end: priceRows[priceRows.length - 1].date }
    : null

  const { data: macroData } = useQuery({
    queryKey: ['macro', 'series', seriesId],
    queryFn: () => getMacroSeries(seriesId),
    enabled: overlayOn,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: eventsData } = useQuery({
    queryKey: ['events', ticker],
    queryFn: () => getEvents(ticker),
    enabled: showEvents,
    staleTime: 10 * 60 * 1000,
  })

  const { data: insidersData } = useQuery({
    queryKey: ['insiders', ticker],
    queryFn: () => getInsiders(ticker),
    enabled: showEvents,
    staleTime: 10 * 60 * 1000,
  })

  const data = useMemo<ChartRow[]>(
    () => overlayOn && macroData ? asOfMerge(priceRows, macroData.observations) : priceRows,
    [priceRows, overlayOn, macroData],
  )

  const visibleEvents = useMemo(() => {
    if (!showEvents || !eventsData || !dateRange) return []
    return eventsData.events.filter((e) => {
      const d = e.event_date || e.filed_date
      return e.high_signal && d >= dateRange.start && d <= dateRange.end
    })
  }, [showEvents, eventsData, dateRange])

  const visibleBuys = useMemo(() => {
    if (!showEvents || !insidersData || !dateRange) return []
    return insidersData.transactions.filter(
      (t) =>
        t.transaction_code === 'P' &&
        t.transaction_date &&
        t.transaction_date >= dateRange.start &&
        t.transaction_date <= dateRange.end,
    )
  }, [showEvents, insidersData, dateRange])

  const overlayMeta = MACRO_DISPLAY.find((m) => m.id === seriesId) ?? null

  return (
    <div className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      {/* Header + mode toggle + range buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-bold text-[#111827]">
            {mode === 'wyckoff' ? 'Wyckoff · volume-spread' : 'Price history'}
          </div>
          <div className="mt-0.5 text-[0.78rem] text-[#6b7280]">
            {mode === 'wyckoff'
              ? 'Daily candles · spread + volume · objective measures only'
              : 'Adjusted close (splits & dividends) · nightly data'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-[#f1f5f9] p-1">
            {(['price', 'wyckoff'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  'rounded-md px-3 py-1 text-xs font-bold capitalize transition-colors ' +
                  (mode === m
                    ? 'bg-white text-[#111827] shadow-sm'
                    : 'text-[#64748b] hover:text-[#111827]')
                }
              >
                {m === 'wyckoff' ? 'Wyckoff' : 'Price'}
              </button>
            ))}
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
      </div>

      {/* Toggle controls — Price mode only (Wyckoff has its own legend) */}
      {mode === 'price' && (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* MA toggles */}
        <OverlayToggle
          on={showMA50}
          onToggle={() => setShowMA50((x) => !x)}
          label="50d MA"
          color={MA50_COLOR}
          bgOn="bg-cyan-50"
          textOn="text-cyan-700"
          borderOn="border-cyan-200"
        />
        <OverlayToggle
          on={showMA200}
          onToggle={() => setShowMA200((x) => !x)}
          label="200d MA"
          color={MA200_COLOR}
          bgOn="bg-orange-50"
          textOn="text-orange-700"
          borderOn="border-orange-200"
        />
        {hasVolume && (
          <OverlayToggle
            on={showVolume}
            onToggle={() => setShowVolume((x) => !x)}
            label="Volume"
            color="#10b981"
            bgOn="bg-emerald-50"
            textOn="text-emerald-700"
            borderOn="border-emerald-200"
          />
        )}
        <OverlayToggle
          on={showEvents}
          onToggle={() => setShowEvents((x) => !x)}
          label="Events"
          color="#f59e0b"
          bgOn="bg-amber-50"
          textOn="text-amber-700"
          borderOn="border-amber-200"
        />

        {/* Divider */}
        <span className="text-[#e5e7eb]">|</span>

        {/* Macro overlay */}
        <OverlayToggle
          on={overlayOn}
          onToggle={() => setOverlayOn((x) => !x)}
          label="Macro overlay"
          color={OVERLAY_COLOR}
          bgOn="bg-violet-50"
          textOn="text-violet-700"
          borderOn="border-violet-200"
        />
        {overlayOn && (
          <>
            <select
              value={seriesId}
              onChange={(e) => setSeriesId(e.target.value)}
              aria-label="Macro overlay series"
              className="rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-1 text-[0.76rem] font-semibold text-[#1e293b] focus:border-[#7c3aed] focus:outline-none"
            >
              {MACRO_DISPLAY.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <span className="text-[0.7rem] text-[#9ca3af]">right axis · context only</span>
          </>
        )}
      </div>
      )}

      {/* VSA legend — Wyckoff mode */}
      {mode === 'wyckoff' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-[0.72rem] font-semibold text-amber-700">
            <span className="h-2 w-2 rounded-sm bg-[#ef9f27]" />
            Climax volume
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#f1f5f9] px-2 py-0.5 text-[0.72rem] font-semibold text-[#475569]">
            <span className="h-2 w-2 rounded-sm border border-[#64748b]" />
            Wide spread
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#f1f5f9] px-2 py-0.5 text-[0.72rem] font-semibold text-[#475569]">
            <span className="h-2 w-2 rounded-sm bg-[#94a3b8]" />
            Churn / no-demand
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-0.5 text-[0.72rem] font-semibold text-sky-700">
            <span className="h-2 w-3 rounded-sm border border-dashed border-[#378ADD] bg-[rgba(55,138,221,0.15)]" />
            Trading range
          </span>
          <span className="text-[0.7rem] text-[#9ca3af]">
            Objective measures off daily OHLCV · not Wyckoff phase labels
          </span>
        </div>
      )}

      {/* Legend for active overlays */}
      {mode === 'price' && (showMA50 || showMA200 || showEvents) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem]">
          {showMA50 && (
            <span className="flex items-center gap-1" style={{ color: MA50_COLOR }}>
              <span className="inline-block h-0.5 w-5 rounded" style={{ background: MA50_COLOR }} />
              50-day MA
            </span>
          )}
          {showMA200 && (
            <span className="flex items-center gap-1" style={{ color: MA200_COLOR }}>
              <span className="inline-block h-0.5 w-5 rounded" style={{ background: MA200_COLOR }} />
              200-day MA
            </span>
          )}
          {showEvents && visibleEvents.length > 0 && (
            <span className="flex items-center gap-1 text-[#b45309]">
              <span className="inline-block h-3 w-0.5 rounded" style={{ background: '#f59e0b' }} />
              8-K filing
            </span>
          )}
          {showEvents && visibleBuys.length > 0 && (
            <span className="flex items-center gap-1 text-[#15803d]">
              <span className="inline-block h-3 w-0.5 rounded" style={{ background: '#22c55e' }} />
              Insider buy
            </span>
          )}
          {showEvents && visibleEvents.length === 0 && visibleBuys.length === 0 && (
            <span className="text-[#9ca3af]">No 8-Ks or insider buys in this range</span>
          )}
        </div>
      )}

      {/* Charts */}
      {mode === 'wyckoff' ? (
        <div className="mt-4">
          <WyckoffChart bars={vsaBars} isFetching={isFetching} />
        </div>
      ) : (
      <div className="mt-4 transition-opacity" style={{ opacity: isFetching ? 0.55 : 1 }}>
        {priceRows.length < 2 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-[#9ca3af]">
            Not enough price data for this range.
          </div>
        ) : (
          <>
            {/* Price + MA + events */}
            <ResponsiveContainer width="100%" height={showVolume && hasVolume ? 260 : 300}>
              <ComposedChart data={data} margin={{ top: 4, right: overlayOn ? 52 : 4, bottom: 0, left: 0 }} syncId="px">
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
                    tickFormatter={(v: number) => `${v.toFixed(overlayMeta?.dec ?? 0)}${overlayMeta?.unit ?? ''}`}
                    width={52}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: OVERLAY_COLOR }}
                  />
                )}
                <Tooltip
                  content={
                    <PriceTooltip
                      overlayMeta={overlayOn ? overlayMeta : null}
                      showMA={showMA50 || showMA200}
                    />
                  }
                />

                {/* Event reference lines */}
                {visibleEvents.map((e) => (
                  <ReferenceLine
                    key={e.accession_no}
                    yAxisId="price"
                    x={e.event_date || e.filed_date}
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    label={{ value: '▾', position: 'top', fontSize: 10, fill: '#f59e0b' }}
                  />
                ))}
                {visibleBuys.map((t, i) => (
                  <ReferenceLine
                    key={`buy-${i}`}
                    yAxisId="price"
                    x={t.transaction_date!}
                    stroke="#22c55e"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    label={{ value: '▴', position: 'top', fontSize: 10, fill: '#22c55e' }}
                  />
                ))}

                <Area
                  yAxisId="price"
                  type="monotone"
                  dataKey="v"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#px-fill)"
                  isAnimationActive={false}
                />
                {showMA50 && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="ma50"
                    stroke={MA50_COLOR}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {showMA200 && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="ma200"
                    stroke={MA200_COLOR}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
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

            {/* Volume bars */}
            {showVolume && hasVolume && (
              <div className="mt-0.5">
                <ResponsiveContainer width="100%" height={64}>
                  <BarChart data={data} margin={{ top: 0, right: overlayOn ? 52 : 4, bottom: 0, left: 0 }} syncId="px">
                    <XAxis dataKey="date" hide />
                    <YAxis hide domain={[0, 'auto']} />
                    <Tooltip content={<VolumeTooltip />} />
                    <Bar dataKey="vol" maxBarSize={8} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                      {data.map((row, i) => (
                        <Cell
                          key={i}
                          fill={row.upDay ? '#16a34a' : '#dc2626'}
                          fillOpacity={0.55}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="pr-1 text-right text-[0.65rem] text-[#9ca3af]">Volume</div>
              </div>
            )}
          </>
        )}
      </div>
      )}
    </div>
  )
}
