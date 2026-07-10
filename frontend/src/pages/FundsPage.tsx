import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ErrorCard } from '@/components/ErrorCard'
import { CategoryHeatmap } from '@/components/funds/CategoryHeatmap'
import { CategoryMiniCards } from '@/components/funds/CategoryMiniCards'
import { ClusterCard } from '@/components/funds/ClusterCard'
import { ComparePanel } from '@/components/funds/ComparePanel'
import { FundDetailDrawer } from '@/components/funds/FundDetailDrawer'
import {
  DEFAULT_FUND_COLUMNS,
  FUND_CATEGORIES,
  FUND_COLUMNS,
  MAX_COMPARE,
  OPTIONAL_FUND_COLUMNS,
  fmtAum,
  sortFunds,
} from '@/components/funds/fundsUi'
import type { FundColumnKey, FundSort, FundSortKey } from '@/components/funds/fundsUi'
import { FundsTable } from '@/components/funds/FundsTable'
import { RotationCompass } from '@/components/funds/RotationCompass'
import { WatchlistBridge } from '@/components/funds/WatchlistBridge'
import { InfoTip } from '@/components/ui/InfoTip'
import { Skeleton } from '@/components/ui/skeleton'
import { useWatchlistSet } from '@/hooks/useWatchlist'
import { getFundsBridge, getFundsOverview } from '@/lib/api'
import type { EnrichedFund, FundCluster } from '@/types/api'

/** Fixed column order — the visible set is a filter over this. */
const COLUMN_ORDER: FundColumnKey[] = [
  'spark', 'price', 'r1w', 'r1m', 'r3m', 'r90d', 'rytd',
  'aum', 'avg_volume', 'premium_discount', 'beta', 'vol', 'mdd', 'sharpe',
]

/** Small uppercase eyebrow introducing each information tier (mirrors Market). */
function TierLabel({ n, title }: { n: 1 | 2 | 3; title: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 text-[0.6rem] font-bold uppercase tracking-[0.1em] text-muted">
        <span className="text-accent">Tier {n}</span>
        <span className="text-subtle" aria-hidden>·</span>
        {title}
      </span>
      <span className="h-px flex-1 bg-surface-3" />
    </div>
  )
}

/** Total AUM across a cluster's present members (for ranking clusters by size). */
function clusterAum(cluster: FundCluster, byTicker: Map<string, EnrichedFund>): number {
  let sum = 0
  for (const t of cluster.funds) sum += byTicker.get(t)?.aum ?? 0
  return sum
}

