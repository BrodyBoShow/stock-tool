import type { PortfolioFlag, PortfolioSummary } from '@/types/api'
import { InfoTip } from '@/components/ui/InfoTip'
import { plColor } from '@/lib/colors'
import {
  fmtDate,
  fmtPct,
  fmtPrice,
  fmtRatio,
  fmtSignedMoney,
  fmtSignedPct,
} from '@/lib/format'
import { buildVerdict } from '@/components/portfolio/portfolioUi'

/** Live-adjusted headline figures — the container merges intraday quotes into
 * the nightly summary and hands us the result, so this component stays pure. */
export interface HeroView {
  live: boolean
  total_value: number
  day_change: number | null
  day_change_pct: number | null
  unrealized_pl: number
}

export interface PortfolioHeroProps {
  summary: PortfolioSummary
  view: HeroView
  flags: PortfolioFlag[]
  cashTracking: boolean | null
  onSeeFixes: () => void
}

const VERDICT_BANNER: Record<'good' | 'warn' | 'bad', string> = {
  good: 'border-green-300 bg-gradient-to-r from-green-50 to-white',
  warn: 'border-amber-300 bg-gradient-to-r from-amber-50 to-white',
  bad: 'border-amber-300 bg-gradient-to-r from-amber-50 to-red-50',
}

const VERDICT_ICON: Record<'good' | 'warn' | 'bad', string> = {
  good: 'bg-green-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
}

/** Compact metric cell for the hero strip — same content shape as StatCard
 * but sized to pack six across on wide screens. */
function Metric({
  label,
  value,
  sub,
  color,
  tip,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  tip?: string
}) {
  return (
    <div className="bg-white p-3">
      <div className="flex items-center text-[0.6rem] font-semibold uppercase tracking-wide text-slate-400">
        <span>{label}</span>
        {tip && <InfoTip text={tip} />}
      </div>
      <div
        className="mt-0.5 text-[0.95rem] font-bold tabular-nums leading-tight"
        style={{ color: color ?? '#0f172a' }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.68rem] text-slate-500">{sub}</div>}
    </div>
  )
}

/** Portfolio hero card: headline value + day change, an honest plain-English
 * verdict banner (with a jump-to-fixes CTA when flags carry fixes), and a
 * six-cell compact metric strip. All figures are measurement, not advice. */
export function PortfolioHero({
  summary,
  view,
  flags,
  cashTracking,
  onSeeFixes,
}: PortfolioHeroProps): JSX.Element {
  const v = buildVerdict({
    twrTotal: summary.twr_total,
    benchTotal: summary.bench_total,
    benchmark: summary.benchmark,
    volatility: summary.volatility,
    beta: summary.beta,
    flags,
    firstDate: summary.first_date,
  })
  const realizedPlusDivs = summary.realized_pl + summary.dividends_received

  return (
    <div className="overflow-hidden rounded-card border border-gray-200 bg-white shadow-card">
      <div className="h-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500" />
      <div className="p-6">
        {/* Top row: headline value, day delta, live/nightly meta */}
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-[1.9rem] font-extrabold tabular-nums leading-none text-slate-900">
            {fmtPrice(view.total_value)}
          </span>
          <span
            className="text-[0.85rem] font-semibold tabular-nums"
            style={{ color: plColor(view.day_change) }}
          >
            {fmtSignedMoney(view.day_change)} ({fmtSignedPct(view.day_change_pct, 2)}) today
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[0.72rem] text-slate-400">
            {view.live && (
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            )}
            <span>
              {view.live ? 'live · ~15m delay' : 'nightly close'} · since{' '}
              {fmtDate(summary.first_date)}
            </span>
            {cashTracking === false && (
              <span className="flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[0.62rem] font-semibold text-amber-700">
                Positions only
                <InfoTip text="Your transaction history doesn't include deposits or withdrawals, so these figures cover invested positions only — brokerage cash is excluded." />
              </span>
            )}
          </span>
        </div>

        {/* Verdict banner */}
        <div
          className={`my-4 flex items-start gap-3 rounded-lg border p-3.5 ${VERDICT_BANNER[v.tone]}`}
        >
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold text-white ${VERDICT_ICON[v.tone]}`}
            aria-hidden="true"
          >
            {v.tone === 'good' ? '✓' : '!'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[0.85rem] font-semibold text-slate-900">{v.headline}</div>
            <div className="mt-0.5 text-[0.76rem] text-slate-500">{v.detail}</div>
          </div>
          {v.fixCount > 0 && (
            <button
              type="button"
              onClick={onSeeFixes}
              className="shrink-0 self-center rounded-lg bg-slate-900 px-3.5 py-2 text-[0.72rem] font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              See {v.fixCount} fix{v.fixCount === 1 ? '' : 'es'} &rarr;
            </button>
          )}
        </div>

        {/* Metric strip */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 md:grid-cols-3 xl:grid-cols-6">
          <Metric
            label="Time-weighted"
            value={fmtSignedPct(summary.twr_total)}
            sub={`${fmtSignedPct(summary.twr_cagr)}/yr · ${summary.benchmark} ${fmtSignedPct(summary.bench_total)}`}
            color={plColor(summary.twr_total)}
            tip="Time-weighted return strips out the effect of your deposits and withdrawals, so it isolates how good your picks were — comparable to a fund or index."
          />
          <Metric
            label="Money-weighted"
            value={fmtSignedPct(summary.mwr)}
            sub="your dollars, your timing"
            color={plColor(summary.mwr)}
            tip="Money-weighted return (IRR) weights each dollar by how long it was invested — it reflects your actual experience, including the timing of your contributions."
          />
          <Metric
            label="Unrealized P/L"
            value={fmtSignedMoney(view.unrealized_pl)}
            sub={`cost basis ${fmtPrice(summary.cost_basis)}`}
            color={plColor(view.unrealized_pl)}
            tip="Paper gain or loss on positions you still hold: current market value minus what you paid for them."
          />
          <Metric
            label="Realized + divs"
            value={fmtSignedMoney(realizedPlusDivs)}
            sub={`${fmtSignedMoney(summary.realized_pl)} realized · ${fmtPrice(summary.dividends_received)} divs`}
            color={plColor(realizedPlusDivs)}
            tip="Gains and losses locked in by selling, plus dividends actually received — money that's already banked, unlike unrealized P/L."
          />
          <Metric
            label="Risk"
            value={`β ${fmtRatio(summary.beta)}`}
            sub={`Sharpe ${fmtRatio(summary.sharpe)} · vol ${fmtPct(summary.volatility)}`}
            tip="Beta measures how much you move with the market (1.0 = in step). Sharpe is return per unit of risk (higher is better). Volatility is annualized swing size."
          />
          <Metric
            label="Max drawdown"
            value={fmtSignedPct(summary.max_drawdown)}
            sub={
              cashTracking
                ? `cash ${fmtPrice(summary.cash)}`
                : `net invested ${fmtPrice(summary.net_invested)}`
            }
            color="#dc2626"
            tip="The worst peak-to-trough decline your portfolio has experienced — a gut-check for how much pain you'd have felt at the low."
          />
        </div>
      </div>
    </div>
  )
}
