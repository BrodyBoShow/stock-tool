import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ErrorCard } from '@/components/ErrorCard'
import { SectorPill } from '@/components/screener/SectorPill'
import { Skeleton } from '@/components/ui/skeleton'
import { getTheses } from '@/lib/api'
import { DASH, fmtDate, fmtPctl } from '@/lib/format'
import type { ThesisRow } from '@/types/api'

const TH =
  'whitespace-nowrap px-3 py-2 text-left text-[0.68rem] font-bold uppercase tracking-[0.06em] text-gray-500'
const TD = 'px-3 py-3 text-[0.84rem] align-top'

function truncate(s: string | null, n: number): string {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** review-due first, then soonest review date, then most recently updated. */
function sortTheses(rows: ThesisRow[]): ThesisRow[] {
  return [...rows].sort((a, b) => {
    if (a.review_due !== b.review_due) return a.review_due ? -1 : 1
    if (a.review_date && b.review_date) {
      if (a.review_date !== b.review_date) return a.review_date < b.review_date ? -1 : 1
    } else if (a.review_date || b.review_date) {
      return a.review_date ? -1 : 1
    }
    return a.updated_at < b.updated_at ? 1 : -1
  })
}

export function ThesesPage() {
  const navigate = useNavigate()
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['theses'],
    queryFn: getTheses,
    staleTime: 5 * 60 * 1000,
  })

  const rows = useMemo(() => (data ? sortTheses(data.rows) : []), [data])

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-[280px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  const dueCount = rows.filter((r) => r.review_due).length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">Thesis tracker</h1>
        <p className="mt-0.5 text-[0.82rem] text-gray-500">
          {rows.length === 0
            ? 'Theses you write on a deep dive show up here, with review dates and the current composite score.'
            : `${rows.length} active ${rows.length === 1 ? 'thesis' : 'theses'}` +
              (dueCount > 0 ? ` · ${dueCount} due for review` : '')}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-slate-300 bg-white/60 p-10 text-center shadow-card">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-[1.2rem] text-indigo-600">
            ✎
          </div>
          <p className="mt-3 text-sm font-semibold text-gray-700">No theses yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[0.82rem] text-gray-400">
            Open any company’s deep dive and write down your thesis — the core
            argument, what would invalidate it, and when to review. It’ll appear
            here.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-indigo-700"
          >
            Browse the screener
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-gray-200 bg-white shadow-card">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className={TH}>Company</th>
                <th className={TH}>Thesis</th>
                <th className={TH}>Invalidation</th>
                <th className={`${TH} text-right`}>Review</th>
                <th className={`${TH} text-right`}>Composite</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.thesis_id}
                  onClick={() => navigate(`/securities/${r.ticker}`)}
                  className="cursor-pointer border-b border-gray-100 last:border-b-0 hover:bg-slate-50"
                >
                  <td className={`${TD} min-w-[150px]`}>
                    <Link
                      to={`/securities/${r.ticker}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-bold text-gray-900 hover:underline"
                    >
                      {r.ticker}
                    </Link>
                    <div className="mt-0.5 max-w-[160px] truncate text-[0.74rem] text-gray-400">
                      {r.name ?? DASH}
                    </div>
                    <div className="mt-1">
                      <SectorPill sector={r.sector} />
                    </div>
                  </td>
                  <td className={`${TD} max-w-[280px] text-gray-700`}>
                    {truncate(r.summary, 140)}
                  </td>
                  <td className={`${TD} max-w-[220px] text-slate-500`}>
                    {r.invalidation_rules ? (
                      truncate(r.invalidation_rules, 90)
                    ) : (
                      <span className="text-slate-300">{DASH}</span>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    {r.review_date ? (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-slate-800">{fmtDate(r.review_date)}</span>
                        {r.review_due && (
                          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[0.66rem] font-bold text-red-700">
                            Review due
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-300">{DASH}</span>
                    )}
                  </td>
                  <td className={`${TD} text-right font-bold tabular-nums text-gray-900`}>
                    {fmtPctl(r.composite)}
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
