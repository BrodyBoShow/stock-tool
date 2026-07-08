import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { ErrorCard } from '@/components/ErrorCard'
import { ActionCardStack } from '@/components/portfolio/ActionCardStack'
import { AddTransactionForm, CsvImportButton } from '@/components/portfolio/AddTransactionForm'
import { BrokerageCard } from '@/components/portfolio/BrokerageCard'
import { DividendsPanel } from '@/components/portfolio/DividendsPanel'
import { HoldingsDiagnostic } from '@/components/portfolio/HoldingsDiagnostic'
import { MonteCarloPanel } from '@/components/portfolio/MonteCarloPanel'
import { OverlapMatrixPanel } from '@/components/portfolio/OverlapMatrixPanel'
import { PerformancePanel } from '@/components/portfolio/PerformancePanel'
import { HealthScorePanel } from '@/components/portfolio/HealthScorePanel'
import { PortfolioHero } from '@/components/portfolio/PortfolioHero'
import { HoldingsTab } from '@/components/portfolio/redesign/HoldingsTab'
import { OverviewTab } from '@/components/portfolio/redesign/OverviewTab'
import { RiskFitTab } from '@/components/portfolio/redesign/RiskFitTab'
import { StrategyDriftCard } from '@/components/portfolio/StrategyDriftCard'
import { AlignedIdeasPanel } from '@/components/portfolio/risk/AlignedIdeasPanel'
import { RiskAlignmentPanel } from '@/components/portfolio/risk/RiskAlignmentPanel'
import { RiskProfileCard } from '@/components/portfolio/risk/RiskProfileCard'
import {
  BENCHMARK_OPTIONS,
  activeSnoozes,
  buildVerdict,
  capWeights,
  computeBenchStats,
  computeHealthScore,
  flagKey,
  tradesToWeights,
  whatIfStats,
} from '@/components/portfolio/portfolioUi'
import type { RangeKey, SimTrade, WhatIfStats } from '@/components/portfolio/portfolioUi'
import { RebalanceDrawer } from '@/components/portfolio/RebalanceDrawer'
import { StressTestPanel } from '@/components/portfolio/StressTestPanel'
import { AllocationPanel, FactorTiltRadar } from '@/components/portfolio/TiltAllocation'
import { TransactionsPanel } from '@/components/portfolio/TransactionsPanel'
import { VsMarketPanel } from '@/components/portfolio/VsMarketPanel'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getPortfolio,
  getPortfolioAnalytics,
  getPortfolioTransactions,
  getQuotes,
  getRiskAlignment,
} from '@/lib/api'
import type { PortfolioFlag, PortfolioHolding } from '@/types/api'

const BENCH_KEY = 'stockbud.portfolio.benchmark'

/** PR4 IA reorg: the page is 4 focused panes (same ?pane= URL pattern as the
 *  deep dive) instead of a 12-section scroll. Overview answers "how am I
 *  doing?" in one screen; Risk & Fit holds the personalization layer. */
type PaneId = 'overview' | 'risk' | 'holdings' | 'activity'

const PANES: Array<{ id: PaneId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'risk', label: 'Risk & Fit' },
  { id: 'holdings', label: 'Holdings' },
  { id: 'activity', label: 'Income & Activity' },
]

const PANE_IDS = PANES.map((p) => p.id)

function initialBenchmark(): string {
  try {
    const v = localStorage.getItem(BENCH_KEY)
    return v && BENCHMARK_OPTIONS.includes(v) ? v : 'SPY'
  } catch {
    return 'SPY'
  }
}

/** Trades implied by the action cards' suggested fixes (simulator prefill).

    Trim sizes are RE-derived with the simulator's own semantics — proceeds
    leave the simulated book, so the sell that reaches the target weight is
    x = (P − T·Vpos)/(1 − T) over POSITION value. The backend's sell_shares
    can assume proceeds become cash (cash-tracked ledgers), which would land
    above target inside the simulator. */
