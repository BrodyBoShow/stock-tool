import { Link } from 'react-router-dom'

import { RiskBandChip } from '@/components/ui/RiskBandChip'
import { fmtPct } from '@/lib/format'
import type { RiskAlignmentResponse } from '@/types/api'

/** "Names to research in your bands" (PR3) — DISCOVERY, not advice.
 *
 * A mechanical, fully disclosed filter: the highest composite-scored names
 * whose historical risk band falls inside the idea range the user chose,
 * excluding anything they already hold or watch, one listing per company.
 * Links go to the deep dive so the user does their own research.
 */
export function AlignedIdeasPanel({ data }: { data: RiskAlignmentResponse }) {
  if (!data.has_profile || !data.profile) return null
  const p = data.profile

  return (
    <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">Names to research in your bands</h3>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-amber-700">
          Not investment advice
        </span>
      </div>
      <p className="mt-1 text-[0.72rem] text-gray-500">
        Top composite-scored names in historical risk bands {p.ideas_min}–{p.ideas_max} (your
        idea range) — a filter, not recommendations. Excludes your holdings and watchlist;
        one listing per company.
      </p>

      {data.ideas.length === 0 ? (
        <div className="mt-4 text-[0.8rem] text-gray-500">
          No names currently pass the filter (band range {p.ideas_min}–{p.ideas_max}, complete
          factor scores, fresh risk data).
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[0.78rem]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[0.66rem] font-bold uppercase tracking-[0.05em] text-slate-400">
                <th className="py-1.5 pr-3">Ticker</th>
                <th className="pr-3">Company</th>
                <th className="pr-3">Sector</th>
                <th className="pr-3 text-right">Composite</th>
                <th className="pr-3">Band</th>
                <th className="text-right">Realized vol (1y)</th>
              </tr>
            </thead>
            <tbody>
              {data.ideas.map((i) => (
                <tr key={i.ticker} className="border-b border-gray-50 hover:bg-slate-50/60">
                  <td className="py-1.5 pr-3">
                    <Link
                      to={`/security/${i.ticker}`}
                      className="numeric font-bold text-indigo-600 hover:underline"
                    >
                      {i.ticker}
                    </Link>
                  </td>
                  <td className="max-w-[220px] truncate pr-3 text-slate-600">{i.name}</td>
                  <td className="pr-3 text-slate-500">{i.sector ?? '—'}</td>
                  <td className="numeric pr-3 text-right font-semibold text-slate-700">
                    {i.composite != null ? i.composite.toFixed(1) : '—'}
                  </td>
                  <td className="pr-3">
                    <RiskBandChip band={i.risk_band} compact />
                  </td>
                  <td className="numeric text-right text-slate-500">
                    {i.vol_252d != null ? fmtPct(i.vol_252d) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 text-[0.64rem] leading-relaxed text-gray-400">
        Composite is the same backward-looking factor score shown on the screener; bands are
        historical measurements, not predictions. Open a name to research it yourself.
      </div>
    </section>
  )
}
