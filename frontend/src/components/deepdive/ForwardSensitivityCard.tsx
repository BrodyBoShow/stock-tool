import type { ForwardSensitivity, ForwardSensitivityDriver } from '@/types/api'

/**
 * Universal per-company forward sensitivity (forward-context layer, Slice 2b).
 * Every non-producer deep-dive gets a read of the forward-macro driver its
 * SECTOR is most exposed to — reusing the market forward-regime (curve/credit/
 * inflation) plus the 10y rate — with the current level, ~1-month direction,
 * and a factual note on why it matters. Honest about diffuse sectors (no single
 * driver → an explicit note, not a fabricated one). CONTEXT only — never feeds
 * the score. Producers get the richer commodity backdrop instead.
 */

function arrow(direction: string): string {
  if (['steepening', 'widening', 'rising'].includes(direction)) return '▲'
  if (['flattening', 'tightening', 'falling'].includes(direction)) return '▼'
  return '■'
}

function DriverRow({ d }: { d: ForwardSensitivityDriver }) {
  const deltaTxt =
    d.delta == null
      ? ''
      : `${d.delta > 0 ? '+' : ''}${d.delta}${d.unit === '%' ? 'pp' : d.unit}`
  return (
    <li className="border-t border-black/[0.06] pt-2.5 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.8rem] font-semibold text-slate-700">{d.label}</span>
        <span className="flex items-center gap-2">
          {d.bucket ? (
            <span
              className={
                'rounded px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.04em] ' +
                (d.stress ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500')
              }
            >
              {d.bucket}
            </span>
          ) : null}
          <span className="numeric text-[0.8rem] font-bold text-slate-800">
            {d.value}
            <span className="text-[0.66rem] font-medium text-slate-400"> {d.unit}</span>
          </span>
          <span className="numeric flex w-16 items-center justify-end gap-0.5 text-[0.66rem] text-slate-400">
            <span aria-hidden>{arrow(d.direction)}</span>
            {deltaTxt}
          </span>
        </span>
      </div>
      {d.note && (
        <p className="mt-1 text-[0.74rem] leading-relaxed text-slate-500">{d.note}</p>
      )}
    </li>
  )
}

export function ForwardSensitivityCard({ sensitivity }: { sensitivity: ForwardSensitivity }) {
  const { sector, drivers, diffuse_note } = sensitivity
  return (
    <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-slate-500">
          Forward sensitivity
        </div>
        <span
          title="Context only — never feeds the factor score"
          className="cursor-help rounded bg-slate-100 px-1.5 text-[0.6rem] font-semibold text-slate-500"
        >
          CONTEXT
        </span>
      </div>

      {drivers.length > 0 ? (
        <>
          <p className="mt-1.5 text-[0.8rem] leading-relaxed text-slate-600">
            As {sector ? `a ${sector}` : 'this'} name, its results are most exposed to
            these forward-macro drivers — the score is backward-looking and can&rsquo;t see them:
          </p>
          <ul className="mt-2.5 space-y-2.5">
            {drivers.map((d) => (
              <DriverRow key={d.driver} d={d} />
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1.5 text-[0.8rem] leading-relaxed text-slate-600">{diffuse_note}</p>
      )}

      <p className="mt-3 text-[0.65rem] leading-relaxed text-slate-400">
        Sector-level forward sensitivity from FRED forward series (Treasury curve, high-yield
        spread, inflation breakeven). A macro backdrop, not company-specific — historical
        regime signals, not predictions. Not investment advice.
      </p>
    </section>
  )
}