function fixTrades(
  flags: PortfolioFlag[],
  holdings: PortfolioHolding[],
  lastClose: Record<string, number | null> | undefined,
): SimTrade[] {
  const posValue = holdings.reduce((a, h) => a + (h.market_value ?? 0), 0)
  const out: SimTrade[] = []
  for (const f of flags) {
    const fix = f.fix
    if (!fix) continue
    if (fix.sell_ticker && fix.sell_shares && fix.sell_shares > 0) {
      const h = holdings.find((x) => x.ticker === fix.sell_ticker)
      const px = lastClose?.[fix.sell_ticker] ?? h?.last_price ?? 0
      if (px <= 0) continue
      let shares = fix.sell_shares
      const target = fix.target_weight
      const mv = h?.market_value
      if (target != null && target < 1 && mv != null && posValue > 0) {
        const sellAmt = Math.max((mv - target * posValue) / (1 - target), 0)
        shares = Number((sellAmt / px).toFixed(6))
      }
      if (shares > 0) out.push({ side: 'sell', ticker: fix.sell_ticker, shares, price: px })
    } else if (fix.add_ticker && fix.add_amount && fix.add_amount > 0) {
      const px = lastClose?.[fix.add_ticker] ?? 0
      if (px > 0) {
        out.push({
          side: 'buy',
          ticker: fix.add_ticker,
          shares: Number((fix.add_amount / px).toFixed(4)),
          price: px,
        })
      }
    }
  }
  return out
}

