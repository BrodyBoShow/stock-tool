/**
 * Performance panel — the Portfolio tab's headline chart.
 *
 * Growth mode plots the time-weighted return (deposit timing stripped out)
 * rebased to 1.0 at the range start, against the benchmark, with optional
 * drawdown overlay, cash-flow event dots, and underperformance shading.
 * Value mode plots raw dollars vs net invested. Quick stats summarize the
 * visible window. Everything here is measurement, not advice.
 */
import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  RANGES,
  drawdownSeries,
  rangeStartIndex,
  rangeStats,
  rebase,
} from '@/components/portfolio/portfolioUi'
import type { RangeKey } from '@/components/portfolio/portfolioUi'
import { plColor } from '@/lib/colors'
import {
  DASH,
  fmtDate,
  fmtMoney,
  fmtPct,
  fmtShortDate,
  fmtSignedPct,
} from '@/lib/format'
import type { PortfolioEvent, PortfolioPerformance } from '@/types/api'

export interface PerformancePanelProps {
  performance: PortfolioPerformance
  benchmark: string // e.g. 'SPY'
  range: RangeKey
  onRangeChange: (r: RangeKey) => void
}

type Mode = 'growth' | 'value'

interface ChartRow {
  date: string
  twr?: number
  bench?: number
  /** Drawdown as a PERCENT number (≤ 0) for the right axis. */
  dd?: number
  /** [twr, bench] range while trailing the benchmark — a BAND between the two
   *  curves (a scalar here would fill from the chart floor, encoding nothing). */
  under?: [number, number]
  value?: number
  invested?: number
}

interface EventDot {
  date: string
  y: number
  color: string
  kind: PortfolioEvent['type']
}

const EVENT_COLORS: Record<PortfolioEvent['type'], string> = {
  buy: '#16a34a',
  sell: '#dc2626',
  dividend: '#8b5cf6',
  deposit: '#f59e0b',
  withdrawal: '#f59e0b',
  fee: '#64748b',
}

const MAX_EVENT_DOTS = 80

const PILL_BASE = 'rounded-full px-2.5 py-1 text-[0.7rem] font-semibold'
const PILL_ON = `${PILL_BASE} bg-indigo-50 text-indigo-600 ring-1 ring-indigo-600`
const PILL_OFF = `${PILL_BASE} text-slate-500 ring-1 ring-gray-200`

interface StatCellProps {
  label: string
  value: string
  sub?: string
  color?: string
}

function StatCell({ label, value, sub, color }: StatCellProps) {
  return (
    <div className="bg-white p-2.5">
      <div className="text-[0.65rem] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div
        className="text-[0.82rem] font-semibold tabular-nums text-slate-800"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      {sub ? (
        <div className="text-[0.65rem] tabular-nums text-slate-400">{sub}</div>
      ) : null}
    </div>
  )
}

