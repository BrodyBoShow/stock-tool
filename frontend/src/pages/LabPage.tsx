import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ErrorCard } from '@/components/ErrorCard'
import { DrawdownChart, EquityChart, ICChart, QuintileChart } from '@/components/lab/charts'
import {
  ciPct,
  ciSharpe,
  fmtPct,
  fmtSharpe,
  icMeanTone,
  icTone,
  KEY_LABELS,
  lsTone,
  pctileTone,
  sharpeTone,
  type Tone,
  TONE_HEX,
  vsSpyTone,
} from '@/components/lab/shared'
import { VerdictBanner } from '@/components/lab/VerdictBanner'
import { buildVerdict } from '@/components/lab/verdict'
import { InfoTip } from '@/components/ui/InfoTip'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { getBacktest } from '@/lib/api'
import { TABLE_HEAD_ROW } from '@/lib/constants'
import { fmtDate } from '@/lib/format'

/** Dense KPI tile (~35% shorter than before) — traffic-light value + tooltip. */
function Stat({ label, value, sub, tone = 'neutral', tip }: {
  label: string
  value: string
  sub?: string
  tone?: Tone
  tip?: string
}) {
  return (
    <div className="rounded-card border border-gray-200 bg-white px-3 py-2.5 shadow-card">
      <div className="flex items-center text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-slate-400">
        <span>{label}</span>
        {tip && <InfoTip text={tip} />}
      </div>
      <div
        className="mt-0.5 text-[1.15rem] font-extrabold leading-tight tabular-nums"
        style={{ color: TONE_HEX[tone] }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.64rem] leading-tight text-gray-400">{sub}</div>}
    </div>
  )
}