export function PortfolioPage() {
  const [benchmark, setBenchmarkState] = useState(initialBenchmark)
  const [range, setRange] = useState<RangeKey>('Max')
  const [searchParams, setSearchParams] = useSearchParams()
  const rawPane = searchParams.get('pane')
  const pane: PaneId = PANE_IDS.includes(rawPane as PaneId) ? (rawPane as PaneId) : 'overview'
  // Redesign flag (?redesign=1) — Phase 2 of the UX refinement ships the new
  // 3-zone Overview behind it so it can be A/B'd against the current one before
  // cutover. Sticky across pane switches; togglable in the sub-header.
  const redesign = searchParams.get('redesign') === '1'
  const paneParams = (id: PaneId, rd: boolean): Record<string, string> => {
    const p: Record<string, string> = {}
    if (id !== 'overview') p.pane = id
    if (rd) p.redesign = '1'
    return p
  }
  const setPane = (id: PaneId) => {
    setSearchParams(paneParams(id, redesign))
    window.scrollTo({ top: 0 })
  }
  const toggleRedesign = () => setSearchParams(paneParams(pane, !redesign))
  // Panes with a redesigned version wired (grows each phase; P4 adds 'activity').
  // When active the pane renders its own Zone-A hero + Zone-C disclaimer, so the
  // global hero + footnote are hidden for it.
  const REDESIGNED_PANES: PaneId[] = ['overview', 'risk', 'holdings']
  const redesignActive = redesign && REDESIGNED_PANES.includes(pane)
  const [drawer, setDrawer] = useState<{ open: boolean; trades: SimTrade[]; seq: number }>({
    open: false,
    trades: [],
    seq: 0,
  })

  const setBenchmark = (b: string) => {
    setBenchmarkState(b)
    try {
      localStorage.setItem(BENCH_KEY, b)
    } catch {
      /* persistence is best-effort */
    }
  }

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['portfolio', benchmark],
    queryFn: () => getPortfolio(benchmark),
    staleTime: 60 * 1000,
  })
  const { data: analytics, isPending: analyticsPending } = useQuery({
    queryKey: ['portfolio', 'analytics', benchmark],
    queryFn: () => getPortfolioAnalytics(benchmark),
    staleTime: 5 * 60 * 1000,
    enabled: !!data?.has_transactions,
    retry: 1,
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
  // Risk-fit vs the user's stated preference (PR3). The endpoint fail-softs to
  // has_profile:false when no profile is set; the panels render null then.
  const { data: riskAlignment } = useQuery({
    queryKey: ['portfolio', 'risk-alignment', benchmark],
    queryFn: () => getRiskAlignment(benchmark),
    staleTime: 5 * 60 * 1000,
    enabled: !!data?.has_transactions,
    retry: 1,
  })

  const quotes = quotesData?.quotes ?? {}
  const holdings = useMemo(() => data?.holdings ?? [], [data])
  const flags = useMemo(() => data?.flags ?? [], [data])

  // Snoozed cards shouldn't count toward the hero's "See N fixes" — bump a
  // version whenever the stack snoozes/unsnoozes so this recomputes.
  const [snoozeVersion, setSnoozeVersion] = useState(0)
  const heroFlags = useMemo(() => {
    const snoozed = activeSnoozes()
    return flags.filter((f) => !(flagKey(f) in snoozed))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags, snoozeVersion])

  // Simulator prefill from the action-card fixes, and the before/after stats
  // shown on the risk spectrum / vs-market panel. BOTH sides come from the
  // same trailing-1Y matrix, so the shown improvement is the fixes — not a
  // full-history-vs-1Y window artifact.
  const suggested = useMemo(() => {
    const trades = fixTrades(flags, holdings, analytics?.last_close ?? undefined)
    if (!trades.length || !analytics?.returns) {
      return {
        trades,
        weights: null as Record<string, number> | null,
        whatIf: null as { before: WhatIfStats; after: WhatIfStats } | null,
      }
    }
    const bench = analytics.benchmark ?? benchmark
    const weights = capWeights(tradesToWeights(holdings, trades))
    const before = whatIfStats(
      tradesToWeights(holdings, []),
      analytics.returns, bench, analytics.expected ?? undefined,
    )
    const after = whatIfStats(
      weights, analytics.returns, bench, analytics.expected ?? undefined,
    )
    return { trades, weights, whatIf: { before, after } }
  }, [flags, holdings, analytics, benchmark])

  // Portfolio Health — a deterministic 0-100 structural diagnostic, all
  // client-side from the payload already fetched (never fabricates; renders a
  // copy-only state on short history). Bridge tone matches the hero's verdict.
  const health = useMemo(() => {
    const summary = data?.summary
    const perf = data?.performance
    if (!summary || !perf) return null
    return computeHealthScore({
      summary,
      holdings,
      flags,
      performance: { twr_curve: perf.twr_curve, bench_curve: perf.bench_curve },
      allocation: data?.allocation ?? null,
      benchStats: computeBenchStats(perf.bench_curve),
      riskAlignment:
        riskAlignment?.has_profile && riskAlignment.portfolio
          ? { has_profile: true, in_band_weight_pct: riskAlignment.portfolio.in_band_weight_pct }
          : null,
    })
  }, [data, holdings, flags, riskAlignment])

  const verdictTone = useMemo(() => {
    const summary = data?.summary
    if (!summary) return 'warn' as const
    return buildVerdict({
      twrTotal: summary.twr_total,
      benchTotal: summary.bench_total,
      benchmark: summary.benchmark,
      volatility: summary.volatility,
      beta: summary.beta,
      flags,
      firstDate: summary.first_date,
    }).tone
  }, [data, flags])

  const openSimulator = (trades: SimTrade[]) =>
    setDrawer((d) => ({ open: true, trades, seq: d.seq + 1 }))

  const openForFlag = (flag: PortfolioFlag) =>
    openSimulator(fixTrades([flag], holdings, analytics?.last_close ?? undefined))

  const openForTicker = (ticker: string | null) => {
    if (!ticker) {
      openSimulator(suggested.trades)
      return
    }
    const h = holdings.find((x) => x.ticker === ticker)
    const px = analytics?.last_close?.[ticker] ?? h?.last_price ?? 0
    openSimulator([{ side: 'sell', ticker, shares: 0, price: px }])
  }

  if (isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-[220px] w-full rounded-card" />
        <Skeleton className="h-[360px] w-full rounded-card" />
        <Skeleton className="h-[300px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  // ── empty state ────────────────────────────────────────────────────────────
  if (!data.has_transactions) {
    return (
      <div className="space-y-5">
        <div className="rounded-card border border-gray-200 bg-white p-10 text-center shadow-card">
          <h1 className="text-xl font-extrabold text-slate-900">Portfolio</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-sm text-slate-500">
            Log your real buys and sells and StockBud derives everything else from its
            own nightly price, dividend, and factor data: returns vs a benchmark you
            choose, risk stats, tax lots, stress tests, a what-if rebalance simulator,
            and automatic dividend income. Start below — splits and dividends are
            handled for you.
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
        <BrokerageCard />
      </div>
    )
  }

  const s = data.summary!

  // Live-adjust the headline so the hero reconciles with the live-quote overlay
  // on the holdings rows (same logic as before the redesign).
  const anyLive = holdings.some((h) => h.ticker && quotes[h.ticker]?.price != null)
  const liveTotal = holdings.reduce((acc, h) => {
    const live = h.ticker ? quotes[h.ticker]?.price ?? null : null
    return acc + (live != null ? live * h.shares : h.market_value ?? 0)
  }, 0)
  const liveDayPL = holdings.reduce((acc, h) => {
    const q = h.ticker ? quotes[h.ticker] : undefined
    const live = q?.price ?? null
    const value = live != null ? live * h.shares : h.market_value
    const day = q?.change_pct != null ? q.change_pct / 100 : h.day_change_pct
    // 1+day <= 0 (a −100% print / provider glitch) would divide by zero
    if (value == null || day == null || 1 + day <= 0) return acc
    return acc + (value * day) / (1 + day)
  }, 0)
  // liveTotal covers POSITIONS only — a cash-tracked ledger must add the cash
  // back or the headline "drops" by the cash balance the moment quotes arrive
  const liveCash = data.cash_tracking ? s.cash ?? 0 : 0
  const view = anyLive
    ? {
        live: true,
        total_value: liveTotal + liveCash,
        day_change: liveDayPL,
        day_change_pct:
          liveTotal + liveCash - liveDayPL !== 0
            ? liveDayPL / (liveTotal + liveCash - liveDayPL)
            : 0,
        unrealized_pl: liveTotal - s.cost_basis,
      }
    : {
        live: false,
        total_value: s.total_value,
        day_change: s.day_change,
        day_change_pct: s.day_change_pct,
        unrealized_pl: s.unrealized_pl,
      }

  const scrollToFixes = () => {
    // The fixes stack lives on the Overview pane — jump there first if needed.
    if (pane !== 'overview') setPane('overview')
    window.setTimeout(
      () =>
        document
          .getElementById('portfolio-fixes')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      60,
    )
  }

  return (
    <div className="space-y-5">
      {/* sub-header: breadcrumb + global benchmark picker */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
          <span className="text-indigo-600">StockBud</span>
          <span className="text-gray-300">/</span>
          <span className="text-slate-400">Portfolio</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleRedesign}
            aria-pressed={redesign}
            className={`rounded-full border px-3 py-1 text-[0.72rem] font-semibold transition-colors ${
              redesign
                ? 'border-violet-300 bg-violet-50 text-violet-700'
                : 'border-gray-200 bg-white text-slate-500 hover:text-slate-700'
            }`}
          >
            {redesign ? '✨ New design · on' : 'Try new design'}
          </button>
          <label className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-slate-500">
            Benchmark
            <select
              value={benchmark}
              onChange={(e) => setBenchmark(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[0.74rem] font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none"
            >
              {BENCHMARK_OPTIONS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* The redesigned Overview provides its own Zone-A hero; the old global
          hero stays for every other view (and old Overview). */}
      {!redesignActive && (
        <PortfolioHero
          summary={s}
          view={view}
          flags={heroFlags}
          cashTracking={data.cash_tracking}
          onSeeFixes={scrollToFixes}
        />
      )}

      {/* pane nav (PR4 IA reorg): the 12-section scroll becomes 4 focused
          panes, same ?pane= URL pattern as the deep dive. */}
      <nav
        aria-label="Portfolio sections"
        className="sticky top-0 z-30 -mx-4 overflow-x-auto border-b border-gray-200 bg-white/95 px-4 backdrop-blur-sm"
      >
        <div className="flex items-center gap-1.5">
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={pane === p.id ? 'page' : undefined}
              onClick={() => setPane(p.id)}
              className={`whitespace-nowrap border-b-2 px-2.5 py-2 text-[0.78rem] transition-colors ${
                pane === p.id
                  ? 'border-indigo-600 font-semibold text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </nav>

      {pane === 'overview' &&
        (redesign ? (
          <OverviewTab
            view={view}
            summary={s}
            health={health}
            holdings={holdings}
            flags={flags}
            performance={data.performance ?? null}
            benchmark={s.benchmark}
            range={range}
            onRangeChange={setRange}
            onReview={openForTicker}
            onExplore={setPane}
          />
        ) : (
          <>
            {/* Portfolio Health leads the Overview — the structural how-am-I-doing
                snapshot before the action list. */}
            {health && (
              <HealthScorePanel health={health} benchmark={s.benchmark} verdictTone={verdictTone} />
            )}
            {/* No profile yet: surface the quiz prompt here too (the card shows
                its prompt variant); once set, it lives on Risk & Fit only. */}
            {riskAlignment && !riskAlignment.has_profile && <RiskProfileCard />}
            <div id="portfolio-fixes">
              <ActionCardStack
                flags={flags}
                onOpenSimulator={openForFlag}
                onSnoozeChange={() => setSnoozeVersion((v) => v + 1)}
              />
            </div>
            <StrategyDriftCard holdings={holdings} />
            {data.performance && (
              <PerformancePanel
                performance={data.performance}
                benchmark={s.benchmark}
                range={range}
                onRangeChange={setRange}
              />
            )}
            {data.performance && (
              <VsMarketPanel
                summary={s}
                performance={data.performance}
                whatIf={suggested.whatIf}
                onApplyFixes={() => openSimulator(suggested.trades)}
              />
            )}
          </>
        ))}

      {pane === 'risk' &&
        (redesign ? (
          <RiskFitTab
            riskAlignment={riskAlignment}
            stress={analytics?.stress ?? []}
            holdings={holdings}
            benchmark={s.benchmark}
            onExplore={setPane}
          />
        ) : (
          <>
            <RiskProfileCard />
            {riskAlignment && <RiskAlignmentPanel data={riskAlignment} />}
            <StressTestPanel
              stress={analytics?.stress ?? []}
              benchmark={s.benchmark}
              holdings={holdings}
            />
            <MonteCarloPanel benchmark={s.benchmark} suggestedWeights={suggested.weights} />
            {riskAlignment && <AlignedIdeasPanel data={riskAlignment} />}
          </>
        ))}

      {pane === 'holdings' &&
        (redesign ? (
          <HoldingsTab
            summary={s}
            holdings={holdings}
            quotes={quotes}
            analytics={analytics}
            flags={flags}
            onReview={openForTicker}
            onExplore={setPane}
          />
        ) : (
          <>
            <SectionCard
              title="Holdings"
              hint="Price and day change use live quotes when available (~15m delayed), otherwise the nightly close. Click a row for tax lots, thesis, correlations and quick actions."
            >
              <HoldingsDiagnostic
                holdings={holdings}
                quotes={quotes}
                analytics={analytics}
                flags={flags}
                asOf={s.as_of}
                onOpenSimulator={openForTicker}
              />
            </SectionCard>
            <div className="grid gap-5 lg:grid-cols-2">
              {data.factor_tilt && <FactorTiltRadar tilt={data.factor_tilt} />}
              {data.allocation && (
                <AllocationPanel holdings={holdings} allocation={data.allocation} />
              )}
            </div>
            {/* pass the real query state — !analytics would show a skeleton forever
                when the analytics endpoint errors out */}
            <OverlapMatrixPanel analytics={analytics} isLoading={analyticsPending} />
          </>
        ))}

      {pane === 'activity' && (
        <>
          {data.income && <DividendsPanel income={data.income} benchmark={s.benchmark} />}
          <TransactionsPanel rows={txnData?.rows ?? []} warnings={data.warnings} />
          <BrokerageCard />
        </>
      )}

      {/* Redesigned Overview carries its own single DisclaimerChip (Zone C); keep
          the long global footnote for every other view. */}
      {!redesignActive && (
        <p className="mx-auto max-w-3xl pb-2 text-center text-xs text-gray-400">
          Tracking and analytics over your own ledger — measurements and estimates, not
          investment advice, and StockBud never places orders. Dividends and splits come
          from nightly market data; prices are ~15-minute-delayed; forward income and
          stress figures are labeled projections/estimates. Treat your official brokerage
          statements as the source of truth.
        </p>
      )}

      <RebalanceDrawer
        key={drawer.seq}
        open={drawer.open}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        holdings={holdings}
        summary={s}
        analytics={analytics}
        initialTrades={drawer.trades}
      />
    </div>
  )
}
