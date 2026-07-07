import { Link } from 'react-router-dom'

import { fmtPct, fmtSignedMoney, fmtSignedPct } from '@/lib/format'
import type { PortfolioHolding } from '@/types/api'

/** "Biggest drags on the book" — a DETERMINISTIC diagnostic (no AI): the
 *  holdings sitting on the largest unrealized losses, each linked to its
 *  deep-dive so the user can research the fundamentals.
 *
 *  Honesty: descriptive, not advice — it names what's down, it does not say to
 *  sell. Renders NOTHING when no holding is at a loss (no fabricated drama).
 */
export function StrategyDriftCard({ holdings }: { holdings: PortfolioHolding[] }) {
  const drags = holdings
    .filter((h) => h.ticker && (h.unrealized_pl ?? 0) < 0)
    .sort((a, b) => (a.unrealized_pl ?? 0) - (b.unrealized_pl ?? 0))
    .slice(0, 3)

  if (drags.length === 0) return null

  return (
    <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">Biggest drags on the book</h3>
        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-slate-500">
          Not investment advice
        </span>
      </div>
      <p className="mt-1 text-[0.72rem] text-gray-500">
        The positions carrying your largest unrealized losses. Open a name to research whether
        the thesis still holds — this is a diagnostic, not a call to sell.
      </p>

      <div className="mt-3 space-y-1.5">
        {drags.map((h) => (
          <div
            key={h.ticker}
            className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/50 px-2.5 py-2"
          >
            <div className="min-w-0 flex-1">
              <Link
                to={`/securities/${h.ticker}`}
                className="text-[0.82rem] font-bold text-indigo-600 hover:underline"
              >
                {h.ticker}
              </Link>
              {h.name && (
                <span className="ml-2 truncate text-[0.72rem] text-slate-400">{h.name}</span>
              )}
            </div>
            <span className="numeric hidden text-[0.72rem] text-slate-500 sm:inline">
              {fmtPct(h.weight)} of book
            </span>
            <span className="numeric text-right text-[0.78rem] font-semibold text-rose-600">
              {fmtSignedMoney(h.unrealized_pl)}
              {h.unrealized_pl_pct != null && (
                <span className="ml-1 text-[0.68rem] font-medium text-rose-400">
                  {fmtSignedPct(h.unrealized_pl_pct)}
                </span>
              )}
            </span>
            <Link
              to={`/securities/${h.ticker}`}
              className="flex-none rounded-md border border-gray-200 px-2 py-1 text-[0.68rem] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
            >
              Analyze →
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