/** Segmented toggle (e.g. Linear / Log). */
function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-slate-50 p-0.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className="rounded-md px-2.5 py-1 text-[0.72rem] font-semibold transition-colors"
            style={on ? { background: '#ffffff', color: '#4f46e5', boxShadow: '0 1px 2px rgba(15,23,42,0.08)' } : { color: '#64748b' }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function LabPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['lab', 'backtest'],
    queryFn: getBacktest,
    staleTime: 60 * 60 * 1000, // refreshed monthly by the workflow
  })
  const [factorKey, setFactorKey] = useState('composite')
  const [showLongShort, setShowLongShort] = useState(false)
  const [logScale, setLogScale] = useState(false)

  if (isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-[120px] w-full rounded-card" />
        <Skeleton className="h-[96px] w-full rounded-card" />
        <Skeleton className="h-[380px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  if (!data.has_results || !data.results) {
    return (
      <div className="rounded-card border border-gray-200 bg-white p-10 text-center shadow-card">
        <h1 className="text-xl font-extrabold text-slate-900">Factor Lab</h1>
        <p className="mx-auto mt-3 max-w-[520px] text-sm text-slate-500">
          No backtest stored yet. The monthly workflow
          (<code className="rounded bg-slate-100 px-1">backtest.yml</code>) computes and stores
          one automatically on the 2nd of each month — or run it once now with{' '}
          <code className="rounded bg-slate-100 px-1">python scripts/run_backtest.py --store</code>.
        </p>
      </div>
    )
  }

  const results = data.results
  const comp = results.composite
  const keys = ['composite', ...Object.keys(results).filter((k) => k !== 'composite')]
  const sel = results[factorKey] ?? comp
  const selLabel = KEY_LABELS[factorKey] ?? factorKey
  const selTop = sel.buckets['5'] ?? sel.buckets[String(Object.keys(sel.buckets).length)]
  const spyCagr = data.benchmarks?.spy_stats.cagr ?? null
  const rp = data.significance?.random_portfolio ?? null
  const verdict = buildVerdict(sel, selLabel, factorKey === 'composite' ? rp : null)

  const FactorPills = (
    <div className="flex flex-wrap gap-[5px]">
      {keys.map((k) => {
        const selected = factorKey === k
        return (
          <button
            key={k}
            type="button"
            onClick={() => setFactorKey(k)}
            aria-pressed={selected}
            className="rounded-full px-[11px] py-[3px] text-[0.72rem] font-semibold transition-shadow"
            style={
              selected
                ? { background: '#eef2ff', color: '#4f46e5', boxShadow: 'inset 0 0 0 1.5px #4f46e5' }
                : { background: '#ffffff', color: '#334155', boxShadow: 'inset 0 0 0 1px #cbd5e1' }
            }
          >
            {KEY_LABELS[k] ?? k}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-5">
      {/* header */}
      <header className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
        <div className="h-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500" />
        <div className="px-7 pb-5 pt-6">
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
            <span className="text-indigo-600">StockBud</span>
            <span className="text-gray-300">/</span>
            <span className="text-slate-400">Factor Lab</span>
          </div>
          <h1 className="mt-2 text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-slate-900">
            Does the model actually work?
          </h1>
          <p className="mt-2 text-[0.9rem] text-slate-500">
            Point-in-time backtest of <code>{data.config_version}</code> · {data.start_date} →{' '}
            {data.end_date} · {data.params?.rebalances} monthly rebalances · quintiles, equal-weight,{' '}
            {data.params?.cost_bps}bps/side · sub-$1 names dropped, returns winsorized
          </p>
          {data.generated_at && (
            <p className="mt-1 text-[0.74rem] text-slate-400">
              Computed {fmtDate(data.generated_at.slice(0, 10))} · served from store · refreshes monthly
            </p>
          )}
        </div>
      </header>

      {/* factor selector — drives the verdict and every chart below */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-slate-600">
          Ranking
        </span>
        {FactorPills}
      </div>

      {/* the decision: a plain-language verdict for the selected ranking */}
      <VerdictBanner v={verdict} />

      {/* dense KPI strip — headline + significance at a glance, traffic-lit */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Top-Q CAGR"
          value={fmtPct(selTop?.cagr)}
          sub={`vs SPY ${fmtPct(spyCagr)}`}
          tone={vsSpyTone(selTop?.cagr, spyCagr)}
          tip="Compound annual growth of the top-ranked quintile, rebalanced monthly, net of the cost estimate. Survivor-biased — compare to SPY, don't read the level literally."
        />
        <Stat
          label="Top-Q Sharpe"
          value={fmtSharpe(selTop?.sharpe)}
          sub="risk-adjusted"
          tone={sharpeTone(selTop?.sharpe)}
          tip="Annualized return ÷ volatility for the top quintile. Higher = smoother ride per unit of return."
        />
        <Stat
          label="Mean IC"
          value={sel.ic ? sel.ic.mean.toFixed(3) : '—'}
          sub={sel.ic ? `${(sel.ic.pct_positive * 100).toFixed(0)}% months positive` : 'n/a'}
          tone={icMeanTone(sel.ic?.mean)}
          tip="Information Coefficient: the average month's rank correlation between score and next-month return. ~0.03+ is a useful signal; 0 = no ranking power."
        />
        <Stat
          label="IC t-stat"
          value={sel.ic?.t_stat != null ? sel.ic.t_stat.toFixed(2) : '—'}
          sub="|t| ≥ 2 ≈ significant"
          tone={icTone(sel.ic?.t_stat)}
          tip="How many standard errors the mean IC sits above zero. |t| ≥ 2 means the ranking's predictiveness is unlikely to be luck. The stablest 'real vs noise' read."
        />
        <Stat
          label="Long-short Sharpe"
          value={fmtSharpe(sel.long_short.sharpe)}
          sub="top − bottom spread"
          tone={lsTone(sel.long_short.sharpe)}
          tip="Risk-adjusted return of going long the top quintile and short the bottom. Positive = the spread is real and, in principle, tradeable market-neutral."
        />
        <Stat
          label="Win rate (top-Q)"
          value={fmtPct(sel.win_rate_top, false)}
          sub="% months positive"
          tip="Share of months the top quintile had a positive return."
        />
      </div>

      {/* equity curve */}
      <SectionCard
        title={`Growth of $1 — ${selLabel} top quintile vs benchmarks`}
        hint="Top quintile (monthly rebalance, net of cost estimate) vs SPY total return and the equal-weight scored universe."
        tip="Switch to Log when one line dwarfs the others — a log axis shows percentage moves, so compounding is comparable across very different scales."
        right={
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowLongShort((s) => !s)}
              aria-pressed={showLongShort}
              className="rounded-lg border px-2.5 py-1 text-[0.72rem] font-semibold transition-colors"
              style={
                showLongShort
                  ? { borderColor: '#16a34a', background: '#f0fdf4', color: '#16a34a' }
                  : { borderColor: '#e5e7eb', background: '#ffffff', color: '#64748b' }
              }
            >
              {showLongShort ? '✓ ' : ''}Long-short
            </button>
            <Segmented
              value={logScale ? 'log' : 'lin'}
              onChange={(v) => setLogScale(v === 'log')}
              options={[
                { value: 'lin', label: 'Linear' },
                { value: 'log', label: 'Log' },
              ]}
            />
          </div>
        }
      >
        {showLongShort && logScale && (
          <p className="mb-2 text-[0.72rem] text-amber-700">
            Long-short is hidden on the log axis (its growth-of-$1 can cross zero, which a log scale
            can't plot). Switch to Linear to see it.
          </p>
        )}
        <EquityChart data={data} sel={sel} factorLabel={selLabel} showLongShort={showLongShort} logScale={logScale} />
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title={`${selLabel} top-quintile drawdown`}
          hint="Peak-to-trough of the strategy curve — the pain you'd have sat through."
        >
          <DrawdownChart comp={sel} />
        </SectionCard>

        <SectionCard
          title={`${selLabel}: CAGR by quintile`}
          hint="A working signal steps up left to right. Flat or U-shaped = no ranking power."
          tip="Each bar is the equal-weight CAGR of one fifth of the universe, sorted worst (Q1) to best (Q5). The cleaner the climb, the stronger the ranking."
        >
          <QuintileChart res={sel} />
        </SectionCard>
      </div>

      {/* significance & robustness */}
      {sel.ic || rp ? (
        <SectionCard
          title="Is the edge real, or luck?"
          tip="These quantify the signal rigorously, but on a survivor-biased sample. Read the IC t-stat first; the random-portfolio percentile is a single-path statistic, so treat it as supporting colour."
          hint="Information Coefficient, bootstrap confidence intervals, and a random-portfolio null. All seeded — reproducible, not a fresh number each run."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat
              label="Top-Q CAGR 90% CI"
              value={ciPct(sel.bootstrap?.top?.cagr)}
              sub="block bootstrap"
              tone={sel.bootstrap?.top?.cagr ? (sel.bootstrap.top.cagr.lo > 0 ? 'good' : 'warn') : 'neutral'}
              tip="Resampling the monthly returns in blocks 2,000× — the range the top-quintile CAGR lands in 90% of the time. A floor above 0 means the edge isn't a fluke of one good month."
            />
            <Stat
              label="Top-Q Sharpe 90% CI"
              value={ciSharpe(sel.bootstrap?.top?.sharpe)}
              sub="block bootstrap"
              tone={sel.bootstrap?.top?.sharpe ? (sel.bootstrap.top.sharpe.lo > 0 ? 'good' : 'warn') : 'neutral'}
              tip="Same block bootstrap, applied to the top-quintile Sharpe ratio."
            />
            <Stat
              label="Long-short CAGR 90% CI"
              value={ciPct(sel.bootstrap?.long_short?.cagr)}
              sub="block bootstrap"
              tone={sel.bootstrap?.long_short?.cagr ? (sel.bootstrap.long_short.cagr.lo > 0 ? 'good' : 'warn') : 'neutral'}
              tip="Bootstrap CI for the long-short (top − bottom) spread. If this straddles 0, the market-neutral leg isn't reliable."
            />
          </div>

          {rp && (
            <div className="mt-4 rounded-card border border-gray-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-slate-600">
                Random-portfolio null (composite top quintile)
                <InfoTip text="The 'monkey' test: 1,000 random equal-weight baskets of the same size, chained over the same window. Where the real strategy's CAGR lands tells you how much is skill vs market beta." />
              </div>
              <p className="mt-1 text-[0.86rem] text-slate-700">
                The composite top quintile beat{' '}
                <strong style={{ color: TONE_HEX[pctileTone(rp.percentile)] }}>
                  {(rp.percentile * 100).toFixed(0)}%
                </strong>{' '}
                of {rp.n_sims.toLocaleString()} random equal-weight baskets of the same size (~
                {rp.avg_basket} names). Actual {fmtPct(rp.actual_cagr)} CAGR vs random median{' '}
                {fmtPct(rp.p50)} (5–95th pct {fmtPct(rp.p5)} … {fmtPct(rp.p95)}).
              </p>
            </div>
          )}

          {sel.ic && (
            <div className="mt-4">
              <div className="mb-1 flex items-center text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-slate-600">
                Information Coefficient over time — {selLabel}
                <InfoTip text="Green/red bars are each month's rank IC; the indigo line is the trailing 6-month average. A line drifting toward zero is a factor losing its edge." />
              </div>
              <ICChart ic={sel.ic} />
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard
          title="Is the edge real, or luck?"
          hint="Significance & robustness (IC, bootstrap CIs, random-portfolio null)."
        >
          <p className="text-sm text-slate-500">
            Significance stats populate on the next backtest run — the monthly workflow, or{' '}
            <code className="rounded bg-slate-100 px-1">python scripts/run_backtest.py --store</code>.
            The currently stored run predates this feature.
          </p>
        </SectionCard>
      )}

      {/* summary table */}
      <SectionCard
        title="Factor scoreboard"
        hint="Click a row to drive the charts above. Win rate = % of months the top quintile was positive."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[0.84rem]">
            <thead>
              <tr className={TABLE_HEAD_ROW}>
                <th className="py-2 pr-4">Ranking</th>
                <th className="py-2 pr-4">Top-Q CAGR</th>
                <th className="py-2 pr-4">Top-Q Sharpe</th>
                <th className="py-2 pr-4">IC t-stat</th>
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
                const isSel = factorKey === k
                return (
                  <tr
                    key={k}
                    onClick={() => setFactorKey(k)}
                    className={
                      'cursor-pointer border-b border-slate-50 transition-colors hover:bg-slate-50 ' +
                      (isSel ? 'bg-indigo-50' : '')
                    }
                  >
                    <td className="py-2.5 pr-4 font-bold text-slate-800">
                      {isSel && <span className="mr-1 text-indigo-600">▸</span>}
                      {KEY_LABELS[k] ?? k}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtPct(top?.cagr)}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtSharpe(top?.sharpe)}</td>
                    <td
                      className="py-2.5 pr-4 font-semibold tabular-nums"
                      style={{ color: TONE_HEX[icTone(r.ic?.t_stat)] }}
                    >
                      {r.ic?.t_stat != null ? r.ic.t_stat.toFixed(2) : '—'}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtPct(r.win_rate_top, false)}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-red-600">
                      {fmtPct(top?.max_drawdown, false)}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtPct(r.long_short.cagr)}</td>
                    <td
                      className="py-2.5 pr-4 font-semibold tabular-nums"
                      style={{ color: TONE_HEX[lsTone(r.long_short.sharpe)] }}
                    >
                      {fmtSharpe(r.long_short.sharpe)}
                    </td>
                    <td className="py-2.5 tabular-nums">{fmtPct(r.avg_turnover, false)}</td>
                  </tr>
                )
              })}
              {data.benchmarks && (
                <tr>
                  <td className="py-2.5 pr-4 font-bold text-slate-500">S&amp;P 500 (SPY)</td>
                  <td className="py-2.5 pr-4 tabular-nums">{fmtPct(data.benchmarks.spy_stats.cagr)}</td>
                  <td className="py-2.5 pr-4 tabular-nums">{fmtSharpe(data.benchmarks.spy_stats.sharpe)}</td>
                  <td className="py-2.5 pr-4">—</td>
                  <td className="py-2.5 pr-4">—</td>
                  <td className="py-2.5 pr-4 tabular-nums text-red-600">
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

      {/* honesty footer — accurate, no contradictory claims */}
      <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-[0.8rem] leading-relaxed text-amber-800">
        <strong>How to read this honestly.</strong> Two caveats remain: (1){' '}
        <strong>survivorship</strong> — the universe is today's listed names, so absolute returns run
        optimistic; lean on the <em>spread</em> across quintiles, not the headline CAGR. (2) It's an{' '}
        <strong>in-sample</strong> study of the ranking, not a live track record. Sub-$1 names are
        dropped at each rebalance and single-period returns are capped at −90%/+200%, which neutralizes
        gross unadjusted-split spikes (like PPCB's $0.01→$250) — but the cap also clips legitimate
        extreme moves, so read the spread as <em>cleaned, not error-free</em>. Research context — not
        investment advice.
      </div>

      <p className="pb-2 text-center text-xs text-gray-400">
        Backtest recomputed monthly by GitHub Actions (point-in-time data, no look-ahead).
      </p>
    </div>
  )
}
