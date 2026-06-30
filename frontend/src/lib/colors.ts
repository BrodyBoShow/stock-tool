/** Color helpers for "good / bad" metric indicators. Green always = stronger. */

export interface Tint {
  bg: string
  fg: string
}

/** P/L text color: green for ≥0, red for <0, slate for null. */
export function plColor(x: number | null | undefined): string {
  return x == null ? '#64748b' : x >= 0 ? '#059669' : '#dc2626'
}

/**
 * Universe percentile rank (0-100) -> pill colors. The rank is already
 * direction-adjusted (a high rank means "good for this factor" whether the
 * underlying metric is better high or low), so green = strong is unambiguous.
 */
export function rankColor(rank: number | null): Tint {
  if (rank === null || Number.isNaN(rank)) return { bg: '#f8fafc', fg: '#9ca3af' }
  if (rank >= 67) return { bg: 'rgba(16,185,129,0.13)', fg: '#047857' } // strong
  if (rank >= 34) return { bg: '#f1f5f9', fg: '#475569' } // middle
  return { bg: 'rgba(239,68,68,0.11)', fg: '#b91c1c' } // weak
}

/** Hex (#rrggbb) → rgba() string at the given alpha. */
function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * Percentile-rank (0–100) → a green→lime→amber→red heat color for a score cell.
 * Returns the solid bar color plus a faint cell-background tint of the same hue,
 * so a high-scoring cell glows green and a weak one glows red — the "wall of
 * blue → instantly scannable" transform.
 *
 * The 8 bands are pure LEGIBILITY buckets (evenly spaced over the 0–100 rank),
 * NOT tuned against returns — consistent with the no-false-precision rule in
 * factorReading.ts. `bar` is the gauge fill; `tint` is the ~9%-opacity wash.
 */
const HEAT_RAMP: readonly [number, string][] = [
  [85, '#16a34a'], // deep green
  [75, '#22c55e'],
  [65, '#84cc16'],
  [55, '#a3e635'], // lime
  [45, '#fbbf24'], // amber
  [35, '#f59e0b'],
  [25, '#f87171'], // light red
  [0, '#dc2626'], // deep red
]

export function scoreHeat(value: number | null): { bar: string; tint: string } {
  if (value === null || Number.isNaN(value)) return { bar: '#cbd5e1', tint: 'transparent' }
  const hex = HEAT_RAMP.find(([t]) => value >= t)?.[1] ?? '#dc2626'
  return { bar: hex, tint: hexA(hex, 0.09) }
}

/**
 * Heatmap tint for a value within a metric's own min..max range. `higherIsBetter`
 * flips the scale so green is always the stronger end. Returns "transparent" when
 * the range is too small to be meaningful.
 */
export function heatBg(
  value: number,
  min: number,
  max: number,
  higherIsBetter: boolean,
): string {
  if (max - min < 1e-9) return 'transparent'
  let pos = (value - min) / (max - min)
  if (!higherIsBetter) pos = 1 - pos
  if (pos >= 0.5) return `rgba(16,185,129,${((pos - 0.5) * 2 * 0.16).toFixed(3)})`
  return `rgba(239,68,68,${((0.5 - pos) * 2 * 0.13).toFixed(3)})`
}
