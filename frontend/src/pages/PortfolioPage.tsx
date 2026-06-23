import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ErrorCard } from '@/components/ErrorCard'
import { AddTransactionForm, CsvImportButton } from '@/components/portfolio/AddTransactionForm'
import { LinkedAccountsSection } from '@/components/portfolio/LinkedAccountsSection'
import { AllocationBars, TiltBars, TwrChart, ValueChart } from '@/components/portfolio/PortfolioCharts'
import { HoldingsTable, LedgerTable } from '@/components/portfolio/PortfolioTables'
import { ProjectionSection } from '@/components/portfolio/ProjectionSection'
import { StatCard } from '@/components/portfolio/StatCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { getPortfolio, getPortfolioTransactions, getQuotes } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { fmtDate, fmtPrice, fmtRatio, fmtSignedMoney, fmtSignedPct } from '@/lib/format'

export function PortfolioPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['portfolio'],
    queryFn: getPortfolio,
    staleTime: 60 * 1000,
  })
  const { data: txnData } = useQuery({
    queryKey: ['portfolio', 'transactions'],
    queryFn: getPortfolioTransactions,
    staleTime: 60 * 1000,
  })
  const { data: quotesData } = useQuery({
    queryKey: ['quotes'],
    queryFn: getQuotes,
    staleTime: 5 * 60 * 1000,
    enabled: !!data?.has_transactions,
  })
  const [chartMode, setChartMode] = useState<'twr' | 'value'>('twr')

  if (isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-[120px] w-full rounded-card" />
        <Skeleton className="h-[380px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  const ledgerRows = txnData?.rows ?? []

  if (!data.has_transactions) {
    return (
      <div className="space-y-5">
        <div className="rounded-card border border-gray-200 bg-white p-10 text-center shadow-card">
          <h1 className="text-xl font-extrabold text-slate-900">Portfolio</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-sm text-slate-500">
            Log your real buys and sells and StockBud derives everything else from
            its own nightly price, dividend, and factor data: time-weighted returns
            vs the S&amp;P 500, risk stats, factor tilt, sector concentration, and
            automatic dividend income. Start by adding your first transaction below
            — splits and dividends are handled for you.
          </p>
        </div>
        <SectionCard
          title="Add your first transaction"
          hint="Enter the shares and price as they were on the trade date — later splits are applied automatically."
        >
          <AddTransactionForm />
          <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
            <CsvImportButton />
            <span className="text-[0.74rem] text-gray-400">
              or bulk-import a CSV with header columns: type, date, ticker, shares,
              price, amount, note
            </span>
          </div>
        </SectionCard>
      </div>
    )
  }

  const s = data.summary!
  const quotes = quotesData?.quotes ?? {}

  // Live-adjust the headline figures so the big number, "today", unrealized P/L
  // and weights reconcile with the live-quote overlay shown on the holdings rows
  // (otherwise the header reads the Jun-17 close while the table shows live Jun-18
  // prices — the same total computed two different ways). Returns, risk, drawdown
  // and realized/dividends stay end-of-day: they're derived from the close series
  // and can't be computed intraday. Falls back to the backend summary when no live
  // quote is available (nights/weekends), so the header matches the table then too.
  const anyLive = data.holdings.some((h) => h.ticker && quotes[h.ticker]?.price != null)
  const liveTotal = data.holdings.reduce((acc, h) => {
    const live = h.ticker ? quotes[h.ticker]?.price ?? null : null
    return acc + (live != null ? live * h.shares : h.market_value ?? 0)
  }, 0)
  const liveDayPL = data.holdings.reduce((acc, h) => {
    const q = h.ticker ? quotes[h.ticker] : undefined
    const live = q?.price ?? null
    const value = live != null ? live * h.shares : h.market_value
    const day = q?.change_pct != null ? q.change_pct / 100 : h.day_change_pct
    if (value == null || day == null) return acc
    return acc + (value * day) / (1 + day)
  }, 0)
  const view = anyLive
    ? {
        live: true,
        total_value: liveTotal,
        day_change: liveDayPL,
        day_change_pct:
          liveTotal - liveDayPL !== 0 ? liveDayPL / (liveTotal - liveDayPL) : 0,
        unrealized_pl: liveTotal - s.cost_basis,
      }
    : {
        live: false,
        total_value: s.total_value,
        day_change: s.day_change,
        day_change_pct: s.day_change_pct,
        unrealized_pl: s.unrealized_pl,
      }

  return (
    <div className="space-y-5">
      {/* header */}
      <header className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
        <div className="h-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500" />
        <div className="px-7 pb-5 pt-6">
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
            <span className="text-indigo-600">StockBud</span>
            <span className="text-gray-300">/</span>
            <span className="text-slate-400">Portfolio</span>
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-slate-900">
                {fmtPrice(view.total_value)}
              </h1>
              <p className="mt-1 text-[0.9rem] text-slate-500">
                <span style={{ color: plColor(view.day_change) }} className="font-semibold">
                  {fmtSignedMoney(view.day_change)} ({fmtSignedPct(view.day_change_pct, 2)})
                </span>{' '}
                today · since {fmtDate(s.first_date)} ·{' '}
                {view.live
                  ? `live (~15m delayed) · returns as of ${fmtDate(s.as_of)}`
                  : `as of ${fmtDate(s.as_of)}`}
                {data.cash_tracking === false && ' · positions only (no cash ledger)'}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* summary stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Time-weighted return"
          value={fmtSignedPct(s.twr_total)}
          sub={`${fmtSignedPct(s.twr_cagr)} / yr · SPY ${fmtSignedPct(s.spy_total)}`}
          color={plColor(s.twr_total)}
        />
        <StatCard
          label="Money-weighted (IRR)"
          value={fmtSignedPct(s.mwr)}
          sub="your dollars, your timing"
          color={plColor(s.mwr)}
        />
        <StatCard
          label="Unrealized P/L"
          value={fmtSignedMoney(view.unrealized_pl)}
          sub={`cost basis ${fmtPrice(s.cost_basis)}`}
          color={plColor(view.unrealized_pl)}
        />
        <StatCard
          label="Realized + dividends"
          value={fmtSignedMoney(s.realized_pl + s.dividends_received)}
          sub={`${fmtSignedMoney(s.realized_pl)} realized · ${fmtPrice(s.dividends_received)} divs`}
          color={plColor(s.realized_pl + s.dividends_received)}
        />
        <StatCard
          label="Risk"
          value={`β ${fmtRatio(s.beta)}`}
          sub={`Sharpe ${fmtRatio(s.sharpe)} · Sortino ${fmtRatio(s.sortino)} · vol ${fmtSignedPct(s.volatility).replace('+', '')}`}
        />
        <StatCard
          label="Max drawdown"
          value={fmtSignedPct(s.max_drawdown)}
          sub={data.cash_tracking ? `cash ${fmtPrice(s.cash)}` : `net invested ${fmtPrice(s.net_invested)}`}
          color="#dc2626"
        />
      </div>

      {/* action center */}
      {data.flags.length > 0 && (
        <div className="rounded-card border border-gray-200 bg-white p-4 shadow-card">
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-slate-400">
            Things to review
          </div>
          <ul className="mt-2 space-y-1.5">
            {data.flags.map((f) => (
              <li key={f.kind + f.text} className="flex items-start gap-2 text-[0.84rem]">
                <span
                  className={
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full ' +
                    (f.level === 'warn' ? 'bg-amber-400' : 'bg-sky-400')
                  }
                />
                <span className="text-slate-600">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* performance chart */}
      <SectionCard
        title="Performance"
        hint="TWR strips out deposit/withdrawal timing — it's your picking skill, directly comparable to SPY. The value view shows your actual dollars vs what you put in."
      >
        <div className="mb-3 flex gap-[5px]">
          {(
            [
              ['twr', 'Growth of $1 vs SPY'],
              ['value', 'Value vs invested'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setChartMode(mode)}
              className="rounded-full px-[11px] py-[3px] text-[0.72rem] font-semibold transition-shadow"
              style={
                chartMode === mode
                  ? { background: '#eef2ff', color: '#4f46e5', boxShadow: 'inset 0 0 0 1.5px #4f46e5' }
                  : { background: '#ffffff', color: '#64748b', boxShadow: 'inset 0 0 0 1px #e5e7eb' }
              }
            >
              {label}
            </button>
          ))}
        </div>
        {chartMode === 'twr' ? <TwrChart data={data} /> : <ValueChart data={data} />}
      </SectionCard>

      {/* forward projection */}
      <ProjectionSection />

      {/* holdings */}
      <SectionCard
        title="Holdings"
        hint="Price and day change use live quotes when available (~15m delayed), otherwise the nightly close. Score = composite factor percentile."
      >
        <HoldingsTable holdings={data.holdings} quotes={quotes} />
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Factor tilt"
          hint="What your portfolio is actually made of, in the model's terms — catches accidental style bets (e.g. all momentum, no value)."
        >
          <TiltBars data={data} />
        </SectionCard>
        <SectionCard
          title="Allocation"
          hint="Sector weights of current positions."
        >
          <AllocationBars data={data} />
        </SectionCard>
      </div>

      {/* income */}
      {data.income && (
        <SectionCard
          title="Dividend income"
          hint="Credited automatically from ex-dividend data for the shares you held — no manual entry needed. Forward estimate = trailing 12-month rate × current shares."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Received (TTM)" value={fmtPrice(data.income.ttm_received)} />
            <StatCard label="Projected next 12M" value={fmtPrice(data.income.forward_12m)} />
            <StatCard
              label="Yield on cost"
              value={fmtSignedPct(data.income.yield_on_cost, 2).replace('+', '')}
            />
            <StatCard
              label="Current yield"
              value={fmtSignedPct(data.income.yield_on_value, 2).replace('+', '')}
            />
          </div>
        </SectionCard>
      )}

      {/* ledger */}
      <SectionCard
        title="Transactions"
        hint="The ledger everything above is computed from. Enter shares/prices as they were on the trade date — splits are applied automatically."
      >
        <AddTransactionForm />
        <div className="mt-3 flex items-center gap-3 border-b border-slate-100 pb-4">
          <CsvImportButton />
          <span className="text-[0.74rem] text-gray-400">
            CSV header: type, date (+ ticker, shares, price, amount, note as needed)
          </span>
        </div>
        <div className="mt-4">
          <LedgerTable rows={ledgerRows} />
        </div>
        {data.warnings.length > 0 && (
          <details className="mt-3 border-t border-slate-100 pt-2.5">
            <summary className="cursor-pointer select-none text-[0.72rem] font-semibold text-gray-400 hover:text-slate-500">
              Data notes ({data.warnings.length}) — minor ledger gaps, e.g.
              broker reinvest rows not imported
            </summary>
            <ul className="mt-1.5 space-y-1 pl-4 text-[0.72rem] text-gray-400">
              {data.warnings.map((w, i) => (
                <li key={`${i}-${w}`} className="list-disc">{w}</li>
              ))}
            </ul>
          </details>
        )}
      </SectionCard>

      {/* linked brokerage accounts (scaffold) */}
      <LinkedAccountsSection />

      <p className="pb-2 text-center text-xs text-gray-400">
        Tracking and analytics over your own ledger — measurements, not investment
        advice. Dividends/splits from nightly market data; figures may differ
        slightly from your broker.
      </p>
    </div>
  )
}
