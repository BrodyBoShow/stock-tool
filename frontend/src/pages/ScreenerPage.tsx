import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ErrorCard } from '@/components/ErrorCard'
import { FilterSidebar } from '@/components/screener/FilterSidebar'
import { ScreenerTable } from '@/components/screener/ScreenerTable'
import { TerminalHeader } from '@/components/TerminalHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { getScreener } from '@/lib/api'
import { applyFilters, DEFAULT_FILTERS, type Filters } from '@/lib/filters'

function ScreenerSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[170px] w-full rounded-[13px] bg-slate-800/20" />
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

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)

  const sectors = useMemo(() => {
    if (!data) return []
    const s = new Set<string>()
    for (const r of data.rows) if (r.sector) s.add(r.sector)
    return [...s].sort()
  }, [data])

  const filtered = useMemo(
    () => (data ? applyFilters(data.rows, filters) : []),
    [data, filters],
  )

  if (isPending) return <ScreenerSkeleton />
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  return (
    <div className="space-y-5">
      <TerminalHeader scoreDate={data.score_date} rows={data.rows} />
      <div className="flex items-start gap-5">
        <FilterSidebar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(DEFAULT_FILTERS)}
          resultCount={filtered.length}
          totalCount={data.rows.length}
          sectors={sectors}
        />
        <ScreenerTable rows={filtered} scoreDate={data.score_date} />
      </div>
      <p className="pb-2 text-center text-xs text-[#9ca3af]">
        Factor scores are cross-sectional percentile rankings within the S&amp;P 500
        universe, refreshed nightly — not investment advice.
      </p>
    </div>
  )
}
