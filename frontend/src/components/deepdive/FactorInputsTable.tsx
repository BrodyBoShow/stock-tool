import { rankColor } from '@/lib/colors'
import {
  FACTOR_DEFS,
  FACTOR_TABLE,
  INPUT_LABELS,
  METRIC_NA_REASON,
  METRIC_NA_REASON_FALLBACK,
  type FactorKey,
} from '@/lib/constants'
import { coreCoverage } from '@/lib/factorReading'
import { DASH, fmtInput } from '@/lib/format'
import type { SecurityHeader } from '@/types/api'

/**
 * One-line "what moved this factor relative to its own metrics" caption (Phase 1,
 * 1a). A factor percentile is the skipna mean of its present sub-metric
 * percentiles, so each sub-metric's deviation from that mean is exact arithmetic.
 * We only name drivers when at least one deviation is ≥3 — otherwise the metrics
 * are too tightly clustered to single any out. This describes the SCORE, not the
 * price, and changes no ranking.
 */
function driverCaption(
  shown: Array<[string, 'higher' | 'lower']>,
  subPctls: Record<string, number | null | undefined>,
  factorV: number,
): string | null {
  const devs = shown
    .map(([k]) => ({ k, v: subPctls[k] }))
    .filter((x) => x.v != null && Number.isFinite(x.v))
    .map((x) => ({ k: x.k, dev: (x.v as number) - factorV }))
  if (devs.length < 2 || !devs.some((d) => Math.abs(d.dev) >= 3)) return null
  const sorted = [...devs].sort((a, b) => b.dev - a.dev)
  const label = (k: string) => INPUT_LABELS[k] ?? k
  const highs = sorted.filter((d) => d.dev > 0).slice(0, 2).map((d) => label(d.k))
  const lows = sorted
    .filter((d) => d.dev < 0)
    .slice(-2)
    .reverse()
    .map((d) => label(d.k))
  const parts: string[] = []
  if (highs.length) parts.push(`${highs.join(' & ')} ${highs.length > 1 ? 'sit' : 'sits'} highest`)
  if (lows.length) parts.push(`${lows.join(' & ')} lowest`)
  return parts.length ? parts.join('; ') : null
}

function RankPill({ rank }: { rank: number | null | undefined }) {
  const r = rank == null || Number.isNaN(rank) ? null : rank
  const { bg, fg } = rankColor(r)
  return (
    <span
      className="inline-block min-w-[42px] rounded-md px-2 py-0.5 text-[0.8rem] font-bold tabular-nums"
      style={{ background: bg, color: fg }}
    >
      {r === null ? DASH : r.toFixed(1)}
    </span>
  )
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-sm"
      style={{ background: color }}
    />
  )
}

const VALUE_NA_REASON =
  'No market cap or share count available — likely a multi-class share ' +
  'structure (e.g. BRK-B, V) where cover-page share data is class-dimensioned ' +
  'and absent from the XBRL companyfacts API.'

const TH =
  'px-3 py-2 text-left text-[0.68rem] font-bold uppercase tracking-[0.06em] text-muted'
const TD = 'px-3 py-2 text-[0.82rem]'

function pctlOf(header: SecurityHeader, key: FactorKey): number | null {
  switch (key) {
    case 'composite':
      return header.composite
    case 'growth':
      return header.growth_pctl
    case 'value':
      return header.value_pctl
    case 'quality':
      return header.quality_pctl
    case 'momentum':
      return header.momentum_pctl
  }
}

