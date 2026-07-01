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
import { tickLabel } from '@/lib/format'
import { analyzeWyckoff } from '@/lib/wyckoff'
import type { FilingRow, PricePoint } from '@/types/api'

import { OverlayToggle, PriceTooltip, VolumeTooltip } from './priceChartParts'
import {
  asOfMerge,
  buildRanges,
  type ChartRow,
  MA200_COLOR,
  MA50_COLOR,
  OVERLAY_COLOR,
  rollingMean,
} from './priceChartUtils'
import { WyckoffReadPanel } from './WyckoffReadPanel'

// Marker categories the chart can overlay. Each pulls from one source, snaps to
// the nearest price bar, and draws a labeled reference line. Filings (top) and
// insider trades (bottom) sit on opposite sides so they don't collide.
type MarkerCat = 'earnings' | 'k8_high' | 'k8_routine' | 'other_filing' | 'buy' | 'sell'

const MARKER_META: Record<
  MarkerCat,
  { label: string; color: string; glyph: string; pos: 'top' | 'bottom' }
> = {
  earnings: { label: '10-K / 10-Q', color: '#2563eb', glyph: '▾', pos: 'top' },
  k8_high: { label: '8-K · high-signal', color: '#f59e0b', glyph: '▾', pos: 'top' },
  k8_routine: { label: '8-K · routine', color: '#fcd34d', glyph: '▾', pos: 'top' },
  other_filing: { label: 'Other filings', color: '#64748b', glyph: '▾', pos: 'top' },
  buy: { label: 'Insider buy', color: '#22c55e', glyph: '▴', pos: 'bottom' },
  sell: { label: 'Insider sell', color: '#ef4444', glyph: '▾', pos: 'bottom' },
}
// Draw order left→right in the filter row.
const MARKER_ORDER: MarkerCat[] = ['earnings', 'k8_high', 'k8_routine', 'other_filing', 'buy', 'sell']
const MARKER_CAP = 60 // per category, most-recent kept — keeps a wide window legible

