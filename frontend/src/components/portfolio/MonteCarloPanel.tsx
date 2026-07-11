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

import { InfoTip } from '@/components/ui/InfoTip'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { runProjection } from '@/lib/api'
import { useChartTheme } from '@/lib/chartTheme'
import {
  CHART_LABEL_SIZE,
  CHART_TICK_SIZE,
  FORM_INPUT,
  FORM_LABEL,
} from '@/lib/constants'
import type { ProjectionRunRequest } from '@/types/api'

import { StatCard } from './StatCard'

export interface MonteCarloPanelProps {
  benchmark: string
  suggestedWeights: Record<string, number> | null
}

const PRESET_CHIP =
  'rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[0.7rem] text-muted transition-colors hover:border-accent hover:text-accent'

const CHECK_PILL =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[0.74rem] font-semibold transition-colors '

const fmtMoney = (v: number | null | undefined) =>
  v == null
    ? '—'
    : Math.abs(v) >= 1000
      ? `$${Math.round(v / 1000).toLocaleString()}k`
      : `$${Math.round(v)}`

/** Upgraded Monte Carlo cone: presets, goal probability, benchmark-comparison
 * cone, and optional "apply suggested rebalance first". Display-only; a
 * projection, not a forecast. */
export function MonteCarloPanel(props: MonteCarloPanelProps) {
  const [years, setYears] = useState(10)
  const [monthly, setMonthly] = useState(0)
  const [feePct, setFeePct] = useState(0)
  const [stress, setStress] = useState(false)
  const [goal, setGoal] = useState('')
  const [compareBench, setCompareBench] = useState(false)
  const [applyRebalance, setApplyRebalance] = useState(false)
  const [params, setParams] = useState<ProjectionRunRequest>({
    years: 10,
    monthly: 0,
    annual_fee: 0,
    stress: false,
    goal: null,
    compare_bench: null,
    weights: null,
  })

  const { data, isFetching, isPending, error } = useQuery({
    queryKey: ['projection', 'v2', params],
    queryFn: () => runProjection(params),
    staleTime: 5 * 60 * 1000,
  })

  const coneData = useMemo(() => {
    if (!data?.cone) return []
    const bench = data.benchmark?.cone_p50 ?? null
    return data.cone.years.map((y, i) => ({
      year: `Y${y}`,
      p10: data.cone!.p10[i],
      p50: data.cone!.p50[i],
      p90: data.cone!.p90[i],
      band: [data.cone!.p10[i], data.cone!.p90[i]] as [number, number],
      bench: bench ? bench[i] : undefined,
    }))
  }, [data])

  const run = () => {
    const goalNum = Number(goal)
    setParams({
      years,
      monthly,
      annual_fee: feePct / 100,
      stress,
      goal: goalNum || null,
      compare_bench: compareBench ? props.benchmark : null,
      weights: applyRebalance && props.suggestedWeights ? props.suggestedWeights : null,
    })
  }

  const preset = (y: number, m: number, s?: boolean) => {
    setYears(y)
    setMonthly(m)
    if (s != null) setStress(s)
  }

  const ct = useChartTheme()

  return (
    <SectionCard
      title="Projection — Monte Carlo cone"
      hint="Simulates your current holdings forward, drawn correlated (Cholesky) so positions move together in stress. Volatility & correlation are trailing; expected returns are shrunk toward a market prior. A projection, not a forecast."
    >
      <div className="mb-2 flex flex-wrap gap-1.5">
        <button type="button" className={PRESET_CHIP} onClick={() => preset(20, 500)}>
          Retire in 20y / $500 mo
        </button>
        <button type="button" className={PRESET_CHIP} onClick={() => preset(5, 2000)}>
          House in 5y / $2k mo
        </button>
        <button type="button" className={PRESET_CHIP} onClick={() => preset(10, 0, true)}>
          Preserve capital / $0 mo
        </button>
        <button type="button" className={PRESET_CHIP} onClick={() => preset(10, 0, false)}>
          Current (10y / $0)
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className={FORM_LABEL}>
          Years
          <input
            type="number" min={1} max={40} value={years}
            onChange={(e) => setYears(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
            className={`${FORM_INPUT} ml-2 w-16`}
          />
        </label>
        <label className={FORM_LABEL}>
          Monthly $
          <input
            type="number" min={0} step={50} value={monthly}
            onChange={(e) => setMonthly(Math.max(0, Number(e.target.value) || 0))}
            className={`${FORM_INPUT} ml-2 w-24`}
          />
        </label>
        <label className={FORM_LABEL}>
          Fee %/yr
          <input
            type="number" min={0} max={10} step={0.1} value={feePct}
            onChange={(e) => setFeePct(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
            className={`${FORM_INPUT} ml-2 w-16`}
          />
        </label>
        <label className={FORM_LABEL}>
          Goal $
          <input
            type="number" min={0} value={goal} placeholder="e.g. 20000"
            onChange={(e) => setGoal(e.target.value)}
            className={`${FORM_INPUT} ml-2 w-24`}
          />
        </label>
        <span className="inline-flex items-center">
          <button
            type="button" onClick={() => setStress((s) => !s)} aria-pressed={stress}
            className={
              'rounded-lg border px-2.5 py-1 text-[0.74rem] font-semibold transition-colors ' +
              (stress ? 'border-neg-border bg-neg-soft text-neg' : 'border-line bg-surface text-muted hover:bg-surface-2')
            }
          >
            Stress regime
          </button>
          <InfoTip text="Runs the simulation in a crisis regime — volatility and cross-holding correlations are raised toward 2008/2020 levels, so positions fall together. A stress test, not the base case." />
        </span>
        <label
          className={
            CHECK_PILL +
            (compareBench
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line bg-surface text-muted hover:bg-surface-2')
          }
        >
          <input
            type="checkbox" checked={compareBench}
            onChange={(e) => setCompareBench(e.target.checked)}
            className="h-3 w-3 accent-indigo-600"
          />
          Compare to: just buy {props.benchmark}
        </label>
        <label
          title={props.suggestedWeights == null ? 'No suggested fixes right now' : undefined}
          className={
            CHECK_PILL +
            (props.suggestedWeights == null
              ? 'cursor-not-allowed border-line bg-surface-2 text-subtle'
              : applyRebalance
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-surface text-muted hover:bg-surface-2')
          }
        >
          <input
            type="checkbox"
            checked={applyRebalance && props.suggestedWeights != null}
            disabled={props.suggestedWeights == null}
            onChange={(e) => setApplyRebalance(e.target.checked)}
            className="h-3 w-3 accent-indigo-600"
          />
          Apply suggested rebalance first
        </label>
        <button
          type="button" onClick={run} disabled={isFetching}
          className="rounded-lg bg-accent-solid px-3 py-1 text-[0.78rem] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {isFetching ? 'Running…' : 'Run'}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-neg">Couldn&rsquo;t run the projection.</p>
      ) : isPending || !data ? (
        <Skeleton className="h-64 w-full rounded-card" />
      ) : !data.has_portfolio ? (
        <p className="text-sm text-muted">Add holdings to project your portfolio forward.</p>
      ) : data.insufficient_history ? (
        <p className="text-sm text-muted">
          Not enough price history for your holdings to project yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label={`Median in ${data.params?.years}y`}
              value={fmtMoney(data.terminal?.p50)}
              sub={
                data.benchmark
                  ? `${data.benchmark.ticker} baseline: ${fmtMoney(data.benchmark.terminal.p50)}`
                  : undefined
              }
              tip="The middle outcome — half the simulations end above this, half below. The center of a wide range, not a target."
            />
            <StatCard
              label="Range (P10–P90)"
              value={`${fmtMoney(data.terminal?.p10)} – ${fmtMoney(data.terminal?.p90)}`}
              tip="80% of simulated outcomes land between these (10th–90th percentile) — the edges of the cone."
            />
            <StatCard
              label="You contribute"
              value={fmtMoney(data.contributed)}
              tip="Today's value plus any monthly contributions over the horizon — the cash you put in."
            />
            <StatCard
              label="Median worst drawdown"
              value={data.max_drawdown ? `${Math.round(data.max_drawdown.p50 * 100)}%` : '—'}
              tip="The 50th-percentile deepest peak-to-trough drop across the simulations — a normal valley to expect, not the worst case."
            />
          </div>
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={coneData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={ct.grid} vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: CHART_TICK_SIZE, fill: ct.axis }} minTickGap={20} />
                <YAxis tick={{ fontSize: CHART_TICK_SIZE, fill: ct.axis }} width={56} tickFormatter={(v: number) => fmtMoney(v)} />
                <Tooltip
                  labelFormatter={(y) => `Year ${y} of the simulation`}
                  formatter={(value: number | number[], name) =>
                    Array.isArray(value)
                      ? [`${fmtMoney(value[0])} – ${fmtMoney(value[1])}`, 'P10–P90']
                      : [
                          fmtMoney(value),
                          name === 'p50'
                            ? 'Median'
                            : name === 'bench'
                              ? `${data.benchmark?.ticker ?? 'Benchmark'} median`
                              : String(name),
                        ]
                  }
                  contentStyle={{ fontSize: CHART_LABEL_SIZE, borderRadius: 8, background: ct.tooltipBg, borderColor: ct.tooltipBorder, color: ct.tooltipText }}
                />
                <Area dataKey="band" stroke="none" fill={ct.accent} fillOpacity={0.2} isAnimationActive={false} />
                <Line dataKey="p90" stroke={ct.accent} strokeOpacity={0.5} strokeWidth={1} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
                <Line dataKey="p10" stroke={ct.accent} strokeOpacity={0.5} strokeWidth={1} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
                <Line dataKey="p50" stroke={ct.accent} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                {data.benchmark && (
                  <Line dataKey="bench" stroke={ct.muted} strokeWidth={1.5} dot={false} strokeDasharray="5,4" isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-[0.74rem] text-ink">
            {data.simulated_weights && (
              <span className="mr-1.5 rounded bg-accent-soft px-1.5 text-[0.64rem] font-bold text-accent">
                rebalanced weights
              </span>
            )}
            <span className="tabular-nums">
              Median {fmtMoney(data.terminal?.p50)} · P10 {fmtMoney(data.terminal?.p10)} · P90{' '}
              {fmtMoney(data.terminal?.p90)}
              {data.prob_gain != null &&
                ` · ${Math.round(data.prob_gain * 100)}% of sims end above what you put in`}
              {data.benchmark &&
                ` · beat ${data.benchmark.ticker}: ${Math.round(data.benchmark.prob_beat * 100)}% of sims`}
              {data.prob_goal != null &&
                ` · hit ${fmtMoney(data.goal)} goal: ${Math.round(data.prob_goal * 100)}% of sims`}
            </span>
          </div>
          {data.excluded && data.excluded.length > 0 && (
            <p className="mt-2 text-[0.72rem] text-muted">
              excluded (too little history): {data.excluded.join(', ')}
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[0.72rem] font-semibold text-muted">
              Assumptions — portfolio {Math.round((data.portfolio_assumptions?.ann_return ?? 0) * 100)}%/yr
              return, {Math.round((data.portfolio_assumptions?.ann_vol ?? 0) * 100)}% vol
              {data.stress ? ' · STRESS regime' : ''}
            </summary>
            <table className="mt-2 w-full text-[0.74rem]">
              <thead>
                <tr className="text-left text-[0.6rem] uppercase tracking-wide text-muted">
                  <th className="py-1">Holding</th>
                  <th className="py-1">Weight</th>
                  <th className="py-1">
                    Return (used)
                    <InfoTip text="The annual return fed into the simulation — shrunk 50% toward a long-run market prior (~8%/yr) because short-window estimates are unreliable." />
                  </th>
                  <th className="py-1">
                    Return (trailing)
                    <InfoTip text="The raw trailing annualized return from this holding's own history — shown for reference; the simulation uses the shrunk figure at left." />
                  </th>
                  <th className="py-1">Vol</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings_assumptions?.map((a, i) => (
                  <tr key={a.ticker ?? i} className="border-t border-divider">
                    <td className="py-1 font-semibold text-ink">{a.ticker ?? '—'}</td>
                    <td className="py-1 tabular-nums">{Math.round(a.weight * 100)}%</td>
                    <td className="py-1 tabular-nums">{Math.round(a.ann_return * 100)}%</td>
                    <td className="py-1 tabular-nums text-muted">{Math.round(a.ann_return_trailing * 100)}%</td>
                    <td className="py-1 tabular-nums">{Math.round(a.ann_vol * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="mt-2 text-[0.7rem] text-muted">{data.disclaimer}</p>
        </>
      )}
    </SectionCard>
  )
}
