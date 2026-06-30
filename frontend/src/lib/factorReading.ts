/**
 * Phase 1 transparency helpers — turn the factor percentiles a user already sees
 * into an honest "why is this score here" read. PURE PRESENTATION: every function
 * here is arithmetic over data the API already returns (the 4 factor percentiles,
 * and on the deep-dive the `details.sub_pctls` + weights). Nothing here changes a
 * ranking, so the only bar is "no false precision".
 *
 * The thresholds below (STRONG_PCTL = 67, the value-trap 75/33 cutoffs) are
 * DISPLAY constants chosen for legibility and disclosed as such in the UI. They
 * are deliberately NOT tuned against backtest returns — the moment a display
 * cutoff is optimized on performance it becomes an unvalidated signal smuggled
 * into the product. See the scoring-honesty plan §7.
 */
import type { FactorKey } from '@/lib/constants'
import type { ScoreDetails } from '@/types/api'

/** A factor at/above this percentile reads as "strong" in the agreement display. */
export const STRONG_PCTL = 67
/** Value-trap caveat cutoffs: cheap enough, weak enough. Display-only. */
export const TRAP_VALUE_MIN = 75
export const TRAP_WEAK_MAX = 33
/** Minimum percentile lead before we name a single "top driver" factor. */
export const DRIVER_LEAD_MIN = 3

export type FactorPctls = {
  composite: number | null
  growth: number | null
  value: number | null
  quality: number | null
  momentum: number | null
}

const RANKED_FACTORS: Exclude<FactorKey, 'composite'>[] = [
  'growth',
  'value',
  'quality',
  'momentum',
]

/** v2 quality sub-metrics that are optional/sparse — excluded from the "core
 *  coverage" count so a name isn't flagged thin just for lacking an insider
 *  buy or an accruals input (mirrors the plan's coverage definition). */
export const OPTIONAL_SUBMETRICS = new Set([
  'insider_net_buy',
  'accruals',
  'share_count_trend',
])

const FACTOR_LABEL: Record<Exclude<FactorKey, 'composite'>, string> = {
  growth: 'Growth',
  value: 'Value',
  quality: 'Quality',
  momentum: 'Momentum',
}

/**
 * Cross-factor agreement: how many of the four factors clear STRONG_PCTL, of the
 * ones that are scored at all. Strictly descriptive — NOT a backtested edge, and
 * a lone strong factor can beat broad agreement. `total` excludes null factors so
 * "2/3" reads honestly when a factor is absent.
 */
export function factorAgreement(p: FactorPctls, threshold = STRONG_PCTL) {
  const present = RANKED_FACTORS.filter((k) => p[k] != null)
  const strong = present.filter((k) => (p[k] as number) >= threshold)
  return {
    strong: strong.length,
    total: present.length,
    strongNames: strong.map((k) => FACTOR_LABEL[k]),
    threshold,
  }
}

/**
 * Value-trap caveat: cheap (value high) but weak on BOTH quality and momentum —
 * the classic "cheap for a reason" setup. Suppressed when quality or momentum is
 * null or absent, so missing data never masquerades as weakness.
 */
export function isValueTrap(p: FactorPctls): boolean {
  if (p.value == null || p.quality == null || p.momentum == null) return false
  return (
    p.value >= TRAP_VALUE_MIN &&
    p.quality <= TRAP_WEAK_MAX &&
    p.momentum <= TRAP_WEAK_MAX
  )
}

/**
 * The single factor pulling the composite up the most (largest positive
 * deviation from the composite). Only named when its lead over the runner-up is
 * at least DRIVER_LEAD_MIN percentiles; otherwise the read is "balanced".
 */
export function topDriver(
  p: FactorPctls,
): { key: Exclude<FactorKey, 'composite'>; label: string; lead: number } | null {
  if (p.composite == null) return null
  const ranked = RANKED_FACTORS.filter((k) => p[k] != null)
    .map((k) => ({ key: k, dev: (p[k] as number) - (p.composite as number) }))
    .sort((a, b) => b.dev - a.dev)
  if (ranked.length === 0) return null
  const lead = ranked.length > 1 ? ranked[0].dev - ranked[1].dev : Infinity
  if (lead < DRIVER_LEAD_MIN) return null
  return { key: ranked[0].key, label: FACTOR_LABEL[ranked[0].key], lead }
}

/**
 * Core sub-metric coverage for one factor in the served snapshot: how many of the
 * factor's CORE sub-metrics carry a finite percentile. "Core" = the factor's defs
 * intersected with the snapshot's actual sub_pctls keys, minus the optional/sparse
 * v2 metrics. Used to flag a factor that rests on too few real inputs (≤1), or a
 * quality factor running on the ROA proxy.
 */
export function coreCoverage(
  details: ScoreDetails | null | undefined,
  factor: Exclude<FactorKey, 'composite'>,
  defs: Array<[string, 'higher' | 'lower']>,
): { present: number; core: number; thin: boolean; roaProxy: boolean } {
  const sub = details?.sub_pctls ?? {}
  const coreKeys = defs
    .map(([k]) => k)
    .filter((k) => k in sub && !OPTIONAL_SUBMETRICS.has(k))
  const present = coreKeys.filter((k) => Number.isFinite(sub[k] as number)).length
  const roaProxy = factor === 'quality' && details?.flags?.roic_pool === 'roa_proxy'
  return { present, core: coreKeys.length, thin: present <= 1 || roaProxy, roaProxy }
}

/**
 * Composite contribution decomposition: each PRESENT factor's share of the
 * renormalized weight blend, and the points it contributed. Mirrors the backend
 * exactly — weights renormalize over factors with a NON-NULL percentile (not
 * weight-present), and Σ(share × pctl) reconstructs the composite within rounding.
 * Returns the absent factors too so the UI can note redistributed weight.
 */
export function compositeContributions(
  p: FactorPctls,
  weights: Record<string, number> | undefined,
) {
  const w = weights ?? {}
  const present = RANKED_FACTORS.filter((k) => p[k] != null && (w[k] ?? 0) > 0)
  const absent = RANKED_FACTORS.filter((k) => !present.includes(k))
  const wsum = present.reduce((a, k) => a + (w[k] as number), 0)
  const parts = present.map((k) => {
    const share = wsum > 0 ? (w[k] as number) / wsum : 0
    return {
      key: k,
      label: FACTOR_LABEL[k],
      share,
      pctl: p[k] as number,
      points: share * (p[k] as number),
    }
  })
  const reconstructed = parts.reduce((a, x) => a + x.points, 0)
  return {
    parts,
    absent: absent.map((k) => ({ key: k, label: FACTOR_LABEL[k], weight: w[k] ?? 0 })),
    reconstructed,
  }
}
