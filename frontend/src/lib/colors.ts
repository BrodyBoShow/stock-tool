/** Color helpers for "good / bad" metric indicators. Green always = stronger. */

export interface Tint {
  bg: string
  fg: string
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
