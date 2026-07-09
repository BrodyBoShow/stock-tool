import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useChartTheme } from '@/lib/chartTheme'
import type { BacktestICBlock, BacktestKeyResult, BacktestRunResponse } from '@/types/api'

/** Shared Recharts tooltip style — themed surface/border/text (fixes the
 * default WHITE tooltip box that stayed white in dark mode). */
function tipStyle(ct: ReturnType<typeof useChartTheme>) {
  return {
    fontSize: 12,
    borderRadius: 8,
    background: ct.tooltipBg,
    borderColor: ct.tooltipBorder,
    color: ct.tooltipText,
  }
}

/** Equity curves: selected factor's top quintile (+ optional long-short) vs SPY
 * vs universe EW. Linear or log Y so a flat-looking line isn't hiding the action. */
export function EquityChart({ data, sel, factorLabel, showLongShort, logScale }: {
  data: BacktestRunResponse
  sel: BacktestKeyResult
  factorLabel: string
  showLongShort: boolean
  logScale: boolean
}) {
  const points = useMemo(() => {
    const bench = data.benchmarks
    if (!sel || !bench) return []
    const top = new Map(sel.curves.dates.map((d, i) => [d, sel.curves.top[i]]))
    const ls = new Map(sel.curves.dates.map((d, i) => [d, sel.curves.long_short[i]]))
    return bench.dates.map((d, i) => ({
      date: d.slice(0, 7),
      strategy: top.get(d) ?? null,
      longshort: ls.get(d) ?? null,
      spy: bench.spy[i] ?? null,
      universe: bench.universe_ew[i] ?? null,
    }))
  }, [data, sel])
  const ct = useChartTheme()

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: ct.axis }} minTickGap={28} />
        <YAxis
          tick={{ fontSize: 11, fill: ct.axis }}
          tickFormatter={(v: number) => `${v.toFixed(logScale ? 0 : 1)}x`}
          scale={logScale ? 'log' : 'linear'}
          domain={logScale ? [0.5, 'auto'] : ['auto', 'auto']}
          allowDataOverflow={false}
          width={44}
        />
        <Tooltip
          formatter={(v: number, name: string) => [`${v?.toFixed(2)}x`, name]}
          contentStyle={tipStyle(ct)}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="strategy" name={`Top quintile (${factorLabel})`}
          stroke={ct.accent} strokeWidth={2.2} dot={false} connectNulls />
        {/* Long-short growth can cross zero; a log axis can't plot <=0 (it would
            silently drop those points and bridge the gap), so it shows on the
            linear axis only. */}
        {showLongShort && !logScale && (
          <Line type="monotone" dataKey="longshort" name="Long-short (top − bottom)"
            stroke={ct.pos} strokeWidth={1.8} strokeDasharray="5 3" dot={false} connectNulls />
        )}
        <Line type="monotone" dataKey="spy" name="S&P 500 (SPY)"
          stroke={ct.info} strokeWidth={1.8} dot={false} connectNulls />
        <Line type="monotone" dataKey="universe" name="Universe equal-weight"
          stroke={ct.muted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Drawdown of the top-quintile curve (running peak-to-trough). */
export function DrawdownChart({ comp }: { comp: BacktestKeyResult }) {
  const points = useMemo(() => {
    const top = comp.curves.top
    return comp.curves.dates.map((d, i) => {
      const peak = Math.max(...top.slice(0, i + 1))
      return { date: d.slice(0, 7), dd: (top[i] / peak - 1) * 100 }
    })
  }, [comp])
  const ct = useChartTheme()

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: ct.axis }} minTickGap={28} />
        <YAxis tick={{ fontSize: 11, fill: ct.axis }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={44} />
        <Tooltip
          formatter={(v: number) => [`${v.toFixed(1)}%`, 'Drawdown']}
          contentStyle={tipStyle(ct)}
        />
        <Area type="monotone" dataKey="dd" stroke={ct.neg} fill={ct.neg} fillOpacity={0.18} strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** CAGR by quintile — the spread, visually. Top bucket highlighted. */
export function QuintileChart({ res }: { res: BacktestKeyResult }) {
  const points = Object.entries(res.bucket_cagrs)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([b, cagr]) => ({
      bucket: `Q${b}${Number(b) === 5 ? ' (top)' : Number(b) === 1 ? ' (bottom)' : ''}`,
      top: Number(b) === 5,
      cagr: cagr == null ? null : cagr * 100,
    }))
  const ct = useChartTheme()
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: ct.axis }} />
        <YAxis tick={{ fontSize: 11, fill: ct.axis }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={44} />
        <Tooltip
          formatter={(v: number) => [`${v?.toFixed(1)}% CAGR`, '']}
          contentStyle={tipStyle(ct)}
        />
        <ReferenceLine y={0} stroke={ct.axis} />
        <Bar dataKey="cagr" radius={[5, 5, 0, 0]} maxBarSize={56}>
          {points.map((p, i) => (
            <Cell key={i} fill={ct.accent} fillOpacity={p.top ? 1 : 0.4} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Information Coefficient over time — month bars + a trailing-6mo average line
 * so signal decay (a falling line) is visible at a glance. */
export function ICChart({ ic }: { ic: BacktestICBlock }) {
  const points = useMemo(() => {
    const win = 6
    const raw = ic.series
    return raw.map((s, i) => {
      const slice = raw
        .slice(Math.max(0, i - win + 1), i + 1)
        .map((x) => x.ic)
        .filter((v): v is number => v != null)
      const trail = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null
      return {
        date: s.date.slice(0, 7),
        ic: s.ic == null ? null : Number(s.ic.toFixed(4)),
        trail: trail == null ? null : Number(trail.toFixed(4)),
      }
    })
  }, [ic])
  const ct = useChartTheme()
  return (
    <ResponsiveContainer width="100%" height={210}>
      <ComposedChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: ct.axis }} minTickGap={28} />
        <YAxis tick={{ fontSize: 11, fill: ct.axis }} width={44} tickFormatter={(v: number) => v.toFixed(2)} />
        <Tooltip
          formatter={(v: number, n: string) => [v?.toFixed(3), n === 'trail' ? '6-mo avg IC' : 'rank IC']}
          contentStyle={tipStyle(ct)}
        />
        <ReferenceLine y={0} stroke={ct.axis} />
        <Bar dataKey="ic" radius={[2, 2, 0, 0]} maxBarSize={14}>
          {points.map((p, i) => (
            <Cell key={i} fill={(p.ic ?? 0) >= 0 ? ct.pos : ct.neg} fillOpacity={0.85} />
          ))}
        </Bar>
        <Line type="monotone" dataKey="trail" name="trail" stroke={ct.accent} strokeWidth={2} dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
