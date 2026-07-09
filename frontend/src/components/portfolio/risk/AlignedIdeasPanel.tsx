import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { RiskBandChip } from '@/components/ui/RiskBandChip'
import { getRiskAlignment } from '@/lib/api'
import { fmtPct } from '@/lib/format'
import type { RiskAlignmentResponse } from '@/types/api'

/** "Names to research in your bands" (PR3) — DISCOVERY, not advice.
 *
 * A mechanical, fully disclosed filter: the highest composite-scored names
 * whose historical risk band falls inside the idea range the user chose,
 * excluding anything they already hold or watch, one listing per company.
 * Links go to the deep dive so the user does their own research.
 *
 * A sector filter lets the user narrow the list to (say) Healthcare — otherwise
 * the globally top-scored names can all cluster in one or two sectors and crowd
 * everything else out. The filter re-queries the server (the top-10 shown are
 * already sector-skewed, so filtering them client-side would just show zero).
 */
export function AlignedIdeasPanel({
  data,
  benchmark = 'SPY',
}: {
  data: RiskAlignmentResponse
  benchmark?: string
}) {
  const [sector, setSector] = useState('')

  // Own query so changing the sector re-fetches only the ideas — the page's
  // (sector-agnostic) fetch seeds the default via initialData. staleTime keeps
  // that seed fresh so mounting doesn't trigger a duplicate fetch: no extra
  // request happens until the user actually picks a sector.
  const q = useQuery({
    queryKey: ['portfolio', 'risk-alignment', 'ideas', benchmark, sector],
    queryFn: () => getRiskAlignment(benchmark, sector || undefined),
    initialData: sector === '' ? data : undefined,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    enabled: data.has_profile,
  })

  if (!data.has_profile || !data.profile) return null
  const p = data.profile
  const view = q.data ?? data
  const ideas = view.ideas
  const sectors = data.available_sectors ?? []
  const filtering = q.isFetching && sector !== ''
  // A failed sector fetch must NOT leave the previous sector's rows on screen
  // (keepPreviousData) under the new label — that would mislabel them. Show an
  // error + a way back instead.
  const fetchFailed = q.isError && sector !== ''

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Names to research in your bands</h3>
        <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-warn">
          Not investment advice
        </span>
      </div>
      <p className="mt-1 text-[0.72rem] text-muted">
        Top composite-scored names in historical risk bands {p.ideas_min}–{p.ideas_max} (your
        idea range){sector ? ` within ${sector}` : ''} — a filter, not recommendations. Excludes
        your holdings and watchlist; one listing per company.
      </p>

      {sectors.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="ideas-sector" className="text-[0.7rem] font-semibold text-muted">
            Sector
          </label>
          <select
            id="ideas-sector"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-[0.75rem] text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-indigo-200"
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {sector && (
            <button
              type="button"
              onClick={() => setSector('')}
              className="text-[0.7rem] font-medium text-accent hover:underline"
            >
              Clear
            </button>
          )}
          {filtering && <span className="text-[0.7rem] text-muted">Filtering…</span>}
        </div>
      )}

      {fetchFailed ? (
        <div className="mt-4 text-[0.8rem] text-warn">
          Couldn’t load {sector} ideas.{' '}
          <button
            type="button"
            onClick={() => q.refetch()}
            className="font-semibold text-accent hover:underline"
          >
            Try again
          </button>{' '}
          or{' '}
          <button
            type="button"
            onClick={() => setSector('')}
            className="font-semibold text-accent hover:underline"
          >
            show all sectors
          </button>
          .
        </div>
      ) : ideas.length === 0 ? (
        <div className="mt-4 text-[0.8rem] text-muted">
          No names currently pass the filter (band range {p.ideas_min}–{p.ideas_max}
          {sector ? `, sector ${sector}` : ''}, complete factor scores, fresh risk data).
          {sector && (
            <button
              type="button"
              onClick={() => setSector('')}
              className="ml-1 font-semibold text-accent hover:underline"
            >
              Show all sectors
            </button>
          )}
        </div>
      ) : (
        <div className={`mt-3 overflow-x-auto transition-opacity ${filtering ? 'opacity-60' : ''}`}>
          <table className="w-full text-[0.78rem]">
            <thead>
              <tr className="border-b border-line text-left text-[0.66rem] font-bold uppercase tracking-[0.05em] text-muted">
                <th className="py-1.5 pr-3">Ticker</th>
                <th className="pr-3">Company</th>
                <th className="pr-3">Sector</th>
                <th className="pr-3 text-right">Composite</th>
                <th className="pr-3">Band</th>
                <th className="text-right">Realized vol (1y)</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((i) => (
                <tr key={i.ticker} className="border-b border-line hover:bg-surface-2/60">
                  <td className="py-1.5 pr-3">
                    <Link
                      to={`/securities/${i.ticker}`}
                      className="numeric font-bold text-accent hover:underline"
                    >
                      {i.ticker}
                    </Link>
                  </td>
                  <td className="max-w-[220px] truncate pr-3 text-muted">{i.name}</td>
                  <td className="pr-3 text-muted">{i.sector ?? '—'}</td>
                  <td className="numeric pr-3 text-right font-semibold text-ink">
                    {i.composite != null ? i.composite.toFixed(1) : '—'}
                  </td>
                  <td className="pr-3">
                    <RiskBandChip band={i.risk_band} compact />
                  </td>
                  <td className="numeric text-right text-muted">
                    {i.vol_252d != null ? fmtPct(i.vol_252d) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 text-[0.64rem] leading-relaxed text-muted">
        Composite is the same backward-looking factor score shown on the screener; bands are
        historical measurements, not predictions. Open a name to research it yourself.
      </div>
    </section>
  )
}
