import { Link } from 'react-router-dom'

import { RiskBandChip } from '@/components/ui/RiskBandChip'
import { fmtPct } from '@/lib/format'
import type { RiskAlignmentResponse } from '@/types/api'

/** Portfolio vs the user's stated risk preference (PR3).
 *
 * Descriptive only: each holding's HISTORICAL band either falls inside the
 * range the user chose or it doesn't — a filter match, never a suitability
 * judgment or advice. Misfits lead the list; "outside your chosen bands" is a
 * fact about the user's own setting, not a verdict on the stock.
 */

const FIT_LABEL: Record<string, { label: string; cls: string }> = {
  above: { label: 'Above your bands', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  below: { label: 'Below your bands', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  in_band: { label: 'In your bands', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  no_band: { label: 'No band', cls: 'bg-surface-2 text-muted border-line' },
}

export function RiskAlignmentPanel({ data }: { data: RiskAlignmentResponse }) {
  if (!data.has_profile || !data.profile || !data.portfolio) return null
  const p = data.profile
  const pf = data.portfolio
  const inPct = pf.in_band_weight_pct
  const abovePct = pf.above_band_weight_pct
  const noPct = pf.no_band_weight_pct

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Risk fit vs your preference</h3>
        <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-warn">
          Not investment advice
        </span>
      </div>
      <p className="mt-1 text-[0.72rem] text-muted">
        Your <span className="font-semibold capitalize">{p.profile}</span> preference compares
        holdings to historical risk bands {p.band_min}–{p.band_max}. Bands measure the past
        year — not predictions.
      </p>

      {/* weight split bar: in-band / above / no-band */}
      <div className="mt-4">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3">
          {inPct > 0 && (
            <div className="bg-teal-400" style={{ width: `${inPct * 100}%` }} title={`In your bands: ${fmtPct(inPct)}`} />
          )}
          {abovePct > 0 && (
            <div className="bg-orange-400" style={{ width: `${abovePct * 100}%` }} title={`Above your bands: ${fmtPct(abovePct)}`} />
          )}
          {noPct > 0 && (
            <div className="bg-surface-3" style={{ width: `${noPct * 100}%` }} title={`No band: ${fmtPct(noPct)}`} />
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] text-muted">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-teal-400" />In your bands {fmtPct(inPct)}</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-orange-400" />Above {fmtPct(abovePct)}</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-surface-3" />No band {fmtPct(noPct)} <span className="text-muted">(funds/ETFs & short-history names aren’t banded)</span></span>
          {pf.weighted_band != null && (
            <span className="ml-auto text-muted">
              Weight-averaged band of banded holdings:{' '}
              <span className="numeric font-bold text-ink">{pf.weighted_band.toFixed(1)}</span>
            </span>
          )}
        </div>
      </div>

      {/* per-holding fit list */}
      <div className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {data.holdings.map((h, i) => {
          const fit = FIT_LABEL[h.fit] ?? FIT_LABEL.no_band
          return (
            <div
              key={h.ticker ?? `row-${i}`}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/50 px-2.5 py-1.5"
            >
              <Link
                to={`/securities/${h.ticker}`}
                className="numeric w-14 shrink-0 text-[0.78rem] font-bold text-accent hover:underline"
              >
                {h.ticker}
              </Link>
              <span className="numeric w-12 text-[0.72rem] text-muted">
                {fmtPct(h.weight)}
              </span>
              <RiskBandChip band={h.risk_band} compact />
              <span
                className={`ml-auto inline-flex items-center rounded-full border px-1.5 py-px text-[0.62rem] font-semibold ${fit.cls}`}
              >
                {fit.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* profile-aware threshold flags */}
      {data.threshold_flags.length > 0 && (
        <div className="mt-3 rounded-lg border border-warn bg-warn-soft/50 p-2.5">
          <div className="text-[0.64rem] font-bold uppercase tracking-[0.05em] text-warn">
            Above your alert thresholds
          </div>
          <ul className="mt-1 space-y-0.5 text-[0.72rem] text-muted">
            {data.threshold_flags.map((f, i) => (
              <li key={i}>{f.text}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 text-[0.64rem] leading-relaxed text-muted">{data.methodology}</div>
    </section>
  )
}
