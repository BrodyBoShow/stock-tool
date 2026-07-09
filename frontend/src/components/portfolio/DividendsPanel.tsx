import type { PortfolioIncome } from '@/types/api'
import { SectionCard } from '@/components/ui/SectionCard'
import { StatCard } from '@/components/portfolio/StatCard'
import { fmtPrice, fmtPct, fmtDate, DASH } from '@/lib/format'
import { fmtMonthKey } from '@/components/portfolio/portfolioUi'

export interface DividendsPanelProps {
  income: PortfolioIncome
  benchmark: string
}

/** One month tile in the forward income strip. Peak months (top-3 non-zero
 * projected totals) get a green highlight so the payout cadence is scannable. */
function MonthCell({
  month,
  total,
  tickers,
  peak,
}: {
  month: string
  total: number
  tickers: string[]
  peak: boolean
}) {
  const shown = tickers.slice(0, 2)
  const extra = tickers.length - shown.length
  return (
    <div
      className={`rounded-md border p-1.5 text-center ${
        peak ? 'border-pos bg-pos-soft' : 'border-line bg-surface'
      }`}
    >
      <div className="text-[0.6rem] font-semibold text-muted">{fmtMonthKey(month)}</div>
      {total === 0 ? (
        <div className="text-[0.7rem] font-bold tabular-nums text-subtle">{DASH}</div>
      ) : (
        <div className="text-[0.7rem] font-bold tabular-nums">{`$${total.toFixed(2)}`}</div>
      )}
      <div className="text-[0.55rem] leading-tight text-muted">
        {shown.join(' ')}
        {extra > 0 ? ` +${extra}` : ''}
      </div>
    </div>
  )
}

/** Dividends section: 4 summary stat cards, a projected 13-month forward income
 * calendar, and the projected upcoming ex-dividend list. Everything forward-looking
 * is derived from the trailing year's cadence and labeled as projected. */
export function DividendsPanel({ income, benchmark }: DividendsPanelProps): JSX.Element {
  // Top-3 months by projected total (only months with actual income qualify).
  const ranked = [...income.calendar]
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
  const peakMonths = new Set(ranked.map((m) => m.month))
  const peakLabels = ranked.map((m) => fmtMonthKey(m.month)).join(', ')

  return (
    <SectionCard
      title="Dividends"
      hint="Credited automatically from ex-dividend data on the shares you hold. Everything forward-looking is PROJECTED from the trailing year's cadence — companies haven't declared these yet."
    >
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <StatCard
          label="Received (TTM)"
          value={fmtPrice(income.ttm_received)}
          tip="Dividends actually credited over the trailing 12 months."
        />
        <StatCard
          label="Projected next 12M"
          value={fmtPrice(income.forward_12m)}
          tip="Trailing per-share rate × your current shares — assumes payouts hold."
        />
        <StatCard
          label="Yield on cost"
          value={fmtPct(income.yield_on_cost, 2)}
          tip="Projected next-12-month income ÷ what you originally paid for the shares."
        />
        <StatCard
          label="Current yield"
          value={fmtPct(income.yield_on_value, 2)}
          sub={`vs ${benchmark} ${income.bench_yield != null ? fmtPct(income.bench_yield, 2) : DASH}`}
          tip="Projected next-12-month income ÷ today's market value of the shares."
        />
      </div>

      <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[0.78rem] font-semibold">
            Forward income — projected, next 12 months
          </div>
          <div className="text-[0.7rem] text-muted tabular-nums">
            Total: {fmtPrice(income.forward_12m)}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-7 lg:grid-cols-[repeat(13,minmax(0,1fr))]">
          {income.calendar.map((m) => (
            <MonthCell
              key={m.month}
              month={m.month}
              total={m.total}
              tickers={m.tickers}
              peak={peakMonths.has(m.month)}
            />
          ))}
        </div>
        <div className="mt-2 text-[0.66rem] text-muted">
          Peak months: {peakLabels || DASH} · projected from each holding's trailing ex-date
          cadence — labeled estimates, not declared dividends.
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[0.78rem] font-semibold">
          Upcoming ex-dividend dates — next ~31 days (projected)
        </div>
        {income.upcoming.length === 0 ? (
          <div className="text-[0.74rem] text-muted">
            No projected ex-dividend dates in the next month.
          </div>
        ) : (
          income.upcoming.map((u, i) => (
            <div
              key={`${u.ticker}-${u.projected_date}-${i}`}
              className="flex items-center gap-3 border-b border-line py-1.5 text-[0.74rem] last:border-0"
            >
              <span className="w-28 text-muted">
                {fmtDate(u.projected_date)}{' '}
                <span className="rounded bg-warn-soft px-1 text-[0.56rem] font-bold text-warn">
                  projected
                </span>
              </span>
              <span className="w-14 font-bold">{u.ticker}</span>
              <span className="text-muted">{fmtPrice(u.per_share)}/share</span>
              <span className="text-muted">× {u.shares} sh</span>
              <span className="ml-auto font-semibold tabular-nums">
                +{fmtPrice(u.est_amount)}
              </span>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  )
}
