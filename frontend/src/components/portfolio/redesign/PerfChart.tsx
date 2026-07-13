import { useCallback, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { X } from 'lucide-react'

import { Icon } from '@/components/ui/Icon'
import { useChartTheme } from '@/lib/chartTheme'

import { RANGES, rangeStartIndex, rangeStats, rebase } from '../portfolioUi'
import type { RangeKey } from '../portfolioUi'
import { fmtDate, fmtSignedPct } from '@/lib/format'
import type { PortfolioPerformance } from '@/types/api'

const PORT = 'var(--accent)' // portfolio line — the brand accent (indigo)
const BENCH = 'var(--info)' // benchmark — cyan, dashed, kept distinct from the accent

interface PerfRow {
  date: string
  twr: number
  bench?: number
}

const pp = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}pp`

/** Growth multiple → % return since the window start (rows are rebased to 1). */
const winPct = (v: number | undefined) => (typeof v === 'number' ? (v - 1) * 100 : null)

function PerfTooltip({
  active,
  payload,
  label,
  benchmark,
}: {
  active?: boolean
  payload?: { payload: PerfRow }[]
  label?: string
  benchmark: string
}) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  const you = winPct(r.twr)
  const b = winPct(r.bench)
  const spread = you != null && b != null ? you - b : null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[0.72rem] shadow-[var(--sh-md)]">
      <div className="font-bold text-ink">{fmtDate(String(label))}</div>
      <div className="mt-0.5 space-y-px tabular-nums">
        {you != null && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: PORT }} />
              You
            </span>
            <span className="font-semibold text-ink">{fmtSignedPct(you / 100)}</span>
          </div>
        )}
        {b != null && (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: BENCH }} />
              {benchmark}
            </span>
            <span className="font-semibold text-ink">{fmtSignedPct(b / 100)}</span>
          </div>
        )}
        {spread != null && (
          <div className="mt-0.5 flex items-center justify-between gap-4 border-t border-line pt-0.5">
            <span className="text-muted">Spread</span>
            <span
              className="font-bold"
              style={{ color: spread >= 0 ? 'var(--pos)' : 'var(--neg)' }}
            >
              {pp(spread)}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1 text-[0.62rem] text-subtle">since window start · drag to measure</div>
    </div>
  )
}

/**
 * Growth-of-$1 vs the benchmark on a SINGLE Y-axis (spec: Show don't tell — no
 * dual-axis charts, explicit legend, labeled units). Drawdown is deliberately
 * NOT overlaid here (it lived on a hidden right axis before — the friction we're
 * removing); it moves to the unified Performance/Stress module. Hover shows
 * both window returns + the spread; drag across the chart to measure any
 * sub-period (you vs benchmark vs spread over exactly that stretch).
 */
export function PerfChart({
  performance,
  benchmark,
  range,
  onRangeChange,
}: {
  performance: PortfolioPerformance
  benchmark: string
  range: RangeKey
  onRangeChange: (r: RangeKey) => void
}) {
  const [drag, setDrag] = useState<{ start: string; end: string } | null>(null)
  const [measure, setMeasure] = useState<{ start: string; end: string } | null>(null)

  const { rows, stats } = useMemo(() => {
    const { dates, twr_curve, bench_curve } = performance
    const start = rangeStartIndex(dates, range)
    const winDates = dates.slice(start)
    const twr = rebase(twr_curve, start)
    const hasBench = bench_curve.length === twr_curve.length
    const bench = hasBench ? rebase(bench_curve, start) : []
    const r: PerfRow[] = twr.map((v, i) => ({
      date: winDates[i] ?? '',
      twr: v,
      bench: hasBench ? bench[i] : undefined,
    }))
    return { rows: r, stats: rangeStats(dates, twr_curve, bench_curve, start) }
  }, [performance, range])

  // Measured sub-period: exact return of each series between the two endpoints
  // (each series' value at end ÷ its value at start — not window-start-based).
  const measured = useMemo(() => {
    if (!measure) return null
    const i1 = rows.findIndex((r) => r.date === measure.start)
    const i2 = rows.findIndex((r) => r.date === measure.end)
    if (i1 < 0 || i2 < 0 || i1 === i2) return null
    const [a, b] = i1 <= i2 ? [i1, i2] : [i2, i1]
    const ra = rows[a]
    const rb = rows[b]
    const you = ra.twr > 0 ? (rb.twr / ra.twr - 1) * 100 : null
    const bch =
      typeof ra.bench === 'number' && typeof rb.bench === 'number' && ra.bench > 0
        ? (rb.bench / ra.bench - 1) * 100
        : null
    return {
      from: ra.date,
      to: rb.date,
      days: Math.max(1, Math.round((new Date(rb.date).getTime() - new Date(ra.date).getTime()) / 86_400_000)),
      you,
      bench: bch,
      spread: you != null && bch != null ? you - bch : null,
    }
  }, [measure, rows])

  const onDown = useCallback((state?: { activeLabel?: string | number }, e?: { button?: number }) => {
    if (e && typeof e.button === 'number' && e.button !== 0) return
    if (typeof state?.activeLabel === 'string') {
      setDrag({ start: state.activeLabel, end: state.activeLabel })
      setMeasure(null)
    }
  }, [])

  const onMove = useCallback((state?: { activeLabel?: string | number }) => {
    if (typeof state?.activeLabel === 'string') {
      const label = state.activeLabel
      setDrag((d) => (d ? { ...d, end: label } : d))
    }
  }, [])

  const onUp = useCallback(() => {
    setDrag((d) => {
      if (d && d.start !== d.end) setMeasure({ start: d.start, end: d.end })
      return null
    })
  }, [])

  const since = performance.dates[0]
    ? fmtDate(performance.dates[0]).replace(/,.*/, '')
    : ''
  const ct = useChartTheme()
  const sel = drag ?? measure

  return (
    <div className="rounded-[var(--r-lg)] border border-[var(--border)] bg-surface p-4 shadow-[var(--sh-sm)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-h3 font-bold text-ink">Performance</h3>
        <div className="flex items-center gap-1" role="group" aria-label="Chart date range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => {
                setMeasure(null)
                setDrag(null)
                onRangeChange(r)
              }}
              className={`min-h-[28px] rounded-full px-2.5 text-[0.7rem] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] ${
                r === range ? 'bg-primary text-inverse' : 'text-muted hover:bg-[var(--surface-3)]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* measured sub-period result */}
      {measured && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-accent bg-accent-soft px-3 py-1.5 text-[0.72rem] font-semibold text-ink">
          <span className="text-accent">Measure</span>
          <span className="tabular-nums">
            {fmtDate(measured.from)} → {fmtDate(measured.to)} · {measured.days}d
          </span>
          {measured.you != null && (
            <span className="tabular-nums">You {fmtSignedPct(measured.you / 100)}</span>
          )}
          {measured.bench != null && (
            <span className="tabular-nums text-muted">
              {benchmark} {fmtSignedPct(measured.bench / 100)}
            </span>
          )}
          {measured.spread != null && (
            <span
              className="tabular-nums font-bold"
              style={{ color: measured.spread >= 0 ? 'var(--pos)' : 'var(--neg)' }}
            >
              spread {pp(measured.spread)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setMeasure(null)}
            aria-label="Clear measurement"
            className="ml-auto rounded-md border border-line bg-surface px-2 py-0.5 text-muted hover:text-ink"
          >
            <Icon icon={X} size={14} />
          </button>
        </div>
      )}

      <div className="select-none">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart
            data={rows}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={() => setDrag(null)}
          >
            <CartesianGrid stroke={ct.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: ct.axis }}
              minTickGap={40}
              tickFormatter={(d: string) => d.slice(0, 7)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: ct.axis }}
              tickFormatter={(v: number) => `${v.toFixed(2)}×`}
              domain={['auto', 'auto']}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: ct.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => (
                <PerfTooltip
                  active={active}
                  payload={payload as unknown as { payload: PerfRow }[] | undefined}
                  label={typeof label === 'string' ? label : undefined}
                  benchmark={benchmark}
                />
              )}
            />
            {sel && sel.start !== sel.end && (
              <ReferenceArea
                x1={sel.start <= sel.end ? sel.start : sel.end}
                x2={sel.start <= sel.end ? sel.end : sel.start}
                fill={ct.accent}
                fillOpacity={0.08}
                stroke={ct.accent}
                strokeOpacity={0.35}
                strokeDasharray="3 3"
              />
            )}
            <Line type="monotone" dataKey="twr" name="Your portfolio" stroke={ct.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="bench" name={benchmark} stroke={ct.info} strokeWidth={1.8} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* explicit legend with each series' window return */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[0.72rem]">
        <span className="flex items-center gap-1.5 font-semibold text-ink">
          <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: PORT }} />
          Your portfolio {stats.ret != null ? fmtSignedPct(stats.ret) : '—'}
        </span>
        <span className="flex items-center gap-1.5 font-semibold text-muted">
          <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: BENCH }} />
          {benchmark} {stats.benchRet != null ? fmtSignedPct(stats.benchRet) : '—'}
        </span>
      </div>
      <p className="mt-1 text-[0.68rem] text-muted">
        Growth of $1{since ? ` · since ${since}` : ''} · single-axis (no dual axis) · hover for both
        returns + spread · drag any stretch to measure it
      </p>
    </div>
  )
}
