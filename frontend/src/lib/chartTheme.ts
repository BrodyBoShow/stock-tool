import { useMemo } from 'react'

import { useTheme } from '@/lib/theme'

/** Concrete (resolved-to-hex) chart colors for the CURRENT theme.
 *
 * Recharts renders most color props (grid stroke, axis tick fill, tooltip
 * border, reference-line stroke) as SVG *presentation attributes*, and Safari/
 * WebKit does NOT substitute `var(--x)` inside those — a raw CSS var would make
 * the grid/axes invisible on iOS. So instead of passing `var(--border)` we read
 * the *computed* value of each token off <html> and hand Recharts a concrete
 * hex. Keyed on the resolved theme, the memo recomputes on every light/dark
 * flip, so charts re-colour instantly without a reload. */
export interface ChartTheme {
  grid: string
  axis: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  ink: string
  accent: string
  primary: string
  info: string
  pos: string
  neg: string
  warn: string
  muted: string
  surface: string
}

const FALLBACK_LIGHT: ChartTheme = {
  grid: '#e5ddcc',
  axis: '#8b8478',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e5ddcc',
  tooltipText: '#14110e',
  ink: '#14110e',
  accent: '#b45309',
  primary: '#0e5f58',
  info: '#0369a1',
  pos: '#166534',
  neg: '#b91c1c',
  warn: '#c2410c',
  muted: '#8b8478',
  surface: '#ffffff',
}

export function useChartTheme(): ChartTheme {
  const { theme } = useTheme()
  return useMemo(() => {
    if (typeof window === 'undefined') return FALLBACK_LIGHT
    const s = getComputedStyle(document.documentElement)
    const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
    return {
      grid: v('--border', FALLBACK_LIGHT.grid),
      axis: v('--subtle', FALLBACK_LIGHT.axis),
      tooltipBg: v('--surface', FALLBACK_LIGHT.tooltipBg),
      tooltipBorder: v('--border', FALLBACK_LIGHT.tooltipBorder),
      tooltipText: v('--ink', FALLBACK_LIGHT.tooltipText),
      ink: v('--ink', FALLBACK_LIGHT.ink),
      accent: v('--accent', FALLBACK_LIGHT.accent),
      primary: v('--primary', FALLBACK_LIGHT.primary),
      info: v('--info', FALLBACK_LIGHT.info),
      pos: v('--pos-strong', FALLBACK_LIGHT.pos),
      neg: v('--neg', FALLBACK_LIGHT.neg),
      warn: v('--warn', FALLBACK_LIGHT.warn),
      muted: v('--subtle', FALLBACK_LIGHT.muted),
      surface: v('--surface', FALLBACK_LIGHT.surface),
      // theme is the memo key: recompute concrete hex on every light/dark flip
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])
}
