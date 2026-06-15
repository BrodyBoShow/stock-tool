import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ErrorCard } from '@/components/ErrorCard'
import { Skeleton } from '@/components/ui/skeleton'
import { WatchlistChanges } from '@/components/WatchlistChanges'
import { WatchlistTable } from '@/components/WatchlistTable'
import { getWatchlist, getWatchlistChanges } from '@/lib/api'

export function WatchlistPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    staleTime: 5 * 60 * 1000,
  })

  // "What changed" digest — recent rank/score moves, 8-Ks, insider buys, review
  // due. Live-quote-backed, so refetch on a short cadence like the screener.
  const { data: changes } = useQuery({
    queryKey: ['watchlist', 'changes'],
    queryFn: getWatchlistChanges,
    staleTime: 60 * 1000,
    refetchInterval: 90 * 1000,
    refetchOnWindowFocus: true,
  })

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-[280px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  const rows = data.rows

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-[#111827]">Watchlist</h1>
        <p className="mt-0.5 text-[0.82rem] text-[#6b7280]">
          {rows.length === 0
            ? 'Names you save from the screener or a deep dive show up here with their latest nightly factor scores.'
            : `${rows.length} saved ${rows.length === 1 ? 'name' : 'names'} with their latest nightly factor scores.`}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-[#cbd5e1] bg-white/60 p-10 text-center shadow-card">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-[1.3rem] text-[#f59e0b]">
            ★
          </div>
          <p className="mt-3 text-sm font-semibold text-[#374151]">
            No saved names yet
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[0.82rem] text-[#9ca3af]">
            Tap the star on any row in the screener — or the “Add to watchlist”
            button on a deep dive — to start tracking it here.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center rounded-lg bg-[#4f46e5] px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-[#4338ca]"
          >
            Browse the screener
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {changes && changes.rows.length > 0 && (
            <WatchlistChanges rows={changes.rows} />
          )}
          <WatchlistTable rows={rows} />
        </div>
      )}
    </div>
  )
}
