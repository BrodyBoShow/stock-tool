import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ErrorCard } from '@/components/ErrorCard'
import { Skeleton } from '@/components/ui/skeleton'
import { getBacktest } from '@/lib/api'
import type { BacktestKeyResult, BacktestRunResponse } from '@/types/api'

const KEY_LABELS: Record<string, string> = {
  composite: 'Composite',
  growth: 'Growth',
  value: 'Value',
  quality: 'Quality',
  momentum: 'Momentum',
}

const fmtPct = (x: number | null | undefined, signed = true) =>
  x == null ? '—' : `${signed && x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`
const fmtSharpe = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2))

function SectionCard({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="text-base font-bold text-[#111827]">{title}</div>
      {hint && <p className="mt-0.5 text-[0.78rem] text-[#9ca3af]">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Equity curves: top-quintile strategy vs S&P 500 (SPY) vs universe EW. */
function EquityChart({ data }: { data: BacktestRunResponse }) {
  const points = useMemo(() => {
    const comp = data.results?.composite
    const bench = data.benchmarks
    if (!comp || !bench) return []
    // Benchmark dates are the full grid; the composite curve aligns to its own
    // dates — index both by date so gaps never misalign.
    const top = new Map(comp.curves.dates.map((d, i) => [d, comp.curves.top[i]]))
    return bench.dates.map((d, i) => ({
      date: d.slice(0, 7),
      strategy: top.get(d) ?? null,
      spy: bench.spy[i] ?? null,
      universe: bench.universe_ew[i] ?? null,
    }))
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={28} />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickFormatter={(v: number) => `${v.toFixed(1)}x`}
          domain={['auto', 'auto']}
          width={44}
        />
        <Tooltip
          formatter={(v: number, name: string) => [`${v?.toFixed(2)}x`, name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="strategy" name="Top quintile (composite)"
          stroke="#4f46e5" strokeWidth={2.2} dot={false} connectNulls />
        <Line type="monotone" dataKey="spy" name="S&P 500 (SPY)"
          stroke="#0ea5e9" strokeWidth={1.8} dot={false} connectNulls />
        <Line type="monotone" dataKey="universe" name="Universe equal-weight"
          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Drawdown of the top-quintile curve (running peak-to-trough). */
function DrawdownChart({ comp }: { comp: BacktestKeyResult }) {
  const points = useMemo(() => {
    let peak = -Infinity
    return comp.curves.dates.map((d, i) => {
      const v = comp.curves.top[i]
      peak = Math.max(peak, v)
      return { date: d.slice(0, 7), dd: (v / peak - 1) * 100 }
    })
  }, [comp])

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={28} />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          width={44}
        />
        <Tooltip
          formatter={(v: number) => [`${v.toFixed(1)}%`, 'Drawdown']}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <Area type="monotone" dataKey="dd" stroke="#dc2626" fill="#fee2e2" strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** CAGR by quintile for one ranking key — the spread, visually. */
function QuintileChart({ res }: { res: BacktestKeyResult }) {
  const points = Object.entries(res.bucket_cagrs)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([b, cagr]) => ({
      bucket: `Q${b}${Number(b) === 5 ? ' (top)' : Number(b) === 1 ? ' (bottom)' : ''}`,
      cagr: cagr == null ? null : cagr * 100,
    }))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          width={44}
        />
        <Tooltip
          formatter={(v: number) => [`${v?.toFixed(1)}% CAGR`, '']}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <Bar dataKey="cagr" fill="#4f46e5" radius={[5, 5, 0, 0]} maxBarSize={56} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function LabPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['lab', 'backtest'],
    queryFn: getBacktest,
    staleTime: 60 * 60 * 1000, // refreshed monthly by the workflow
  })
  const [factorKey, setFactorKey] = useState('composite')

  if (isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-[120px] w-full rounded-card" />
        <Skeleton className="h-[380px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  if (!data.has_results || !data.results) {
    return (
      <div className="rounded-card border border-[#e5e7eb] bg-white p-10 text-center shadow-card">
        <h1 className="text-xl font-extrabold text-[#0f172a]">Factor Lab</h1>
        <p className="mx-auto mt-3 max-w-[520px] text-sm text-[#64748b]">
          No backtest stored yet. The monthly workflow
          (<code className="rounded bg-[#f1f5f9] px-1">backtest.yml</code>) computes and stores
          one automatically on the 2nd of each month — or run it once now with{' '}
          <code className="rounded bg-[#f1f5f9] px-1">
            python scripts/run_backtest.py --store
          </code>
          .
        </p>
      </div>
    )
  }

  const results = data.results
  const comp = results.composite
  const keys = ['composite', ...Object.keys(results).filter((k) => k !== 'composite')]
  const sel = results[factorKey] ?? comp

  return (
    <div className="space-y-5">
      {/* header */}
      <header className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
        <div className="h-1 bg-gradient-to-r from-[#2563eb] via-[#4f46e5] to-[#0ea5e9]" />
        <div className="px-7 pb-5 pt-6">
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
            <span className="text-[#4f46e5]">StockBud</span>
            <span className="text-[#d1d5db]">/</span>
            <span className="text-[#94a3b8]">Factor Lab</span>
          </div>
          <h1 className="mt-2 text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-[#0f172a]">
            Does the model actually work?
          </h1>
          <p className="mt-2 text-[0.9rem] text-[#64748b]">
            Point-in-time backtest of <code>{data.config_version}</code> ·{' '}
            {data.start_date} → {data.end_date} · {data.params?.rebalances} monthly rebalances ·
            quintiles, equal-weight, {data.params?.cost_bps}bps/side · refreshed monthly
          </p>
        </div>
      </header>

      {/* honesty banner */}
      <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-[0.82rem] text-amber-800">
        <strong>Survivor-only universe:</strong> delisted/bankrupt names are absent, so absolute
        returns are optimistic. Trust the <strong>spread</strong> (top quintile beats bottom,
        monotone buckets, positive long-short Sharpe) — not the headline CAGR. This validates the
        ranking methodology; it is not a tradeable track record.
      </div>

      {/* equity curve */}
      <SectionCard
        title="Growth of $1 — top quintile vs benchmarks"
        hint="Composite top quintile (rebalanced monthly, net of cost estimate) vs SPY total return and the equal-weight scored universe."
      >
        <EquityChart data={data} />
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* drawdown */}
        <SectionCard
          title="Top-quintile drawdown"
          hint="Peak-to-trough of the strategy curve — the pain you'd have sat through."
        >
          <DrawdownChart comp={comp} />
        </SectionCard>

        {/* quintile spread with factor selector */}
        <SectionCard
          title="CAGR by quintile"
          hint="A working signal steps up left to right. Flat or U-shaped = no ranking power (or survivor noise in the bottom bucket)."
        >
          <div className="mb-3 flex flex-wrap gap-[5px]">
            {keys.map((k) => {
              const selected = factorKey === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFactorKey(k)}
                  className="rounded-full px-[11px] py-[3px] text-[0.72rem] font-semibold transition-shadow"
                  style={
                    selected
                      ? { background: '#eef2ff', color: '#4f46e5', boxShadow: 'inset 0 0 0 1.5px #4f46e5' }
                      : { background: '#ffffff', color: '#64748b', boxShadow: 'inset 0 0 0 1px #e5e7eb' }
                  }
                >
                  {KEY_LABELS[k] ?? k}
                </button>
              )
            })}
          </div>
          <QuintileChart res={sel} />
        </SectionCard>
      </div>

      {/* summary table */}
      <SectionCard
        title="Factor scoreboard"
        hint="Top quintile stats + the long-short spread per ranking key. Win rate = % of months the top quintile was positive."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[0.84rem]">
            <thead>
              <tr className="border-b border-[#eef1f6] text-left text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
                <th className="py-2 pr-4">Ranking</th>
                <th className="py-2 pr-4">Top-Q CAGR</th>
                <th className="py-2 pr-4">Top-Q Sharpe</th>
                <th className="py-2 pr-4">Win rate</th>
                <th className="py-2 pr-4">Max DD</th>
                <th className="py-2 pr-4">L-S CAGR</th>
                <th className="py-2 pr-4">L-S Sharpe</th>
                <th className="py-2">Turnover/mo</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const r = results[k]
                const top = r.buckets['5'] ?? r.buckets[String(Object.keys(r.buckets).length)]
                const lsSharpe = r.long_short.sharpe
                return (
                  <tr key={k} className="border-b border-[#f8fafc]">
                    <td className="py-2.5 pr-4 font-bold text-[#1e293b]">{KEY_LABELS[k] ?? k}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtPct(top?.cagr)}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtSharpe(top?.sharpe)}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtPct(r.win_rate_top, false)}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-[#dc2626]">
                      {fmtPct(top?.max_drawdown, false)}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtPct(r.long_short.cagr)}</td>
                    <td
                      className="py-2.5 pr-4 font-semibold tabular-nums"
                      style={{ color: lsSharpe != null && lsSharpe > 0.3 ? '#059669' : '#64748b' }}
                    >
                      {fmtSharpe(lsSharpe)}
                    </td>
                    <td className="py-2.5 tabular-nums">{fmtPct(r.avg_turnover, false)}</td>
                  </tr>
                )
              })}
              {data.benchmarks && (
                <tr>
                  <td className="py-2.5 pr-4 font-bold text-[#64748b]">S&amp;P 500 (SPY)</td>
                  <td className="py-2.5 pr-4 tabular-nums">{fmtPct(data.benchmarks.spy_stats.cagr)}</td>
                  <td className="py-2.5 pr-4 tabular-nums">{fmtSharpe(data.benchmarks.spy_stats.sharpe)}</td>
                  <td className="py-2.5 pr-4">—</td>
                  <td className="py-2.5 pr-4 tabular-nums text-[#dc2626]">
                    {fmtPct(data.benchmarks.spy_stats.max_drawdown, false)}
                  </td>
                  <td className="py-2.5 pr-4">—</td>
                  <td className="py-2.5 pr-4">—</td>
                  <td className="py-2.5">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <p className="pb-2 text-center text-xs text-[#9ca3af]">
        Backtest is recomputed monthly by GitHub Actions (point-in-time data, no look-ahead) —
        research context, not investment advice.
      </p>
    </div>
  )
}
