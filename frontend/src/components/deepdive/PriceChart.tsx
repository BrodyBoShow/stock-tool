import { useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
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
import { fmtDate, fmtSignedPct, fmtVol, tickLabel } from '@/lib/format'
import { analyzeWyckoff, buildEvidence, walkForwardGrade } from '@/lib/wyckoff'
import type { WyckoffAnalysis, WyckoffBacktest } from '@/lib/wyckoff'
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
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-card">
      <div className="font-semibold text-gray-900">{fmtDate(label)}</div>
      <div className="mt-0.5 text-blue-600">
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
    <div className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs shadow-card">
      <div className="font-semibold text-gray-900">{fmtDate(label)}</div>
      <div className="text-gray-500">Vol {fmtVol(typeof vol === 'number' ? vol : null)}</div>
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
          : 'border-gray-200 bg-white text-slate-500 hover:bg-slate-50'
      }`}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: on ? color : '#cbd5e1' }} />
      {label}
    </button>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
      <div className="text-[0.58rem] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-[0.95rem] font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="text-[0.58rem] text-gray-400">{sub}</div>}
    </div>
  )
}

/**
 * Wyckoff "read" — evidence-row narration (explain, don't predict) plus an
 * on-demand walk-forward signal grader (no look-ahead). Both client-side, free.
 */
function WyckoffReadPanel({
  analysis,
  prices,
}: {
  analysis: WyckoffAnalysis
  prices: PricePoint[]
}) {
  const narration = useMemo(() => buildEvidence(analysis), [analysis])
  const [grade, setGrade] = useState<WyckoffBacktest | null>(null)
  const [grading, setGrading] = useState(false)

  // Reset the grade when the ticker/series changes (avoids showing stale stats).
  const seriesKey = prices.length ? `${prices[0]?.date}:${prices[prices.length - 1]?.date}:${prices.length}` : ''
  const lastKey = useRef(seriesKey)
  if (lastKey.current !== seriesKey) {
    lastKey.current = seriesKey
    if (grade) setGrade(null)
  }

  const runGrade = () => {
    setGrading(true)
    // Defer the synchronous compute one tick so the button can show "Grading…".
    window.setTimeout(() => {
      try {
        setGrade(walkForwardGrade(prices))
      } finally {
        setGrading(false)
      }
    }, 20)
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {/* evidence rows */}
      <div className="rounded-xl border border-gray-200 bg-slate-50 p-3">
        <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-slate-600">
          Wyckoff read · evidence
        </div>
        {narration.rows.length === 0 ? (
          <p className="mt-2 text-[0.8rem] text-slate-500">{analysis.summary}</p>
        ) : (
          <table className="mt-2 w-full text-[0.78rem]">
            <tbody>
              {narration.rows.map((r, i) => (
                <tr key={i} className="border-b border-[#eef1f6] last:border-0">
                  <td className="whitespace-nowrap py-1 pr-3 align-top font-semibold text-slate-800">{r.term}</td>
                  <td className="py-1 pr-3 align-top text-slate-500">{r.meaning}</td>
                  <td className="whitespace-nowrap py-1 text-right align-top font-medium tabular-nums text-slate-900">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[0.7rem] text-gray-400">{narration.caveat}</p>
        <p className="mt-1 text-[0.72rem] text-slate-600">
          <span className="font-semibold">Watch:</span> {narration.watch}
        </p>
      </div>

      {/* walk-forward grader */}
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-slate-600">
            Signal track record · walk-forward
          </div>
          <button
            type="button"
            onClick={runGrade}
            disabled={grading}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[0.72rem] font-semibold text-indigo-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            {grading ? 'Grading…' : grade ? 'Re-run' : 'Grade signals'}
          </button>
        </div>
        {!grade ? (
          <p className="mt-2 text-[0.78rem] text-slate-500">
            Replays each bar using only prior data, fires the Wyckoff signals point-in-time, then
            grades them on what happened next — no look-ahead. This name only, small sample.
          </p>
        ) : grade.overall.signals === 0 ? (
          <p className="mt-2 text-[0.78rem] text-slate-500">
            No gradeable signals fired across this history.
          </p>
        ) : (
          <div className="mt-2">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Signals" value={String(grade.overall.signals)} />
              <Stat
                label="Fwd hit rate"
                value={`${Math.round(grade.overall.fwdRate * 100)}%`}
                sub={`≥${Math.round(grade.threshold * 100)}% in ${grade.forwardDays}d`}
              />
              <Stat label="Avg fwd return" value={fmtSignedPct(grade.overall.avgFwdReturn)} />
            </div>
            <div className="mt-2 text-[0.72rem] text-slate-500">
              Target-before-stop:{' '}
              {grade.overall.tbsResolved
                ? `${Math.round(grade.overall.tbsRate * 100)}% of ${grade.overall.tbsResolved} resolved`
                : 'none resolved'}
            </div>
            <table className="mt-2 w-full text-[0.74rem]">
              <thead>
                <tr className="text-left text-[0.6rem] uppercase tracking-wide text-slate-400">
                  <th className="py-1">Signal</th>
                  <th className="py-1">N</th>
                  <th className="py-1">Hit</th>
                  <th className="py-1">Avg</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(grade.byType).map(([t, s]) => (
                  <tr key={t} className="border-t border-slate-50">
                    <td className="py-1 font-semibold text-slate-800">{t}</td>
                    <td className="py-1 tabular-nums">{s.signals}</td>
                    <td className="py-1 tabular-nums">{Math.round(s.fwdRate * 100)}%</td>
                    <td className="py-1 tabular-nums">{fmtSignedPct(s.avgFwdReturn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[0.68rem] text-gray-400">
              Walk-forward, no look-ahead · one ticker, small sample — directional, not proof.
            </p>
          </div>
        )}
      </div>
    </div>
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
  const [showSignals, setShowSignals] = useState(true)
  const [showPhases, setShowPhases] = useState(true)
  const [showTarget, setShowTarget] = useState(false)
  const [overlayOn, setOverlayOn] = useState(false)
  const [seriesId, setSeriesId] = useState('VIXCLS')
  const [showMA50, setShowMA50] = useState(false)
  const [showMA200, setShowMA200] = useState(false)
  const [showVolume, setShowVolume] = useState(false)
  const [showEvents, setShowEvents] = useState(false)
  const ranges = useMemo(buildRanges, [])

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
          on={showEvents}
          onToggle={() => setShowEvents((x) => !x)}
          label="Events"
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
          {/* When Events is on, always report the status of BOTH marker types
              so an empty result reads as "no data", not a broken toggle. */}
          {showEvents &&
            (visibleEvents.length > 0 ? (
              <span className="flex items-center gap-1 text-amber-700">
                <span className="inline-block h-3 w-0.5 rounded" style={{ background: '#f59e0b' }} />
                8-K filing ({visibleEvents.length})
              </span>
            ) : (
              <span className="text-gray-400">No high-signal 8-Ks in this range</span>
            ))}
          {showEvents &&
            (visibleBuys.length > 0 ? (
              <span className="flex items-center gap-1 text-green-700">
                <span className="inline-block h-3 w-0.5 rounded" style={{ background: '#22c55e' }} />
                Insider buy ({visibleBuys.length})
              </span>
            ) : (
              <span className="text-gray-400">No insider buys in this range</span>
            ))}
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
                  content={
                    <PriceTooltip
                      overlayMeta={overlayOn ? overlayMeta : null}
                      showMA={showMA50 || showMA200}
                    />
                  }
                />

                {/* Event reference lines — x snapped to the nearest price bar */}
                {visibleEvents.map((e) => (
                  <ReferenceLine
                    key={e.accession_no}
                    yAxisId="price"
                    x={snapToBar(e.event_date || e.filed_date) ?? undefined}
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
                    x={snapToBar(t.transaction_date!) ?? undefined}
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
