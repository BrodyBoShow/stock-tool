import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ErrorCard } from '@/components/ErrorCard'
import { SectorPill } from '@/components/screener/SectorPill'
import { Skeleton } from '@/components/ui/skeleton'
import { getWatchlist } from '@/lib/api'
import { DASH, fmtDate, fmtPctl, fmtPrice } from '@/lib/format'

const TH =
  'whitespace-nowrap px-3 py-2 text-left text-[0.68rem] font-bold uppercase tracking-[0.06em] text-[#6b7280]'
const TD = 'whitespace-nowrap px-3 py-2.5 text-[0.84rem]'

export function WatchlistPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    staleTime: 5 * 60 * 1000,
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
          Saved names with their latest nightly factor scores. Read-only in this
          build — add and remove arrive in Stage 2.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-[#e5e7eb] bg-white p-8 text-center shadow-card">
          <p className="text-sm font-semibold text-[#374151]">
            The watchlist is empty.
          </p>
          <p className="mt-1 text-[0.8rem] text-[#9ca3af]">
            Stage 2 adds saving from the screener; for now this page mirrors the
            database.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-[#e5e7eb] bg-white shadow-card">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-[#e5e7eb] bg-[#f9fafb]">
                <th className={TH}>Company</th>
                <th className={TH}>Sector</th>
                <th className={`${TH} text-right`}>Composite</th>
                <th className={`${TH} text-right`}>Growth</th>
                <th className={`${TH} text-right`}>Value</th>
                <th className={`${TH} text-right`}>Quality</th>
                <th className={`${TH} text-right`}>Momentum</th>
                <th className={`${TH} text-right`}>Price</th>
                <th className={`${TH} text-right`}>Added</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.watchlist_id}
                  className="border-b border-[#f3f4f6] last:border-b-0 hover:bg-[#f8fafc]"
                >
                  <td className={TD}>
                    <Link
                      to={`/securities/${r.ticker}`}
                      className="font-bold text-[#111827] hover:underline"
                    >
                      {r.ticker}
                    </Link>
                    <span className="ml-2 text-[0.76rem] text-[#9ca3af]">
                      {r.name ?? DASH}
                    </span>
                  </td>
                  <td className={TD}>
                    <SectorPill sector={r.sector} />
                  </td>
                  <td className={`${TD} text-right font-bold tabular-nums`}>
                    {fmtPctl(r.composite)}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {fmtPctl(r.growth_pctl)}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {fmtPctl(r.value_pctl)}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {fmtPctl(r.quality_pctl)}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {fmtPctl(r.momentum_pctl)}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {fmtPrice(r.last_price)}
                  </td>
                  <td className={`${TD} text-right text-[#6b7280]`}>
                    {fmtDate(r.added_at.slice(0, 10))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
