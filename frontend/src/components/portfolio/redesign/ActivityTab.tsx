import { fmtPrice } from '@/lib/format'
import type { PortfolioIncome, PortfolioTransactionRow } from '@/types/api'
import { BrokerageCard } from '../BrokerageCard'
import { DividendsPanel } from '../DividendsPanel'
import { TransactionsPanel } from '../TransactionsPanel'
import { DisclaimerChip } from './DisclaimerChip'
import { ExploreChips } from './ExploreChips'
import { MetricChip } from './MetricChip'
import { NextActionCTA } from './NextActionCTA'

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const INCOME_ID = 'income-detail'

/** Income & Activity tab (3-zone). Zone A = the projected-income hero + a 12-month
 *  calendar-at-a-glance strip + the one next-action. Zone B = the dividend chart
 *  and the recent-activity ledger (reused panels). Zone C = chips + disclaimer. */
export function ActivityTab({
  income,
  txnRows,
  warnings,
  benchmark,
  onExplore,
}: {
  income: PortfolioIncome | null
  txnRows: PortfolioTransactionRow[]
  warnings: string[]
  benchmark: string
  onExplore: (pane: 'overview' | 'risk' | 'holdings') => void
}) {
  // Which of the next 12 calendar months have a projected payout (for the strip).
  const paidMonths = new Set<number>()
  for (const m of income?.calendar ?? []) {
    const parts = String((m as { month?: string }).month ?? '').split('-')
    const amt = (m as { amount?: number }).amount ?? 0
    if (parts.length === 2 && amt > 0) paidMonths.add(Number(parts[1]) - 1)
  }
  const scrollIncome = () =>
    document.getElementById(INCOME_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="space-y-5">
      {/* Zone A */}
      <div className="rounded-[var(--r-xl)] border border-slate-200/70 bg-surface p-5 shadow-[var(--sh-sm)]">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <div className="text-micro font-semibold uppercase tracking-wide text-muted">
              Projected income · next 12 months
            </div>
            <div className="numeric mt-1 text-h1 font-bold leading-none text-pos sm:text-display">
              {income ? fmtPrice(income.forward_12m) : '—'}
            </div>
            {income && (
              <div className="mt-1 text-[0.72rem] text-muted">
                {fmtPrice(income.ttm_received)} received in the trailing 12 months
              </div>
            )}
          </div>
          {/* 12-month calendar at a glance — no scrolling to see the year */}
          <div className="flex items-end gap-1" aria-hidden="true">
            {MONTHS.map((m, i) => (
              <span
                key={i}
                className={`flex h-6 w-5 items-center justify-center rounded-[var(--r-xs)] text-[0.6rem] font-semibold ${
                  paidMonths.has(i) ? 'bg-green-100 text-pos' : 'bg-slate-100 text-slate-400'
                }`}
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      </div>
      <NextActionCTA
        intent="primary"
        message="Turn your passive income into an action — review what's coming and when."
        ctaLabel="See your dividend calendar"
        onCta={scrollIncome}
      />

      {income && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricChip
            label="Yield on value"
            value={income.yield_on_value != null ? `${(income.yield_on_value * 100).toFixed(2)}%` : '—'}
            sub="income ÷ market value"
            gloss="Trailing-12-month dividends as a percent of your holdings' current market value — the income rate you're earning today."
          />
          <MetricChip
            label="Yield on cost"
            value={income.yield_on_cost != null ? `${(income.yield_on_cost * 100).toFixed(2)}%` : '—'}
            sub="income ÷ cost basis"
            gloss="Trailing-12-month dividends as a percent of what you PAID — rises over time as companies grow their payouts."
          />
          <MetricChip
            label="TTM received"
            value={fmtPrice(income.ttm_received)}
            sub="trailing 12 months"
            sentiment={income.ttm_received > 0 ? 'pos' : 'neutral'}
            gloss="Total cash dividends actually paid into the book over the last twelve months."
          />
          <MetricChip
            label={`vs ${benchmark} yield`}
            value={income.bench_yield != null ? `${(income.bench_yield * 100).toFixed(2)}%` : '—'}
            sub="benchmark income rate"
            gloss={`The benchmark's trailing dividend yield, for context on whether your book is income-tilted vs ${benchmark}.`}
          />
        </div>
      )}

      {/* Zone B */}
      <div id={INCOME_ID}>{income && <DividendsPanel income={income} benchmark={benchmark} />}</div>
      <TransactionsPanel rows={txnRows} warnings={warnings} />
      <BrokerageCard />

      {/* Zone C */}
      <div className="flex flex-col gap-3 border-t border-slate-100 pt-4">
        <ExploreChips
          chips={[
            { label: 'See Holdings', onClick: () => onExplore('holdings') },
            { label: 'Overview', onClick: () => onExplore('overview') },
            { label: 'Risk & Fit', onClick: () => onExplore('risk') },
          ]}
        />
        <DisclaimerChip variant="footer" />
      </div>
    </div>
  )
}
