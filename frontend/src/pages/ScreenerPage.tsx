import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { getRecent } from '@/lib/recentlyViewed'

import { ErrorCard } from '@/components/ErrorCard'
import { ActiveFilterChips } from '@/components/screener/ActiveFilterChips'
import { CommandPalette } from '@/components/screener/CommandPalette'
import { FilterSidebar } from '@/components/screener/FilterSidebar'
import { ScreenerDrawer } from '@/components/screener/ScreenerDrawer'
import { ScreenerHeader } from '@/components/ScreenerHeader'
import { ScreenerTable } from '@/components/screener/ScreenerTable'
import { WatchlistButton } from '@/components/WatchlistButton'
import { Skeleton } from '@/components/ui/skeleton'
import { getQuotes, getScreener } from '@/lib/api'
import { FACTOR_ORDER, type FactorKey } from '@/lib/constants'
import {
  applyFilters,
  filtersFromParams,
  filtersToParams,
  type Filters,
  type ScreenerSort,
} from '@/lib/filters'
import type { ScreenerRow } from '@/types/api'

const FACTOR_LABEL: Record<FactorKey, string> = {
  composite: 'Composite',
  growth: 'Growth',
  value: 'Value',
  quality: 'Quality',
  momentum: 'Momentum',
}

function ScreenerSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[210px] w-full rounded-2xl" />
      <div className="flex flex-col items-stretch gap-5 lg:flex-row lg:items-start">
        <Skeleton className="h-[480px] w-[270px] shrink-0 rounded-card" />
        <div className="min-w-0 flex-1 space-y-0 overflow-hidden rounded-card border border-line bg-surface p-4 shadow-card">
          <Skeleton className="mb-4 h-5 w-56" />
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="mb-2 h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function ScreenerPage() {
  // Filters + sort live in the URL — screens are bookmarkable, shareable and
  // survive a refresh / back-button (replace: live edits don't spam history).
  const [searchParams, setSearchParams] = useSearchParams()
  const { filters, sort } = useMemo(
    () => filtersFromParams(searchParams),
    [searchParams],
  )
  const setFilters = (next: Filters) =>
    setSearchParams(filtersToParams(next, sort), { replace: true })
  const setSort = (next: ScreenerSort) =>
    setSearchParams(filtersToParams(filters, next), { replace: true })
  const resetAll = () => setSearchParams(new URLSearchParams(), { replace: true })
  const [drawerRow, setDrawerRow] = useState<ScreenerRow | null>(null)

  // "Complete factors only" is a server-side filter (it rebuilds the rank over
  // the complete-data set), so it lives in the query key, not applyFilters.
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['screener', filters.completeOnly],
    queryFn: () => getScreener(filters.completeOnly),
    staleTime: 5 * 60 * 1000,       // nightly data — 5 min client cache
    refetchOnWindowFocus: true,      // re-fetch on tab focus so the date badge
    refetchOnMount: true,            // and rankings stay current after nightly
    placeholderData: keepPreviousData, // keep the table up while toggling
  })

  // Live intraday quotes overlay. The factor scores stay end-of-day; only the
  // Price column / day-change go live. Short cache + refetch so opening (or
  // returning to) the tab shows prices fresh to within a couple minutes.
  const { data: quotes } = useQuery({
    queryKey: ['quotes'],
    queryFn: getQuotes,
    staleTime: 60 * 1000,
    refetchInterval: 90 * 1000,
    refetchOnWindowFocus: true,
  })

  // Overlay live prices onto each row (Price column / day-change only). Factor
  // scores stay end-of-day: the provisional intraday re-score was removed from
  // the screener — over the ~5.5k universe it was a multi-second full re-score
  // every refresh for marginal value, and EOD percentiles are the honest basis.
  const rows = useMemo(() => {
    if (!data) return []
    const q = quotes?.quotes
    return data.rows.map((r) => {
      const lq = q?.[r.ticker]
      return lq && lq.price != null
        ? { ...r, last_price: lq.price, prev_close: lq.prev_close }
        : r
    })
  }, [data, quotes])

  const sectors = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) if (r.sector) s.add(r.sector)
    return [...s].sort()
  }, [rows])

  // Live-adjusted # by ticker, ranked over the FULL universe (before search/
  // sector/factor filters narrow the table) so a stock's rank badge reflects
  // true universe standing and doesn't renumber 1..N when a filter shrinks
  // the visible set.
  const liveRankByTicker = useMemo(() => {
    const q = quotes?.quotes
    if (!q || !Object.values(q).some((qr) => qr.composite_live != null)) return null
    const withLive = rows
      .map((r) => ({ ticker: r.ticker, v: q[r.ticker]?.composite_live ?? r.composite }))
      .sort((a, b) => {
        if (a.v === null && b.v === null) return 0
        if (a.v === null) return 1
        if (b.v === null) return -1
        return b.v - a.v
      })
    const map: Record<string, number> = {}
    withLive.forEach((r, i) => {
      map[r.ticker] = i + 1
    })
    return map
  }, [rows, quotes])

  const filtered = useMemo(
    () => applyFilters(rows, filters),
    [rows, filters],
  )

  // Smart empty-state: name the likely binding filter when nothing matches.
  const emptyHint = useMemo(() => {
    if (rows.length === 0 || filtered.length > 0) return undefined
    let top: FactorKey | null = null
    for (const k of FACTOR_ORDER) {
      if (filters.mins[k] > 0 && (top === null || filters.mins[k] > filters.mins[top]))
        top = k
    }
    if (top)
      return `Nothing clears all your filters — try lowering ${FACTOR_LABEL[top]} ≥ ${filters.mins[top]}, or remove a chip above.`
    if (filters.minMarketCap > 0)
      return 'Nothing clears the size floor — try a smaller market-cap minimum.'
    if (filters.sectors.length > 0)
      return `No ${filters.sectors.join(' / ')} names match the rest of your filters.`
    if (filters.search.trim())
      return `No ticker or company matches “${filters.search.trim()}”.`
    return undefined
  }, [rows.length, filtered.length, filters])

  // "/" focuses the screener search (unless already typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        const el = document.getElementById('screener-search') as HTMLInputElement | null
        if (el) {
          e.preventDefault()
          el.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (isPending) return <ScreenerSkeleton />
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-5">
      <ScreenerHeader
        rows={rows}
        quotesAsOfEpoch={quotes && !quotes.stale ? quotes.as_of_epoch : null}
      />
      {(() => {
        const recent = getRecent()
        if (recent.length === 0) return null
        return (
          <div className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[0.74rem] text-subtle">
            <span className="font-semibold uppercase tracking-[0.06em]">Recently viewed</span>
            {recent.map((t) => (
              <Link
                key={t}
                to={`/securities/${t}`}
                className="numeric rounded bg-surface-3 px-1.5 py-0.5 font-semibold text-muted transition hover:bg-accent-soft hover:text-accent"
              >
                {t}
              </Link>
            ))}
          </div>
        )
      })()}
      <div className="flex flex-col items-stretch gap-5 lg:flex-row lg:items-start">
        <FilterSidebar
          filters={filters}
          onChange={setFilters}
          onReset={resetAll}
          resultCount={filtered.length}
          totalCount={rows.length}
          sectors={sectors}
          currentQuery={filtersToParams(filters, sort).toString()}
          onApplyQuery={(q) =>
            setSearchParams(new URLSearchParams(q), { replace: true })
          }
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <ActiveFilterChips filters={filters} onChange={setFilters} onReset={resetAll} />
          <ScreenerTable
            rows={filtered}
            scoreDate={data.score_date}
            liveByTicker={quotes?.quotes}
            liveRankByTicker={liveRankByTicker}
            commodityBackdrops={data.commodity_backdrops}
            sort={sort}
            onSortChange={setSort}
            emptyHint={emptyHint}
            rowAccessory={(ticker) => <WatchlistButton ticker={ticker} variant="icon" />}
            onRowClick={(row) => setDrawerRow(row)}
          />
        </div>
      </div>
      <p className="pb-2 text-center text-xs text-subtle">
        Factor scores are cross-sectional percentile rankings within the US-listed
        (NYSE/Nasdaq) universe, refreshed nightly — not investment advice.
        Click a row to preview score breakdown · click the ticker to open the full deep-dive.
      </p>
      {drawerRow && (
        <ScreenerDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />
      )}
      <CommandPalette
        rows={rows}
        sectors={sectors}
        onApplyQuery={(q) => setSearchParams(new URLSearchParams(q), { replace: true })}
        onApplySector={(s) => setFilters({ ...filters, sectors: [s] })}
      />
    </div>
  )
}