export function PerformancePanel({
  performance,
  benchmark,
  range,
  onRangeChange,
}: PerformancePanelProps) {
  const [mode, setMode] = useState<Mode>('growth')
  const [showDrawdown, setShowDrawdown] = useState(false)
  const [showEvents, setShowEvents] = useState(true)
  const [showUnderperf, setShowUnderperf] = useState(true)

  const derived = useMemo(() => {
    const { dates, twr_curve, bench_curve, value, net_invested, events } =
      performance
    const start = rangeStartIndex(dates, range)
    const winDates = dates.slice(start)

    const rows: ChartRow[] = []
    let eventDots: EventDot[] = []
    let eventsCapped = false

    if (mode === 'growth') {
      const twr = rebase(twr_curve, start)
      const hasBench = bench_curve.length === twr_curve.length
      const bench = hasBench ? rebase(bench_curve, start) : []
      const dd = drawdownSeries(twr)
      for (let i = 0; i < twr.length; i++) {
        const b = hasBench ? bench[i] : undefined
        rows.push({
          date: winDates[i] ?? '',
          twr: twr[i],
          bench: b,
          dd: dd[i] * 100,
          under: b != null && twr[i] < b ? ([twr[i], b] as [number, number]) : undefined,
        })
      }

      // Event dots pinned to the TWR line (date → window index via for loop).
      const idxByDate: Record<string, number> = {}
      for (let i = 0; i < winDates.length; i++) idxByDate[winDates[i]] = i
      const first = winDates[0]
      const last = winDates[winDates.length - 1]
      const byDate: Record<string, PortfolioEvent> = {}
      const orderedDates: string[] = []
      for (const ev of events) {
        if (!first || ev.date < first || ev.date > last) continue
        if (idxByDate[ev.date] == null) continue
        if (!byDate[ev.date]) {
          byDate[ev.date] = ev
          orderedDates.push(ev.date)
        }
      }
      orderedDates.sort()
      if (orderedDates.length > MAX_EVENT_DOTS) {
        eventsCapped = true
      }
      const kept = orderedDates.slice(-MAX_EVENT_DOTS)
      const dots: EventDot[] = []
      for (const d of kept) {
        const ev = byDate[d]
        const y = twr[idxByDate[d]]
        if (y != null) {
          dots.push({ date: d, y, color: EVENT_COLORS[ev.type], kind: ev.type })
        }
      }
      eventDots = dots
    } else {
      const vals = value.slice(start)
      const invested = net_invested.slice(start)
      for (let i = 0; i < vals.length; i++) {
        rows.push({
          date: winDates[i] ?? '',
          value: vals[i],
          invested: invested[i],
        })
      }
    }

    const stats = rangeStats(dates, twr_curve, bench_curve, start)
    return { rows, eventDots, eventsCapped, stats }
  }, [performance, range, mode])

  const { rows, eventDots, eventsCapped, stats } = derived
  const growth = mode === 'growth'

  const hint = `TWR strips out deposit timing — your picking skill vs the benchmark. Value view shows dollars vs what you put in.${
    eventsCapped && growth && showEvents
      ? ` Showing the ${MAX_EVENT_DOTS} most recent events.`
      : ''
  }`

  return (
    <div className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="mb-3">
        <h3 className="text-[0.9rem] font-semibold text-slate-800">
          Performance
        </h3>
        <p className="text-[0.7rem] text-slate-400">{hint}</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={r === range ? PILL_ON : PILL_OFF}
              onClick={() => onRangeChange(r)}
            >
              {r}
            </button>
          ))}
        </div>

        <span className="h-4 w-px bg-gray-200" aria-hidden />

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={growth ? PILL_ON : PILL_OFF}
            onClick={() => setMode('growth')}
          >
            Growth of $1
          </button>
          <button
            type="button"
            className={!growth ? PILL_ON : PILL_OFF}
            onClick={() => setMode('value')}
          >
            Value vs invested
          </button>
        </div>

        <span className="h-4 w-px bg-gray-200" aria-hidden />

        <label className="flex cursor-pointer items-center gap-1 text-[0.7rem] text-slate-500">
          <input
            type="checkbox"
            checked={showDrawdown}
            onChange={(e) => setShowDrawdown(e.target.checked)}
          />
          Drawdown
        </label>
        {growth ? (
          <>
            <label className="flex cursor-pointer items-center gap-1 text-[0.7rem] text-slate-500">
              <input
                type="checkbox"
                checked={showEvents}
                onChange={(e) => setShowEvents(e.target.checked)}
              />
              Events
            </label>
            <label className="flex cursor-pointer items-center gap-1 text-[0.7rem] text-slate-500">
              <input
                type="checkbox"
                checked={showUnderperf}
                onChange={(e) => setShowUnderperf(e.target.checked)}
              />
              Underperformance shading
            </label>
          </>
        ) : null}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            minTickGap={40}
            tickFormatter={(d: string) => d.slice(0, 7)}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            tickFormatter={
              growth ? (v: number) => `${v.toFixed(2)}x` : (v: number) => fmtMoney(v)
            }
            domain={['auto', 'auto']}
            width={56}
          />
          {growth ? (
            <YAxis
              yAxisId="dd"
              orientation="right"
              hide={!showDrawdown}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={40}
            />
          ) : null}
          <Tooltip
            labelFormatter={(d) => fmtDate(String(d))}
            formatter={(v: number, name: string) => {
              if (!growth) return [fmtMoney(v), name]
              if (name === 'Drawdown') return [`${v.toFixed(1)}%`, name]
              return [`${v.toFixed(3)}x`, name]
            }}
            contentStyle={{ fontSize: 11, borderRadius: 8, borderColor: '#e5e7eb' }}
          />

          {growth && showUnderperf ? (
            <Area
              dataKey="under"
              name="Underperformance"
              fill="#fee2e2"
              fillOpacity={0.5}
              stroke="none"
              tooltipType="none"
              isAnimationActive={false}
            />
          ) : null}
          {growth && showDrawdown ? (
            <Area
              yAxisId="dd"
              dataKey="dd"
              name="Drawdown"
              fill="#fda4af"
              fillOpacity={0.25}
              stroke="#f43f5e"
              strokeWidth={1}
              isAnimationActive={false}
            />
          ) : null}
          {growth ? (
            <Line
              type="monotone"
              dataKey="twr"
              name="Portfolio"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          {growth ? (
            <Line
              type="monotone"
              dataKey="bench"
              name={benchmark}
              stroke="#3b82f6"
              strokeWidth={1.8}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          {!growth ? (
            <Line
              type="monotone"
              dataKey="value"
              name="Market value"
              stroke="#4f46e5"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          {!growth ? (
            <Line
              type="monotone"
              dataKey="invested"
              name="Net invested"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          {growth && showEvents
            ? eventDots.map((d) => (
                <ReferenceDot
                  key={d.date}
                  x={d.date}
                  y={d.y}
                  r={3.5}
                  fill={d.color}
                  stroke="#fff"
                  strokeWidth={1}
                  isFront
                />
              ))
            : null}
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[0.7rem] text-slate-500">
        {growth ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: '#8b5cf6' }} />
              Portfolio
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: '#3b82f6' }} />
              {benchmark}
            </span>
            {showUnderperf ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#fee2e2' }} />
                Trailing {benchmark}
              </span>
            ) : null}
            {showDrawdown ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded" style={{ background: '#f43f5e' }} />
                Drawdown
              </span>
            ) : null}
            {showEvents ? <span>● events</span> : null}
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: '#4f46e5' }} />
              Market value
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: '#94a3b8' }} />
              Net invested
            </span>
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-3 xl:grid-cols-6">
        <StatCell
          label={`Return (${range})`}
          value={stats.ret != null ? fmtSignedPct(stats.ret) : DASH}
          color={stats.ret != null ? plColor(stats.ret) : undefined}
        />
        <StatCell
          label={`vs ${benchmark}`}
          value={
            stats.deltaPp != null
              ? `${stats.deltaPp >= 0 ? '+' : ''}${stats.deltaPp.toFixed(1)} pp`
              : DASH
          }
          color={stats.deltaPp != null ? plColor(stats.deltaPp) : undefined}
        />
        <StatCell
          label="Best day"
          value={stats.bestDay ? fmtSignedPct(stats.bestDay.ret) : DASH}
          sub={stats.bestDay ? fmtShortDate(stats.bestDay.date) : undefined}
          color={stats.bestDay ? plColor(stats.bestDay.ret) : undefined}
        />
        <StatCell
          label="Worst day"
          value={stats.worstDay ? fmtSignedPct(stats.worstDay.ret) : DASH}
          sub={stats.worstDay ? fmtShortDate(stats.worstDay.date) : undefined}
          color={stats.worstDay ? plColor(stats.worstDay.ret) : undefined}
        />
        <StatCell
          label="Up days"
          value={stats.upPct != null ? fmtPct(stats.upPct) : DASH}
        />
        <StatCell
          label="Volatility"
          value={stats.vol != null ? fmtPct(stats.vol) : DASH}
        />
      </div>
    </div>
  )
}
