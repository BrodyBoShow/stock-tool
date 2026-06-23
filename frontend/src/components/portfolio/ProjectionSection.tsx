import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { getProjection } from '@/lib/api'

import { StatCard } from './StatCard'

/** Forward Monte Carlo cone for the current holdings (correlated, real
 * covariance). Display-only; a projection, not a forecast. */
export function ProjectionSection() {
  const [years, setYears] = useState(10)
  const [monthly, setMonthly] = useState(0)
  const [feePct, setFeePct] = useState(0)
  const [stress, setStress] = useState(false)
  const [params, setParams] = useState({ years: 10, monthly: 0, annual_fee: 0, stress: false })
  const { data, isFetching, error } = useQuery({
    queryKey: ['projection', params],
    queryFn: () => getProjection(params),
    staleTime: 5 * 60 * 1000,
  })

  const fmtMoney = (v: number | null | undefined) =>
    v == null
      ? '—'
      : Math.abs(v) >= 1000
        ? `$${Math.round(v / 1000).toLocaleString()}k`
        : `$${Math.round(v)}`

  const coneData = useMemo(() => {
    if (!data?.cone) return []
    return data.cone.years.map((y, i) => ({
      year: `Y${y}`,
      p10: data.cone!.p10[i],
      p50: data.cone!.p50[i],
      p90: data.cone!.p90[i],
      band: [data.cone!.p10[i], data.cone!.p90[i]] as [number, number],
    }))
  }, [data])

  const run = () => setParams({ years, monthly, annual_fee: feePct / 100, stress })

  return (
    <SectionCard
      title="Projection — Monte Carlo cone"
      hint="Simulates your current holdings forward, drawn correlated (Cholesky) so positions move together in stress. Volatility & correlation are trailing; expected returns are shrunk toward a market prior. A projection, not a forecast."
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-[0.72rem] font-semibold text-slate-600">
          Years
          <input
            type="number" min={1} max={40} value={years}
            onChange={(e) => setYears(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
            className="ml-2 w-16 rounded-lg border border-gray-200 px-2 py-1 text-[0.8rem]"
          />
        </label>
        <label className="text-[0.72rem] font-semibold text-slate-600">
          Monthly $
          <input
            type="number" min={0} step={50} value={monthly}
            onChange={(e) => setMonthly(Math.max(0, Number(e.target.value) || 0))}
            className="ml-2 w-24 rounded-lg border border-gray-200 px-2 py-1 text-[0.8rem]"
          />
        </label>
        <label className="text-[0.72rem] font-semibold text-slate-600">
          Fee %/yr
          <input
            type="number" min={0} max={10} step={0.1} value={feePct}
            onChange={(e) => setFeePct(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
            className="ml-2 w-16 rounded-lg border border-gray-200 px-2 py-1 text-[0.8rem]"
          />
        </label>
        <button
          type="button" onClick={() => setStress((s) => !s)} aria-pressed={stress}
          className={
            'rounded-lg border px-2.5 py-1 text-[0.74rem] font-semibold transition-colors ' +
            (stress ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-slate-500 hover:bg-slate-50')
          }
        >
          Stress regime
        </button>
        <button
          type="button" onClick={run} disabled={isFetching}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-[0.78rem] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
        >
          {isFetching ? 'Running…' : 'Run'}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-600">Couldn&rsquo;t run the projection.</p>
      ) : !data ? (
        <Skeleton className="h-[260px] w-full rounded-card" />
      ) : !data.has_portfolio ? (
        <p className="text-sm text-slate-500">Add holdings to project your portfolio forward.</p>
      ) : data.insufficient_history ? (
        <p className="text-sm text-slate-500">
          Not enough price history for your holdings to project yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={`Median in ${data.params?.years}y`} value={fmtMoney(data.terminal?.p50)} />
            <StatCard
              label="Range (P10–P90)"
              value={`${fmtMoney(data.terminal?.p10)} – ${fmtMoney(data.terminal?.p90)}`}
            />
            <StatCard label="You contribute" value={fmtMoney(data.contributed)} />
            <StatCard
              label="Typical worst drawdown"
              value={data.max_drawdown ? `${Math.round(data.max_drawdown.p50 * 100)}%` : '—'}
            />
          </div>
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={coneData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={56} tickFormatter={(v: number) => fmtMoney(v)} />
                <Tooltip
                  formatter={(value: number | number[], name) =>
                    Array.isArray(value)
                      ? [`${fmtMoney(value[0])} – ${fmtMoney(value[1])}`, 'P10–P90']
                      : [fmtMoney(value), name === 'p50' ? 'Median' : String(name)]
                  }
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
                />
                <Area dataKey="band" stroke="none" fill="#c7d2fe" fillOpacity={0.45} isAnimationActive={false} />
                <Line dataKey="p90" stroke="#a5b4fc" strokeWidth={1} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
                <Line dataKey="p10" stroke="#a5b4fc" strokeWidth={1} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
                <Line dataKey="p50" stroke="#4f46e5" strokeWidth={2.2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {data.prob_gain != null && (
            <p className="mt-2 text-[0.78rem] text-slate-600">
              In {Math.round(data.prob_gain * 100)}% of simulations the portfolio ends above what
              you put in{data.excluded && data.excluded.length > 0
                ? ` · excluded (too little history): ${data.excluded.join(', ')}`
                : ''}.
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[0.72rem] font-semibold text-slate-500">
              Assumptions — portfolio {Math.round((data.portfolio_assumptions?.ann_return ?? 0) * 100)}%/yr
              return, {Math.round((data.portfolio_assumptions?.ann_vol ?? 0) * 100)}% vol
              {data.stress ? ' · STRESS regime' : ''}
            </summary>
            <table className="mt-2 w-full text-[0.74rem]">
              <thead>
                <tr className="text-left text-[0.6rem] uppercase tracking-wide text-slate-400">
                  <th className="py-1">Holding</th>
                  <th className="py-1">Weight</th>
                  <th className="py-1">Return (used)</th>
                  <th className="py-1">Return (trailing)</th>
                  <th className="py-1">Vol</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings_assumptions?.map((a) => (
                  <tr key={a.ticker} className="border-t border-slate-50">
                    <td className="py-1 font-semibold text-slate-800">{a.ticker}</td>
                    <td className="py-1 tabular-nums">{Math.round(a.weight * 100)}%</td>
                    <td className="py-1 tabular-nums">{Math.round(a.ann_return * 100)}%</td>
                    <td className="py-1 tabular-nums text-gray-400">{Math.round(a.ann_return_trailing * 100)}%</td>
                    <td className="py-1 tabular-nums">{Math.round(a.ann_vol * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="mt-2 text-[0.7rem] text-gray-400">{data.disclaimer}</p>
        </>
      )}
    </SectionCard>
  )
}