export function FundsPage() {
  const navigate = useNavigate()
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['funds', 'overview'],
    queryFn: getFundsOverview,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  const bridgeQ = useQuery({
    queryKey: ['funds', 'bridge'],
    queryFn: getFundsBridge,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  const { tickers: watchlist } = useWatchlistSet()

  // ── View + toolbar state ─────────────────────────────────────────────────
  const [view, setView] = useState<'cross' | string>('cross') // 'cross' or a category key
  const [lbFilter, setLbFilter] = useState<'all' | string>('all') // leaderboard category chips
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<FundSort>({ key: 'rytd', dir: 'desc' })
  const [columns, setColumns] = useState<Set<FundColumnKey>>(new Set(DEFAULT_FUND_COLUMNS))
  const [compareMode, setCompareMode] = useState(false)
  const [compareSet, setCompareSet] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)
  const [drawerTicker, setDrawerTicker] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const funds = useMemo(() => data?.funds ?? [], [data])
  const byTicker = useMemo(() => {
    const m = new Map<string, EnrichedFund>()
    for (const f of funds) m.set(f.ticker, f)
    return m
  }, [funds])
  const spyFund = byTicker.get('SPY') ?? null

  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of funds) m.set(f.category, (m.get(f.category) ?? 0) + 1)
    return m
  }, [funds])
  const totalAum = useMemo(() => funds.reduce((s, f) => s + (f.aum ?? 0), 0), [funds])

  // Clusters ranked by total AUM (top few in cross view; category-scoped otherwise).
  const rankedClusters = useMemo(() => {
    const cs = [...(data?.clusters ?? [])]
    cs.sort((a, b) => clusterAum(b, byTicker) - clusterAum(a, byTicker))
    return cs
  }, [data, byTicker])

  const visibleColumns = useMemo(
    () => COLUMN_ORDER.filter((k) => columns.has(k)),
    [columns],
  )

  const onSort = (key: FundSortKey) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'ticker' ? 'asc' : 'desc' },
    )
  }
  const toggleColumn = (key: FundColumnKey) => {
    setColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const toggleSelect = (ticker: string) => {
    setCompareSet((prev) => {
      if (prev.includes(ticker)) return prev.filter((t) => t !== ticker)
      if (prev.length >= MAX_COMPARE) return prev
      return [...prev, ticker]
    })
  }
  const startCompare = (tickers: string[]) => {
    setCompareMode(true)
    setCompareSet(tickers.slice(0, MAX_COMPARE))
    setShowCompare(true)
  }
  const exitCompare = () => {
    setCompareMode(false)
    setCompareSet([])
    setShowCompare(false)
  }
  const openStock = (ticker: string) => navigate(`/securities/${encodeURIComponent(ticker)}`)

  // Keyboard: 1-5 tabs, '/' search, 'c' compare, Esc closes drawer/compare. The
  // effect only wires the listener; the handler performs the state changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.key === 'Escape') {
        if (drawerTicker) setDrawerTicker(null)
        else if (showCompare) setShowCompare(false)
        else if (compareMode) exitCompare()
        return
      }
      if (typing) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'c' || e.key === 'C') {
        setCompareMode((m) => !m)
      } else if (e.key >= '1' && e.key <= '5') {
        const idx = Number(e.key) - 1
        setView(idx === 0 ? 'cross' : (FUND_CATEGORIES[idx - 1]?.key ?? 'cross'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerTicker, showCompare, compareMode])

  // ── Derived fund lists ───────────────────────────────────────────────────
  const searchLc = search.trim().toLowerCase()
  const matchesSearch = (f: EnrichedFund) =>
    !searchLc ||
    f.ticker.toLowerCase().includes(searchLc) ||
    (f.name ?? '').toLowerCase().includes(searchLc)

  const leaderboardFunds = useMemo(() => {
    const base = funds.filter(
      (f) => (lbFilter === 'all' || f.category === lbFilter) && matchesSearch(f),
    )
    return sortFunds(base, sort)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funds, lbFilter, searchLc, sort])

  const categoryFunds = useMemo(() => {
    if (view === 'cross') return []
    const base = funds.filter((f) => f.category === view && matchesSearch(f))
    return sortFunds(base, sort)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funds, view, searchLc, sort])

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-[320px] w-full rounded-lg" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  const categories = data.categories
  const rotation = data.rotation
  const crossClusters = rankedClusters.slice(0, 4)
  const catClusters = rankedClusters.filter((c) => c.category === view)
  const activeCatMeta = FUND_CATEGORIES.find((c) => c.key === view)

  return (
    <div className="space-y-5 pb-24">
      {/* Sticky sub-header: title + category tabs + toolbar */}
      <div className="sticky top-12 z-20 -mx-4 border-b border-line bg-surface px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="mr-2">
            <div className="text-[1rem] font-bold text-ink">Funds &amp; ETFs</div>
            <div className="text-[0.66rem] text-subtle">
              {funds.length} ETFs · {catCounts.size} categories · {fmtAum(totalAum)} total AUM
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setView('cross')}
              className={`rounded-md px-3 py-1.5 text-[0.72rem] font-semibold transition ${
                view === 'cross'
                  ? 'bg-accent-solid text-accent-ink'
                  : 'text-muted hover:bg-surface-3'
              }`}
            >
              Cross-Category
            </button>
            {FUND_CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => setView(c.key)}
                className={`rounded-md px-3 py-1.5 text-[0.72rem] font-semibold transition ${
                  view === c.key
                    ? 'bg-accent-solid text-accent-ink'
                    : 'text-muted hover:bg-surface-3'
                }`}
              >
                {c.label === 'Other (Broad Market)' ? 'Other' : c.label}
                <span className="ml-1 text-[0.6rem] tabular-nums opacity-70">
                  {catCounts.get(c.key) ?? 0}
                </span>
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search funds… ( / )"
              className="w-44 rounded-md border border-line px-2.5 py-1.5 text-[0.72rem] focus:border-accent focus:outline-none"
            />
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-md border border-line px-2.5 py-1.5 text-[0.68rem] font-semibold text-muted hover:border-line">
                Columns ▾
              </summary>
              <div className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-line bg-surface p-2 shadow-lg">
                {[...DEFAULT_FUND_COLUMNS.filter((k) => k !== 'spark'), ...OPTIONAL_FUND_COLUMNS].map(
                  (k) => (
                    <label
                      key={k}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[0.7rem] text-muted hover:bg-surface-2"
                    >
                      <input
                        type="checkbox"
                        checked={columns.has(k)}
                        onChange={() => toggleColumn(k)}
                      />
                      {FUND_COLUMNS[k].label}
                    </label>
                  ),
                )}
              </div>
            </details>
            <button
              onClick={() => (compareMode ? exitCompare() : setCompareMode(true))}
              className={`rounded-md border px-2.5 py-1.5 text-[0.68rem] font-semibold transition ${
                compareMode
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-muted hover:border-line'
              }`}
            >
              ⚔ Compare
            </button>
          </div>
        </div>
      </div>

      {view === 'cross' ? (
        <>
          {/* T1 */}
          <section className="space-y-2">
            <TierLabel n={1} title="The 2-Second Read — Category Snapshot" />
            <CategoryMiniCards categories={categories} onSelect={setView} />
          </section>

          {/* T2 — heatmap + leaderboard */}
          <section className="space-y-2">
            <TierLabel n={2} title="The 20-Second Scan — Heatmap & Leaderboard" />
            <div className="space-y-4">
              <CategoryHeatmap funds={funds} onSelect={setView} />
              <div className="rounded-lg border border-line bg-surface p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-[0.82rem] font-bold text-ink">
                      Performance Leaderboard
                      <InfoTip text="All funds in one sortable table. Click a column to re-sort, a row to open its detail drawer." />
                    </div>
                    <div className="text-[0.66rem] text-subtle">
                      All {funds.length} funds · sortable · click a row for detail
                    </div>
                  </div>
                </div>
                <div className="mb-2.5 flex flex-wrap gap-1">
                  {(['all', ...FUND_CATEGORIES.map((c) => c.key)] as const).map((k) => {
                    const label =
                      k === 'all'
                        ? `All ${funds.length}`
                        : `${FUND_CATEGORIES.find((c) => c.key === k)?.short ?? k} ${catCounts.get(k) ?? 0}`
                    return (
                      <button
                        key={k}
                        onClick={() => setLbFilter(k)}
                        className={`rounded-full border px-2.5 py-0.5 text-[0.62rem] font-semibold transition ${
                          lbFilter === k
                            ? 'border-accent bg-accent-solid text-accent-ink'
                            : 'border-line text-muted hover:border-accent'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
                <FundsTable
                  funds={leaderboardFunds}
                  columns={visibleColumns}
                  sort={sort}
                  onSort={onSort}
                  onOpen={setDrawerTicker}
                  watchlist={watchlist}
                  showCategory
                  showRank
                  compareMode={compareMode}
                  selected={new Set(compareSet)}
                  onToggleSelect={toggleSelect}
                  maxRows={40}
                />
              </div>
            </div>
          </section>

          {/* T2 — clusters */}
          {crossClusters.length > 0 && (
            <section className="space-y-2">
              <TierLabel n={2} title="Same-Underlying Clusters — Best-Access Picks" />
              {crossClusters.map((c) => (
                <ClusterCard
                  key={c.key}
                  cluster={c}
                  fundsByTicker={byTicker}
                  onOpen={setDrawerTicker}
                  onCompare={startCompare}
                />
              ))}
            </section>
          )}

          {/* T3 — rotation + bridge */}
          <section className="space-y-2">
            <TierLabel n={3} title="The 5-Minute Drill-Down — Rotation & Watchlist Bridge" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <RotationCompass rotation={rotation} />
              <WatchlistBridge
                bridge={bridgeQ.data}
                isLoading={bridgeQ.isPending}
                onOpenFund={setDrawerTicker}
                onOpenStock={openStock}
              />
            </div>
          </section>
        </>
      ) : (
        <>
          {/* Category view */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('cross')}
              className="text-[0.72rem] font-semibold text-accent hover:underline"
            >
              ← All categories
            </button>
            <span className="text-[0.72rem] text-subtle">
              {activeCatMeta?.label ?? view} · {categoryFunds.length} funds
            </span>
          </div>

          {catClusters.length > 0 && (
            <section className="space-y-2">
              <TierLabel n={2} title="Same-Underlying Clusters" />
              {catClusters.map((c) => (
                <ClusterCard
                  key={c.key}
                  cluster={c}
                  fundsByTicker={byTicker}
                  onOpen={setDrawerTicker}
                  onCompare={startCompare}
                />
              ))}
            </section>
          )}

          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="mb-2 text-[0.82rem] font-bold text-ink">
              {activeCatMeta?.label ?? view}
              <span className="ml-1.5 text-[0.66rem] font-normal text-subtle">
                ({categoryFunds.length}) · click a row for detail · ● = Best Access
              </span>
            </div>
            <FundsTable
              funds={categoryFunds}
              columns={visibleColumns}
              sort={sort}
              onSort={onSort}
              onOpen={setDrawerTicker}
              watchlist={watchlist}
              showRank
              compareMode={compareMode}
              selected={new Set(compareSet)}
              onToggleSelect={toggleSelect}
            />
          </div>
        </>
      )}

      <p className="pt-2 text-center text-[0.62rem] text-subtle">
        ETF metadata &amp; holdings from issuer/yfinance; prices from nightly closes; risk stats
        computed from ~1Y of daily returns. Not investment advice. Expense ratio, tracking error,
        and bid-ask spread are not in our free data and are intentionally omitted.
      </p>

      {/* Detail drawer (always mounted; animates on ticker change) */}
      <FundDetailDrawer
        ticker={drawerTicker}
        spyFund={spyFund}
        watchlist={watchlist}
        onClose={() => setDrawerTicker(null)}
        onOpenStock={openStock}
        onCompareCluster={(t) => {
          setDrawerTicker(null) // close the drawer so the compare sheet isn't hidden behind it
          startCompare(t)
        }}
      />

      {/* Slim compare bar */}
      {compareMode && compareSet.length > 0 && !showCompare && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 bg-slate-900 px-6 py-3 text-white shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
          <span className="text-[0.72rem] font-semibold">Compare mode</span>
          <span className="rounded-full bg-accent-solid px-2 py-0.5 text-[0.66rem] font-bold tabular-nums">
            {compareSet.length} selected
          </span>
          <div className="flex flex-wrap gap-1">
            {compareSet.map((t) => (
              <span
                key={t}
                className="rounded bg-surface px-2 py-0.5 text-[0.66rem] font-bold tabular-nums"
              >
                {t}
              </span>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={exitCompare}
              className="rounded border border-white/30 px-3 py-1 text-[0.68rem] font-semibold"
            >
              Exit
            </button>
            <button
              onClick={() => setShowCompare(true)}
              disabled={compareSet.length < 2}
              className="rounded border border-accent bg-accent-solid px-3 py-1 text-[0.68rem] font-semibold disabled:opacity-40"
            >
              View Comparison ⚔
            </button>
          </div>
        </div>
      )}

      {compareMode && showCompare && compareSet.length >= 2 && (
        <ComparePanel
          tickers={compareSet}
          fundsByTicker={byTicker}
          onClear={() => setCompareSet([])}
          onRemove={(t) => setCompareSet((prev) => prev.filter((x) => x !== t))}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  )
}