export function PriceChart({
  prices,
  days,
  onDaysChange,
  isFetching,
  ticker,
  filings = [],
}: {
  prices: PricePoint[]
  days: number
  onDaysChange: (d: number) => void
  isFetching: boolean
  ticker: string
  filings?: FilingRow[]
}) {
  const [mode, setMode] = useState<'price' | 'wyckoff'>('price')
  const [showSignals, setShowSignals] = useState(true)
  const [showPhases, setShowPhases] = useState(true)
  const [showTarget, setShowTarget] = useState(false)
  const [overlayOn, setOverlayOn] = useState(false)
  const [seriesId, setSeriesId] = useState('VIXCLS')
  const [showMA50, setShowMA50] = useState(false)
  const [showMA200, setShowMA200] = useState(false)
  const [showVolume, setShowVolume] = useState(false)
  const [showMarkers, setShowMarkers] = useState(false)
  // Defaults preserve the prior behavior — high-signal 8-Ks + insider buys — and
  // leave the noisier categories opt-in so a multi-year window stays legible.
  const [cats, setCats] = useState<Record<MarkerCat, boolean>>({
    earnings: false, k8_high: true, k8_routine: false, other_filing: false, buy: true, sell: false,
  })
  const ranges = useMemo(() => buildRanges(), [])

  const wyckoff = useMemo(() => analyzeWyckoff(prices), [prices])

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
  const dateRange = useMemo(
    () =>
      priceRows.length > 0
        ? { start: priceRows[0].date, end: priceRows[priceRows.length - 1].date }
        : null,
    [priceRows],
  )

  const { data: macroData } = useQuery({
    queryKey: ['macro', 'series', seriesId],
    queryFn: () => getMacroSeries(seriesId),
    enabled: overlayOn,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: eventsData } = useQuery({
    queryKey: ['events', ticker],
    queryFn: () => getEvents(ticker),
    enabled: showMarkers,
    staleTime: 10 * 60 * 1000,
  })

  const { data: insidersData } = useQuery({
    queryKey: ['insiders', ticker],
    queryFn: () => getInsiders(ticker),
    enabled: showMarkers,
    staleTime: 10 * 60 * 1000,
  })

  const data = useMemo<ChartRow[]>(
    () => overlayOn && macroData ? asOfMerge(priceRows, macroData.observations) : priceRows,
    [priceRows, overlayOn, macroData],
  )

  // Reference lines sit on a categorical X axis, so a marker only renders when
  // its date exactly matches a price-bar date. Snap each marker to the latest
  // trading day on/before it, so a buy/8-K dated on a non-trading day (or a gap
  // in the series) still draws instead of silently vanishing.
  const snapToBar = useMemo(() => {
    const dates = priceRows.map((r) => r.date)
    return (d: string): string | null => {
      if (dates.length === 0) return null
      if (d <= dates[0]) return dates[0]
      if (d >= dates[dates.length - 1]) return dates[dates.length - 1]
      let lo = 0
      let hi = dates.length - 1
      let ans = dates[0]
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (dates[mid] <= d) {
          ans = dates[mid]
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return ans
    }
  }, [priceRows])

  // All filing/event markers, bucketed by category, filtered to the visible
  // range, capped per category (most-recent kept) so a wide window stays legible.
  const markers = useMemo(() => {
    const counts = { earnings: 0, k8_high: 0, k8_routine: 0, other_filing: 0, buy: 0, sell: 0 } as Record<MarkerCat, number>
    if (!showMarkers || !dateRange) return { list: [] as { key: string; date: string; cat: MarkerCat; title: string }[], counts, capped: [] as MarkerCat[] }
    const inRange = (d: string | null | undefined): d is string =>
      !!d && d >= dateRange.start && d <= dateRange.end
    const buckets: Record<MarkerCat, { date: string; title: string }[]> = {
      earnings: [], k8_high: [], k8_routine: [], other_filing: [], buy: [], sell: [],
    }
    // 8-K material events — richer plain-English labels than the raw filing row.
    for (const e of eventsData?.events ?? []) {
      const d = e.event_date || e.filed_date
      if (!inRange(d)) continue
      const cat: MarkerCat = e.high_signal ? 'k8_high' : 'k8_routine'
      buckets[cat].push({ date: d, title: `${e.labels[0] ?? '8-K'} · ${d}` })
    }
    // SEC filings — 10-K/10-Q and everything else. 8-K comes from events above;
    // Form 3/4/5 are insider filings, shown via the buy/sell categories.
    for (const f of filings) {
      if (!inRange(f.filed_date)) continue
      const form = f.form.toUpperCase()
      if (form.startsWith('8-K') || /^[345](\/A)?$/.test(form)) continue
      const cat: MarkerCat = form.startsWith('10-K') || form.startsWith('10-Q') ? 'earnings' : 'other_filing'
      buckets[cat].push({ date: f.filed_date, title: `${f.label ?? f.form} · ${f.filed_date}` })
    }
    // Form 4 open-market trades.
    for (const t of insidersData?.transactions ?? []) {
      if (!inRange(t.transaction_date)) continue
      if (t.transaction_code === 'P') buckets.buy.push({ date: t.transaction_date, title: `${t.owner_name} bought · ${t.transaction_date}` })
      else if (t.transaction_code === 'S') buckets.sell.push({ date: t.transaction_date, title: `${t.owner_name} sold · ${t.transaction_date}` })
    }
    const list: { key: string; date: string; cat: MarkerCat; title: string }[] = []
    const capped: MarkerCat[] = []
    for (const cat of MARKER_ORDER) {
      const items = buckets[cat]
      counts[cat] = items.length
      if (!cats[cat]) continue
      // Keep the most-recent MARKER_CAP. Sort desc by date first — the source
      // arrays are newest-first, so a bare slice(-CAP) would keep the OLDEST.
      const kept =
        items.length > MARKER_CAP
          ? [...items].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, MARKER_CAP)
          : items
      if (items.length > MARKER_CAP) capped.push(cat)
      kept.forEach((it, i) => list.push({ key: `${cat}-${i}-${it.date}`, date: it.date, cat, title: it.title }))
    }
    return { list, counts, capped }
  }, [showMarkers, cats, eventsData, insidersData, filings, dateRange])

  const overlayMeta = MACRO_DISPLAY.find((m) => m.id === seriesId) ?? null

  return (
    <div className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      {/* Header + mode toggle + range buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-bold text-gray-900">
            {mode === 'wyckoff' ? 'Wyckoff · volume-spread' : 'Price history'}
          </div>
          <div className="mt-0.5 text-[0.78rem] text-gray-500">
            {mode === 'wyckoff'
              ? 'Daily candles · spread + volume · objective measures only'
              : 'Adjusted close (splits & dividends) · nightly data'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {(['price', 'wyckoff'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  'rounded-md px-3 py-1 text-xs font-bold capitalize transition-colors ' +
                  (mode === m
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-slate-500 hover:text-gray-900')
                }
              >
                {m === 'wyckoff' ? 'Wyckoff' : 'Price'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
            {ranges.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => onDaysChange(r.days)}
                className={
                  'rounded-md px-3 py-1 text-xs font-bold transition-colors ' +
                  (days === r.days
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-slate-500 hover:text-gray-900')
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
          on={showMarkers}
          onToggle={() => setShowMarkers((x) => !x)}
          label="Events & filings"
          color="#f59e0b"
          bgOn="bg-amber-50"
          textOn="text-amber-700"
          borderOn="border-amber-200"
        />

        {/* Divider */}
        <span className="text-gray-200">|</span>

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
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[0.76rem] font-semibold text-slate-800 focus:border-violet-600 focus:outline-none"
            >
              {MACRO_DISPLAY.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <span className="text-[0.7rem] text-gray-400">right axis · context only</span>
          </>
        )}
      </div>
      )}

      {/* Marker category filters — each chip shows its count and toggles on/off */}
      {mode === 'price' && showMarkers && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">Show</span>
          {MARKER_ORDER.map((cat) => {
            const meta = MARKER_META[cat]
            const on = cats[cat]
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCats((c) => ({ ...c, [cat]: !c[cat] }))}
                aria-pressed={on}
                title={`${meta.label} — ${markers.counts[cat]} in this range`}
                className={
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[0.7rem] font-semibold transition-colors ' +
                  (on
                    ? 'border-slate-300 bg-white text-slate-700'
                    : 'border-gray-200 bg-slate-50 text-slate-400 hover:text-slate-600')
                }
              >
                <span aria-hidden style={{ color: on ? meta.color : '#cbd5e1' }}>
                  {meta.glyph}
                </span>
                {meta.label}
                <span className="tabular-nums text-slate-400">{markers.counts[cat]}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* VSA legend — Wyckoff mode */}
      {mode === 'wyckoff' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-[0.72rem] font-semibold text-amber-700">
            <span className="h-2 w-2 rounded-sm bg-[#ef9f27]" />
            Climax volume
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-[0.72rem] font-semibold text-slate-600">
            <span className="h-2 w-2 rounded-sm border border-slate-500" />
            Wide spread
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-[0.72rem] font-semibold text-slate-600">
            <span className="h-2 w-2 rounded-sm bg-slate-400" />
            Churn / no-demand
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-0.5 text-[0.72rem] font-semibold text-sky-700">
            <span className="h-2 w-3 rounded-sm border border-dashed border-[#378ADD] bg-[rgba(55,138,221,0.15)]" />
            Trading range
          </span>
          <span className="mx-0.5 h-3 w-px bg-gray-200" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setShowSignals((x) => !x)}
            aria-pressed={showSignals}
            title="Candidate Wyckoff events (Spring, Upthrust, climaxes, strength/weakness). Heuristic — only drawn inside a detected trading range, and never confirmed."
            className={
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.72rem] font-semibold transition-colors ' +
              (showSignals
                ? 'border-violet-200 bg-violet-50 text-violet-700'
                : 'border-gray-200 bg-white text-slate-500 hover:bg-slate-50')
            }
          >
            <span className="h-2 w-2 rounded-full" style={{ background: showSignals ? '#7c3aed' : '#cbd5e1' }} />
            Candidate signals
          </button>
          <button
            type="button"
            onClick={() => setShowPhases((x) => !x)}
            aria-pressed={showPhases}
            title="Shade Wyckoff phases A–E, inferred from the detected event sequence."
            className={
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.72rem] font-semibold transition-colors ' +
              (showPhases
                ? 'border-slate-300 bg-slate-100 text-slate-700'
                : 'border-gray-200 bg-white text-slate-500 hover:bg-slate-50')
            }
          >
            <span className="h-2 w-2 rounded-sm" style={{ background: showPhases ? '#64748b' : '#cbd5e1' }} />
            Phases
          </button>
          <button
            type="button"
            onClick={() => setShowTarget((x) => !x)}
            aria-pressed={showTarget}
            title="Wyckoff range-height objective (cause → effect). A method estimate, not a forecast."
            className={
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.72rem] font-semibold transition-colors ' +
              (showTarget
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-gray-200 bg-white text-slate-500 hover:bg-slate-50')
            }
          >
            <span className="h-2 w-2 rounded-full" style={{ background: showTarget ? '#15803d' : '#cbd5e1' }} />
            Target
          </button>
        </div>
      )}

      {/* Wyckoff context read — renders in ALL Wyckoff cases (context is null when
          there's no valid range, which is the common trending-stock case). */}
      {mode === 'wyckoff' && (
        <div className="mt-2 text-[0.74rem]">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[0.72rem] font-bold uppercase tracking-wide"
              style={
                wyckoff.context?.kind === 'accumulation'
                  ? { background: '#dcfce7', color: '#15803d' }
                  : wyckoff.context?.kind === 'distribution'
                    ? { background: '#fee2e2', color: '#b91c1c' }
                    : { background: '#fef3c7', color: '#92400e' }
              }
            >
              {wyckoff.context?.kind === 'accumulation'
                ? `Accumulation · ${Math.round(wyckoff.context.confidence * 100)}%`
                : wyckoff.context?.kind === 'distribution'
                  ? `Distribution · ${Math.round(wyckoff.context.confidence * 100)}%`
                  : 'No trading range'}
            </span>
            <span className="text-slate-600">{wyckoff.summary}</span>
          </div>
          {(!wyckoff.context || wyckoff.context.kind === 'undetermined') && (
            <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 leading-snug text-amber-800">
              <span className="font-semibold">Why the schematic is empty:</span> this stock is trending, not
              basing, so there's no sideways range to anchor Wyckoff events to. The labels (spring, phases,
              target) are deliberately suppressed — drawing them without a range is how false signals creep in.
              The candles and the climax-volume / wide-spread shading are still objective. Try a shorter window
              (3M/6M) to catch a consolidation, or use the Price view.
            </p>
          )}
        </div>
      )}

      {/* Legend for active overlays */}
      {mode === 'price' && (showMA50 || showMA200 || (showMarkers && markers.capped.length > 0)) && (
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
          {showMarkers && markers.capped.length > 0 && (
            <span className="text-gray-400">
              Showing the most recent {MARKER_CAP} per type —{' '}
              {markers.capped.map((c) => MARKER_META[c].label).join(', ')} capped in this range.
            </span>
          )}
        </div>
      )}

      {/* Charts */}
      {mode === 'wyckoff' ? (
        <div className="mt-4">
          <WyckoffChart
            analysis={wyckoff}
            isFetching={isFetching}
            showSignals={showSignals}
            showPhases={showPhases}
            showTarget={showTarget}
          />
        </div>
      ) : (
      <div className="mt-4 transition-opacity" style={{ opacity: isFetching ? 0.55 : 1 }}>
        {priceRows.length < 2 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-gray-400">
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
                  cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
                  content={
                    <PriceTooltip
                      overlayMeta={overlayOn ? overlayMeta : null}
                      showMA={showMA50 || showMA200}
                    />
                  }
                />

                {/* Filing/event markers — x snapped to the nearest price bar.
                    Filings sit on top, insider trades on the bottom axis. */}
                {markers.list.map((m) => {
                  const meta = MARKER_META[m.cat]
                  return (
                    <ReferenceLine
                      key={m.key}
                      yAxisId="price"
                      x={snapToBar(m.date) ?? undefined}
                      stroke={meta.color}
                      strokeWidth={1.25}
                      strokeDasharray="3 2"
                      label={{
                        value: meta.glyph,
                        position: meta.pos === 'top' ? 'top' : 'insideBottom',
                        fontSize: 10,
                        fill: meta.color,
                      }}
                    />
                  )
                })}

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
                <div className="pr-1 text-right text-[0.65rem] text-gray-400">Volume</div>
              </div>
            )}
          </>
        )}
      </div>
      )}

      {mode === 'wyckoff' && <WyckoffReadPanel analysis={wyckoff} prices={prices} />}
    </div>
  )
}
