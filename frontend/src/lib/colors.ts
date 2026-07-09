/** Color helpers for "good / bad" metric indicators. Green always = stronger.
 *
 * These emit theme-aware CSS custom properties (var(--pos)/var(--neg)/…) rather
 * than hard-coded hex, so every consumer (inline style / SVG stroke / fill) flips
 * correctly between light and dark with ZERO call-site changes. Dynamic-alpha
 * tints use color-mix() so a single expression works in both themes (the dark
 * token values are brighter, so their mix reads on a dark cell). */

export interface Tint {
  bg: string
  fg: string
}

/** P/L text color: green for ≥0, red for <0, neutral for null. */
export function plColor(x: number | null | undefined): string {
  return x == null ? 'var(--flat)' : x >= 0 ? 'var(--pos)' : 'var(--neg)'
}

/**
 * Universe percentile rank (0-100) -> pill colors. The rank is already
 * direction-adjusted (a high rank means "good for this factor" whether the
 * underlying metric is better high or low), so green = strong is unambiguous.
 */
export function rankColor(rank: number | null): Tint {
  if (rank === null || Number.isNaN(rank)) return { bg: 'var(--surface-2)', fg: 'var(--muted)' }
  if (rank >= 67) return { bg: 'var(--pos-soft)', fg: 'var(--pos)' } // strong
  if (rank >= 34) return { bg: 'var(--surface-2)', fg: 'var(--muted)' } // middle
  return { bg: 'var(--neg-soft)', fg: 'var(--neg)' } // weak
}

/**
 * Percentile-rank (0–100) → a 5-tier heat color for a score cell. Returns the
 * solid bar color plus a faint cell-background tint of the same hue, so a high-
 * scoring cell glows green and a weak one glows red — the "wall of blue →
 * instantly scannable" transform, applied identically to every factor column.
 *
 * The 5 bands are pure LEGIBILITY buckets (quintiles of the 0–100 rank), NOT
 * tuned against returns — consistent with the no-false-precision rule in
 * factorReading.ts. `bar` is the gauge fill; `tint` is the faint cell wash.
 */
const HEAT_RAMP: readonly [number, string][] = [
  [80, 'var(--pos-strong)'], // top quintile
  [60, 'var(--pos)'],
  [40, 'var(--warn-strong)'], // middle — amber
  [20, 'var(--neg-strong)'], // lighter red
  [0, 'var(--neg)'], // deepest red at the worst quintile (monotonic intensity)
]

export function scoreHeat(value: number | null): { bar: string; tint: string } {
  if (value === null || Number.isNaN(value)) {
    return { bar: 'var(--border-strong)', tint: 'transparent' }
  }
  const bar = HEAT_RAMP.find(([t]) => value >= t)?.[1] ?? 'var(--neg-strong)'
  return { bar, tint: `color-mix(in srgb, ${bar} 14%, transparent)` }
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
  if (pos >= 0.5) {
    const pct = ((pos - 0.5) * 2 * 16).toFixed(1)
    return `color-mix(in srgb, var(--pos-strong) ${pct}%, transparent)`
  }
  const pct = ((0.5 - pos) * 2 * 13).toFixed(1)
  return `color-mix(in srgb, var(--neg-strong) ${pct}%, transparent)`
}
