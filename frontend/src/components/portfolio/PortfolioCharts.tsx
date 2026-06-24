import { useMemo } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { InfoTip } from '@/components/ui/InfoTip'
import { CHART_LABEL_SIZE, CHART_TICK_SIZE, FACTOR_TIP } from '@/lib/constants'
import { fmtDate, fmtPctl, fmtPrice } from '@/lib/format'
import type { PortfolioResponse } from '@/types/api'

/** Growth of $1 (time-weighted, deposits stripped out) vs SPY. */
export function TwrChart({ data }: { data: PortfolioResponse }) {
  const points = useMemo(() => {
    const p = data.performance
    if (!p) return []
    return p.dates.map((d, i) => ({
      date: d,
      portfolio: p.twr_curve[i] ?? null,
      spy: p.spy_curve[i] ?? null,
    }))
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: CHART_TICK_SIZE, fill: '#94a3b8' }}
          minTickGap={48}
          tickFormatter={(d: string) => d.slice(0, 7)}
        />
        <YAxis
          tick={{ fontSize: CHART_TICK_SIZE, fill: '#94a3b8' }}
          tickFormatter={(v: number) => `${v.toFixed(2)}x`}
          domain={['auto', 'auto']}
          width={52}
        />
        <Tooltip
          labelFormatter={(d) => fmtDate(String(d))}
          formatter={(v: number, name: string) => [`${v?.toFixed(3)}x`, name]}
          contentStyle={{ fontSize: CHART_LABEL_SIZE, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <Legend wrapperStyle={{ fontSize: CHART_LABEL_SIZE }} />
        <Line type="monotone" dataKey="portfolio" name="Portfolio (TWR)"
          stroke="#4f46e5" strokeWidth={2.2} dot={false} connectNulls />
        <Line type="monotone" dataKey="spy" name="S&P 500 (SPY)"
          stroke="#0ea5e9" strokeWidth={1.8} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Market value vs the cash you actually put in — flows separated from growth. */
export function ValueChart({ data }: { data: PortfolioResponse }) {
  const points = useMemo(() => {
    const p = data.performance
    if (!p) return []
    return p.dates.map((d, i) => ({
      date: d,
      value: p.value[i] ?? null,
      invested: p.net_invested[i] ?? null,
    }))
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: CHART_TICK_SIZE, fill: '#94a3b8' }}
          minTickGap={48}
          tickFormatter={(d: string) => d.slice(0, 7)}
        />
        <YAxis
          tick={{ fontSize: CHART_TICK_SIZE, fill: '#94a3b8' }}
          tickFormatter={(v: number) =>
            Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
            : Math.abs(v) >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v.toFixed(0)}`}
          domain={['auto', 'auto']}
          width={56}
        />
        <Tooltip
          labelFormatter={(d) => fmtDate(String(d))}
          formatter={(v: number, name: string) => [fmtPrice(v), name]}
          contentStyle={{ fontSize: CHART_LABEL_SIZE, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <Legend wrapperStyle={{ fontSize: CHART_LABEL_SIZE }} />
        <Area type="monotone" dataKey="value" name="Market value"
          stroke="#4f46e5" strokeWidth={2} fill="url(#pf-fill)" />
        <Line type="stepAfter" dataKey="invested" name="Net invested"
          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** Horizontal 0-100 percentile bars with a universe-median marker at 50. */
export function TiltBars({ data }: { data: PortfolioResponse }) {
  const tilt = data.factor_tilt
  if (!tilt || tilt.composite == null) {
    return (
      <p className="text-sm text-gray-400">
        None of the current holdings have factor scores yet.
      </p>
    )
  }
  const rows: { label: string; v: number | undefined; tip: string }[] = [
    { label: 'Composite', v: tilt.composite, tip: FACTOR_TIP.composite },
    { label: 'Growth', v: tilt.growth_pctl, tip: FACTOR_TIP.growth },
    { label: 'Value', v: tilt.value_pctl, tip: FACTOR_TIP.value },
    { label: 'Quality', v: tilt.quality_pctl, tip: FACTOR_TIP.quality },
    { label: 'Momentum', v: tilt.momentum_pctl, tip: FACTOR_TIP.momentum },
  ]
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <div className="flex w-24 shrink-0 items-center whitespace-nowrap text-[0.78rem] font-semibold text-slate-600">
            {r.label}
            <InfoTip text={r.tip} />
          </div>
          <div className="relative h-3.5 flex-1 rounded-full bg-slate-100">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600"
              style={{ width: `${Math.max(2, r.v ?? 0)}%` }}
            />
            {/* universe-median marker */}
            <div className="absolute inset-y-[-3px] left-1/2 w-px bg-slate-300" />
          </div>
          <div className="w-10 shrink-0 text-right text-[0.8rem] font-bold tabular-nums text-slate-800">
            {fmtPctl(r.v)}
          </div>
        </div>
      ))}
      <p className="pt-1 text-[0.72rem] text-gray-400">
        Market-value-weighted percentile of your holdings (50 = universe median).
        Coverage: {(tilt.coverage * 100).toFixed(0)}% of position value is scored.
      </p>
    </div>
  )
}

const SECTOR_COLORS = [
  '#4f46e5', '#0ea5e9', '#059669', '#d97706', '#dc2626',
  '#7c3aed', '#0d9488', '#be185d', '#65a30d', '#475569', '#94a3b8',
]

export function AllocationBars({ data }: { data: PortfolioResponse }) {
  const sectors = data.allocation?.sectors ?? []
  if (!sectors.length) return <p className="text-sm text-gray-400">No positions.</p>
  return (
    <div className="space-y-2.5">
      {/* stacked strip */}
      <div className="flex h-4 w-full overflow-hidden rounded-full">
        {sectors.map((s, i) => (
          <div
            key={s.sector}
            title={`${s.sector} ${(s.weight! * 100).toFixed(1)}%`}
            style={{
              width: `${(s.weight ?? 0) * 100}%`,
              background: SECTOR_COLORS[i % SECTOR_COLORS.length],
            }}
          />
        ))}
      </div>
      <div className="space-y-1.5 pt-1">
        {sectors.map((s, i) => (
          <div key={s.sector} className="flex items-center gap-2.5 text-[0.8rem]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: SECTOR_COLORS[i % SECTOR_COLORS.length] }}
            />
            <span className="flex-1 truncate text-slate-600">{s.sector}</span>
            <span className="tabular-nums font-semibold text-slate-800">
              {((s.weight ?? 0) * 100).toFixed(1)}%
            </span>
            <span className="w-24 text-right tabular-nums text-slate-400">
              {fmtPrice(s.value)}
            </span>
          </div>
        ))}
        {data.allocation?.cash != null && (
          <div className="flex items-center gap-2.5 border-t border-slate-100 pt-1.5 text-[0.8rem]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-slate-200" />
            <span className="flex-1 text-slate-600">Cash</span>
            <span className="w-24 text-right tabular-nums text-slate-400">
              {fmtPrice(data.allocation.cash)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
