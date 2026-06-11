import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ErrorCard } from '@/components/ErrorCard'
import { FilterSidebar } from '@/components/screener/FilterSidebar'
import { ScreenerHeader } from '@/components/ScreenerHeader'
import { ScreenerTable } from '@/components/screener/ScreenerTable'
import { WatchlistButton } from '@/components/WatchlistButton'
import { Skeleton } from '@/components/ui/skeleton'
import { getQuotes, getScreener } from '@/lib/api'
import { applyFilters, DEFAULT_FILTERS, type Filters } from '@/lib/filters'

function ScreenerSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[210px] w-full rounded-2xl" />
      <div className="flex items-start gap-5">
        <Skeleton className="h-[480px] w-[270px] shrink-0 rounded-card" />
        <div className="min-w-0 flex-1 space-y-0 overflow-hidden rounded-card border border-[#e5e7eb] bg-white p-4 shadow-card">
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
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['screener'],
    queryFn: getScreener,
    staleTime: 5 * 60 * 1000, // nightly data — 5 min client cache
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

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)

  // Overlay live price + prev_close onto each row so the existing table cells
  // (and their day-change) render the latest quote when one is available.
  const rows = useMemo(() => {
    if (!data) return []
    const q = quotes?.quotes
    if (!q) return data.rows
    return data.rows.map((r) => {
      const lq = q[r.ticker]
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

  const filtered = useMemo(
    () => applyFilters(rows, filters),
    [rows, filters],
  )

  if (isPending) return <ScreenerSkeleton />
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-5">
      <ScreenerHeader
        scoreDate={data.score_date}
        rows={rows}
        quotesAsOfEpoch={quotes && !quotes.stale ? quotes.as_of_epoch : null}
      />
      <div className="flex items-start gap-5">
        <FilterSidebar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(DEFAULT_FILTERS)}
          resultCount={filtered.length}
          totalCount={rows.length}
          sectors={sectors}
        />
        <ScreenerTable
          rows={filtered}
          scoreDate={data.score_date}
          rowAccessory={(ticker) => <WatchlistButton ticker={ticker} variant="icon" />}
        />
      </div>
      <p className="pb-2 text-center text-xs text-[#9ca3af]">
        Factor scores are cross-sectional percentile rankings within the S&amp;P 500
        universe, refreshed nightly — not investment advice.
      </p>
    </div>
  )
}
