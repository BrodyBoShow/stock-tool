import { useQuery } from '@tanstack/react-query'

import { MACRO_DISPLAY } from '@/lib/constants'
import { getMacroLatest } from '@/lib/api'
import type { MacroObservation } from '@/types/api'

/** "2026-06-08" -> "Jun 8" (UTC-safe, no year). */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  return `${names[m - 1]} ${d}`
}

function fmtVal(v: number | null, unit: string, dec: number): string {
  if (v === null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

function MacroTile({
  label,
  unit,
  dec,
  obs,
}: {
  label: string
  unit: string
  dec: number
  obs: MacroObservation[]
}) {
  const latest = obs[0] ?? null
  const prior = obs[1] ?? null

  // direction-only delta — rising rates / VIX / CPI are context, not "good/bad",
  // so deltas are slate, never green-up / red-down.
  let delta: { arrow: string; mag: string } | null = null
  if (latest?.value != null && prior?.value != null) {
    const diff = latest.value - prior.value
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '■'
    delta = { arrow, mag: `${Math.abs(diff).toFixed(dec)}${unit}` }
  }

  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <div className="text-[0.66rem] font-bold uppercase tracking-[0.05em] text-[#6b7280]">
        {label}
      </div>
      <div className="mt-0.5 text-[1.3rem] font-extrabold leading-tight text-[#111827]">
        {fmtVal(latest?.value ?? null, unit, dec)}
      </div>
      {delta && prior ? (
        <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
          <span className="text-[0.74rem] font-bold text-[#475569]">
            {delta.arrow}
            {delta.mag}
          </span>
          <span className="text-[0.66rem] text-[#9ca3af]">vs {shortDate(prior.date)}</span>
        </div>
      ) : (
        <div className="mt-0.5 text-[0.72rem] text-[#9ca3af]">no prior reading</div>
      )}
      {latest && (
        <div className="mt-1 text-[0.63rem] text-[#cbd5e1]">as of {shortDate(latest.date)}</div>
      )}
    </div>
  )
}

/**
 * FRED macro backdrop — where rates, inflation and volatility sit. Universe-wide
 * context shown on every deep dive; it is NOT ticker-specific and never feeds
 * the factor scores. Values are the latest nightly FRED observations with an
 * honest change vs the previous real reading (daily for rates/VIX, monthly for
 * Fed Funds / CPI).
 */
export function MacroStrip() {
  const { data, isPending, error } = useQuery({
    queryKey: ['macro', 'latest'],
    queryFn: getMacroLatest,
    staleTime: 6 * 60 * 60 * 1000, // nightly data
  })

  // ambient context — if it fails, stay quiet rather than break the deep dive
  if (error) return null

  const bySeries = new Map(
    (data?.series ?? []).map((s) => [s.series_id, s.observations]),
  )

  return (
    <section className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="text-base font-bold text-[#111827]">Macro backdrop</div>
      <div className="mt-0.5 text-[0.78rem] text-[#6b7280]">
        Where rates, inflation and volatility sit — broad market context, not a
        per-stock signal. Latest nightly readings from FRED.
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {isPending
          ? MACRO_DISPLAY.map((m) => (
              <div
                key={m.id}
                className="h-[92px] animate-pulse rounded-xl border border-[#e5e7eb] bg-slate-100"
              />
            ))
          : MACRO_DISPLAY.map((m) => (
              <MacroTile
                key={m.id}
                label={m.label}
                unit={m.unit}
                dec={m.dec}
                obs={bySeries.get(m.id) ?? []}
              />
            ))}
      </div>
    </section>
  )
}