export function FactorInputsTable({ header }: { header: SecurityHeader }) {
  const details = header.details ?? {}
  const inputs = details.inputs ?? {}
  const subPctls = details.sub_pctls ?? {}
  const roicIsProxy = details.flags?.roic_pool === 'roa_proxy'
  const momentumBasis = details.flags?.momentum_basis ?? null
  const momentum12m1 = momentumBasis?.includes('12_minus_1') ?? false

  const factors = Object.keys(FACTOR_DEFS) as Array<keyof typeof FACTOR_DEFS>

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="text-base font-bold text-ink">Sub-metric detail</div>
      <div className="mt-0.5 text-[0.78rem] text-muted">
        The raw inputs behind each factor, with their own percentile ranks within
        the universe.
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.68rem] text-muted">
        <span className="flex items-center gap-1.5">
          <Swatch color="rgba(16,185,129,0.5)" /> Strong (rank ≥ 67)
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch color="var(--border)" /> Middle
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch color="rgba(239,68,68,0.45)" /> Weak (rank ≤ 33)
        </span>
        <span className="text-subtle">
          — direction-adjusted percentile within the US-listed universe, so green is always good
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface-2">
              <th className={TH}>Factor</th>
              <th className={TH}>Metric</th>
              <th className={`${TH} text-right`}>Value</th>
              <th className={`${TH} text-right`}>Rank (0–100)</th>
              <th className={TH}>Better when</th>
            </tr>
          </thead>
          <tbody>
            {factors.map((factor) => {
              const factorV = pctlOf(header, factor)
              const color = FACTOR_TABLE[factor].bar
              const dot = (
                <span className="inline-flex items-center text-[0.78rem] font-bold text-ink">
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ background: color }}
                  />
                  {factor.charAt(0).toUpperCase() + factor.slice(1)}
                </span>
              )

              if (factorV === null) {
                const reason =
                  factor === 'value' ? VALUE_NA_REASON : 'Factor data unavailable.'
                return (
                  <tr key={factor} className="border-b border-line align-top">
                    <td className={TD}>{dot}</td>
                    <td className={`${TD} italic text-subtle`}>
                      {factor.charAt(0).toUpperCase() + factor.slice(1)} factor n/a
                    </td>
                    <td className={`${TD} text-[0.75rem] text-subtle`} colSpan={3}>
                      {reason}
                    </td>
                  </tr>
                )
              }

              // Render only the sub-metrics actually present in this snapshot
              // (sub_pctls carries every ranked column for the served config
              // version), so the union FACTOR_DEFS works for both v1 and v2.
              const shown = FACTOR_DEFS[factor].filter(
                ([metricKey]) => metricKey in subPctls,
              )
              const cov = coreCoverage(details, factor, FACTOR_DEFS[factor])
              const caption = driverCaption(shown, subPctls, factorV)
              const factorMeta = (
                <div className="space-y-1">
                  {dot}
                  {cov.present <= 1 && (
                    <div
                      className="text-[0.64rem] font-semibold uppercase tracking-wide text-warn"
                      title={
                        `This factor rests on ${cov.present} core sub-metric` +
                        `${cov.present === 1 ? '' : 's'} in this snapshot — read the rank as ` +
                        `indicative, not precise.`
                      }
                    >
                      limited inputs
                    </div>
                  )}
                  {caption && (
                    <div
                      className="text-[0.66rem] font-normal leading-snug text-subtle"
                      title="Relative to this factor's other metrics — what moved the score, not the price."
                    >
                      {caption}
                    </div>
                  )}
                </div>
              )
              return shown.map(([metricKey, direction], i) => {
                const raw = inputs[metricKey]
                const missing = raw === null || raw === undefined
                return (
                  <tr key={`${factor}-${metricKey}`} className="border-b border-line">
                    <td className={`${TD} align-top`}>{i === 0 ? factorMeta : null}</td>
                    <td className={`${TD} text-ink`}>
                      {INPUT_LABELS[metricKey] ?? metricKey}
                    </td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>
                      {missing ? (
                        <span
                          className="cursor-help font-medium text-subtle underline decoration-dotted decoration-slate-300 underline-offset-2"
                          title={METRIC_NA_REASON[metricKey] ?? METRIC_NA_REASON_FALLBACK}
                        >
                          n/a
                        </span>
                      ) : (
                        <span className="text-ink">
                          {fmtInput(metricKey, raw, metricKey === 'roic' && roicIsProxy)}
                        </span>
                      )}
                    </td>
                    <td className={`${TD} text-right`}>
                      <RankPill rank={subPctls[metricKey]} />
                    </td>
                    <td className={`${TD} text-muted`}>
                      {direction === 'higher' ? '↑ higher' : '↓ lower'}
                    </td>
                  </tr>
                )
              })
            })}
          </tbody>
        </table>
      </div>

      {(roicIsProxy || momentumBasis) && (
        <div className="mt-3 space-y-1 text-[0.72rem] text-subtle">
          {roicIsProxy && (
            <p>
              * ROIC shown as ROA proxy (net income ÷ total assets) — this company
              type does not report an operating-income subtotal. Ranked in a
              separate pool from true-ROIC companies.
            </p>
          )}
          {momentumBasis && (
            <p>
              {momentum12m1
                ? 'Momentum = cross-sectional ranking of 3- and 6-month returns plus 12-minus-1 momentum (the 12-month return skipping the most recent month, which tends to mean-revert). No benchmark subtraction.'
                : 'Momentum = cross-sectional ranking of raw 3/6/12-month adj-close returns within the universe (no benchmark subtraction).'}
            </p>
          )}
        </div>
      )}
      {Object.keys(inputs).length === 0 && (
        <p className="mt-3 text-[0.78rem] text-subtle">
          No factor input detail available for this security. {DASH}
        </p>
      )}
    </div>
  )
}
