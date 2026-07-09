import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useChartTheme } from '@/lib/chartTheme'

import { RANGES, rangeStartIndex, rangeStats, rebase } from '../portfolioUi'
import type { RangeKey } from '../portfolioUi'
import { fmtDate, fmtSignedPct } from '@/lib/format'
import type { PortfolioPerformance } from '@/types/api'

const PORT = 'var(--accent)' // portfolio line — the brand accent (indigo)
const BENCH = 'var(--info)' // benchmark — cyan, dashed, kept distinct from the accent

/**
 * Growth-of-$1 vs the benchmark on a SINGLE Y-axis (spec: Show don't tell — no
 * dual-axis charts, explicit legend, labeled units). Drawdown is deliberately
 * NOT overlaid here (it lived on a hidden right axis before — the friction we're
 * removing); it moves to the unified Performance/Stress module. Hover any point
 * for exact values.
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
  const { rows, stats } = useMemo(() => {
    const { dates, twr_curve, bench_curve } = performance
    const start = rangeStartIndex(dates, range)
    const winDates = dates.slice(start)
    const twr = rebase(twr_curve, start)
    const hasBench = bench_curve.length === twr_curve.length
    const bench = hasBench ? rebase(bench_curve, start) : []
    const r = twr.map((v, i) => ({
      date: winDates[i] ?? '',
      twr: v,
      bench: hasBench ? bench[i] : undefined,
    }))
    return { rows: r, stats: rangeStats(dates, twr_curve, bench_curve, start) }
  }, [performance, range])

  const since = performance.dates[0]
    ? fmtDate(performance.dates[0]).replace(/,.*/, '')
    : ''
  const ct = useChartTheme()

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
              onClick={() => onRangeChange(r)}
              className={`min-h-[28px] rounded-full px-2.5 text-[0.7rem] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] ${
                r === range ? 'bg-primary text-white' : 'text-muted hover:bg-[var(--surface-3)]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
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
            labelFormatter={(d) => fmtDate(String(d))}
            formatter={(v: number, name: string) => [`${v.toFixed(3)}×`, name]}
            contentStyle={{
              fontSize: 11,
              borderRadius: 8,
              background: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--ink)',
            }}
          />
          <Line type="monotone" dataKey="twr" name="Your portfolio" stroke={ct.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="bench" name={benchmark} stroke={ct.info} strokeWidth={1.8} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>

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
        Growth of $1{since ? ` · since ${since}` : ''} · single-axis (no dual axis) · hover for exact
        values
      </p>
    </div>
  )
}
