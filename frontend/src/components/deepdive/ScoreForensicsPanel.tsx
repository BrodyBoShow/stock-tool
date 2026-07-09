import { useQuery } from '@tanstack/react-query'

import { Delta } from '@/components/ui/Delta'
import { getBriefStatus } from '@/lib/api'
import { FACTOR_DEFS, FACTOR_TABLE, INPUT_LABELS, type FactorKey } from '@/lib/constants'
import { fmtShortDate } from '@/lib/format'
import type { FactorTrendPoint } from '@/types/api'

/** sub-metric key → its parent factor (for the color dot). */
const METRIC_FACTOR: Record<string, FactorKey> = {}
for (const [factor, defs] of Object.entries(FACTOR_DEFS)) {
  for (const [metric] of defs) METRIC_FACTOR[metric] = factor as FactorKey
}

const FACTOR_FIELDS: { key: FactorKey; field: keyof FactorTrendPoint; label: string }[] = [
  { key: 'composite', field: 'composite', label: 'Composite' },
  { key: 'growth', field: 'growth_pctl', label: 'Growth' },
  { key: 'value', field: 'value_pctl', label: 'Value' },
  { key: 'quality', field: 'quality_pctl', label: 'Quality' },
  { key: 'momentum', field: 'momentum_pctl', label: 'Momentum' },
]

/** Forensics: diff the two most recent nightly snapshots so the user sees WHICH
 *  sub-metric moved the score — the "understand the score" promise made real. */
export function ScoreForensicsPanel({ ticker }: { ticker: string }) {
  const { data: brief } = useQuery({
    queryKey: ['brief', ticker],
    queryFn: () => getBriefStatus(ticker),
    staleTime: 5 * 60 * 1000,
  })
  const trend: FactorTrendPoint[] = brief?.trend ?? []
  if (trend.length < 2) return null
  const last = trend[trend.length - 1]
  const prior = trend[trend.length - 2]

  // factor-level deltas
  const factorDeltas = FACTOR_FIELDS.map((f) => {
    const a = prior[f.field] as number | null
    const b = last[f.field] as number | null
    return { ...f, delta: a != null && b != null ? b - a : null }
  })

  // sub-metric movers
  const ps = prior.sub_pctls ?? {}
  const ls = last.sub_pctls ?? {}
  const movers = Object.keys(ls)
    .map((k) => {
      const a = ps[k]
      const b = ls[k]
      return {
        key: k,
        label: INPUT_LABELS[k] ?? k,
        factor: METRIC_FACTOR[k] ?? 'composite',
        from: a,
        to: b,
        delta: a != null && b != null ? b - a : null,
      }
    })
    .filter((m) => m.delta != null && Math.abs(m.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta as number) - Math.abs(a.delta as number))
    .slice(0, 5)

  const compDelta = factorDeltas[0].delta
  const noMove = movers.length === 0 && (compDelta == null || Math.abs(compDelta) < 0.3)

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="px-4 pb-1.5 pt-3.5">
        <div className="text-base font-bold text-ink">What changed</div>
        <div className="mt-0.5 text-[0.78rem] text-muted">
          {fmtShortDate(prior.score_date)} → {fmtShortDate(last.score_date)} (last two nightly
          snapshots)
        </div>
      </div>

      {/* factor-level deltas */}
      <div className="flex flex-wrap gap-x-6 gap-y-1.5 px-4 pb-2.5">
        {factorDeltas.map((f) => (
          <span key={f.key} className="flex items-center gap-1.5 text-[0.78rem]">
            <span className="h-2 w-2 rounded-full" style={{ background: FACTOR_TABLE[f.key].bar }} />
            <span className="text-muted">{f.label}</span>
            {f.delta == null ? (
              <span className="text-subtle">—</span>
            ) : (
              <span className="numeric font-bold">
                <Delta value={f.delta} zeroDash />
              </span>
            )}
          </span>
        ))}
      </div>

      {noMove ? (
        <div className="border-t border-line px-4 py-3 text-[0.8rem] text-muted">
          Scores were essentially flat between these two snapshots — no sub-metric moved
          more than a percentile.
        </div>
      ) : (
        <div className="border-t border-line px-4 py-2.5">
          <div className="mb-1.5 text-[0.66rem] font-bold uppercase tracking-[0.05em] text-subtle">
            Biggest sub-metric moves
          </div>
          {movers.length === 0 ? (
            <div className="text-[0.78rem] text-subtle">
              Sub-metric detail isn't available for these snapshots.
            </div>
          ) : (
            <div className="space-y-1">
              {movers.map((m) => (
                <div key={m.key} className="flex items-center justify-between gap-3 text-[0.8rem]">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: FACTOR_TABLE[m.factor].bar }}
                    />
                    {m.label}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="numeric text-[0.72rem] text-subtle">
                      {m.from?.toFixed(0)} → {m.to?.toFixed(0)} pctl
                    </span>
                    <span className="numeric w-10 text-right font-bold">
                      <Delta value={m.delta as number} />
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="border-t border-line bg-surface-2 px-4 py-2 text-[0.7rem] text-subtle">
        Movement in our own nightly percentile ranks between runs — not a price or news
        attribution.
      </div>
    </section>
  )
}
