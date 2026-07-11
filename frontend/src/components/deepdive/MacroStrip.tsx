import { useQuery } from '@tanstack/react-query'

import { Sparkline } from '@/components/screener/Sparkline'
import { MACRO_DISPLAY } from '@/lib/constants'
import { getMacroLatest, getMacroSeries } from '@/lib/api'
import { fmtShortDate } from '@/lib/format'
import type { MacroObservation } from '@/types/api'

function fmtVal(v: number | null, unit: string, dec: number): string {
  if (v === null) return '—'
  return `${v.toFixed(dec)}${unit}`
}

// Trailing window of a full FRED series, oldest→newest, for the trend sparkline.
// Date strings are 'YYYY-MM-DD', so a string cutoff is a correct date compare.
// Keeps the dates so the sparkline hover can name the observation it's showing.
function recentPoints(obs: MacroObservation[], years = 3): { values: number[]; dates: string[] } {
  if (obs.length === 0) return { values: [], dates: [] }
  const latestDate = obs[obs.length - 1].date
  const cutoff = String(Number(latestDate.slice(0, 4)) - years) + latestDate.slice(4)
  const win = obs.filter((o) => o.date >= cutoff && o.value != null)
  return { values: win.map((o) => o.value as number), dates: win.map((o) => o.date) }
}

function MacroTile({
  label,
  unit,
  dec,
  obs,
  spark,
}: {
  label: string
  unit: string
  dec: number
  obs: MacroObservation[]
  spark?: { values: number[]; dates: string[] }
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
    <div className="rounded-xl border border-line bg-surface p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <div className="text-[0.66rem] font-bold uppercase tracking-[0.05em] text-muted">
        {label}
      </div>
      <div className="mt-0.5 text-[1.3rem] font-extrabold leading-tight text-ink">
        {fmtVal(latest?.value ?? null, unit, dec)}
      </div>
      {delta && prior ? (
        <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
          <span className="text-[0.74rem] font-bold text-muted">
            {delta.arrow}
            {delta.mag}
          </span>
          <span className="text-[0.66rem] text-subtle">vs {fmtShortDate(prior.date)}</span>
        </div>
      ) : (
        <div className="mt-0.5 text-[0.72rem] text-subtle">no prior reading</div>
      )}
      {spark && spark.values.length >= 2 && (
        <div className="mt-1.5">
          {/* Neutral slate — macro is direction-only context, never good/bad.
              Fluid so it fits the narrow 2-col mobile tile without overflow. */}
          <Sparkline
            data={spark.values}
            color="var(--subtle)"
            width={132}
            height={22}
            fluid
            title={`${label} — last 3 years`}
            fmt={(v) => `${v.toFixed(dec)}${unit}`}
            labels={spark.dates.map((d) => fmtShortDate(d))}
          />
        </div>
      )}
      {latest && (
        <div className="mt-1 text-[0.63rem] text-subtle">as of {fmtShortDate(latest.date)}</div>
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

  // Full history per series → trailing-3y sparkline points. One extra fan-out,
  // cached 6h; individual series failures degrade to "no sparkline" silently.
  const { data: sparks } = useQuery({
    queryKey: ['macro', 'series', 'sparks'],
    queryFn: async () => {
      const results = await Promise.all(
        MACRO_DISPLAY.map((m) => getMacroSeries(m.id).catch(() => null)),
      )
      const map: Record<string, { values: number[]; dates: string[] }> = {}
      for (const r of results) {
        if (r) map[r.series_id] = recentPoints(r.observations)
      }
      return map
    },
    staleTime: 6 * 60 * 60 * 1000,
  })

  // ambient context — if it fails, stay quiet rather than break the deep dive
  if (error) return null

  const bySeries = new Map(
    (data?.series ?? []).map((s) => [s.series_id, s.observations]),
  )

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="text-base font-bold text-ink">Macro backdrop</div>
      <div className="mt-0.5 text-[0.78rem] text-muted">
        Where rates, inflation and volatility sit — broad market context, not a
        per-stock signal. Latest nightly readings from FRED.
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {isPending
          ? MACRO_DISPLAY.map((m) => (
              <div
                key={m.id}
                className="h-[92px] animate-pulse rounded-xl border border-line bg-surface-3"
              />
            ))
          : MACRO_DISPLAY.map((m) => (
              <MacroTile
                key={m.id}
                label={m.label}
                unit={m.unit}
                dec={m.dec}
                obs={bySeries.get(m.id) ?? []}
                spark={sparks?.[m.id]}
              />
            ))}
      </div>
    </section>
  )
}
