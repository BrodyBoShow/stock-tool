import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { addToWatchlist, getWatchlist, removeFromWatchlist } from '@/lib/api'

/** Membership set derived from the shared ['watchlist'] query (one fetch, cached). */
export function useWatchlistSet() {
  const { data, isPending } = useQuery({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    staleTime: 5 * 60 * 1000,
  })
  const tickers = useMemo(
    () => new Set((data?.rows ?? []).map((r) => r.ticker)),
    [data],
  )
  return { tickers, isPending }
}

/** Add/remove mutations that refetch the watchlist so the UI updates everywhere. */
export function useWatchlistMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['watchlist'] })
  const add = useMutation({ mutationFn: addToWatchlist, onSuccess: invalidate })
  const remove = useMutation({ mutationFn: removeFromWatchlist, onSuccess: invalidate })
  return { add, remove }
}
