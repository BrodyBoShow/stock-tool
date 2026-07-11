import type { CompareSeries, MacroObservation } from '@/types/api'

export function buildRanges(): { label: string; days: number }[] {
  const now = new Date()
  const jan1 = new Date(now.getFullYear(), 0, 1)
  const ytd = Math.max(1, Math.ceil((now.getTime() - jan1.getTime()) / 86_400_000))
  return [
    { label: '1M', days: 30 },
    { label: '3M', days: 90 },
    { label: '6M', days: 180 },
    { label: 'YTD', days: ytd },
    { label: '1Y', days: 365 },
    { label: '3Y', days: 1095 },
    { label: '5Y', days: 1825 },
  ]
}

export const OVERLAY_COLOR = '#7c3aed'
export const MA50_COLOR = '#06b6d4'   // cyan
export const MA200_COLOR = '#f97316'  // orange

export interface ChartRow {
  date: string
  v: number
  vol: number | null
  upDay: boolean
  macro?: number | null
  ma50?: number | null
  ma200?: number | null
}

export function asOfMerge(rows: ChartRow[], obs: MacroObservation[]): ChartRow[] {
  const sorted = obs.filter((o) => o.value !== null)
  let i = 0
  let last: number | null = null
  return rows.map((p) => {
    while (i < sorted.length && sorted[i].date <= p.date) {
      last = sorted[i].value as number
      i++
    }
    return { ...p, macro: last }
  })
}

export function rollingMean(vals: (number | null)[], n: number): (number | null)[] {
  return vals.map((_, i) => {
    if (i < n - 1) return null
    const slice = vals.slice(i - n + 1, i + 1)
    const nums = slice.filter((v): v is number => v !== null)
    return nums.length === n ? nums.reduce((a, b) => a + b, 0) / n : null
  })
}

// ── Pro-chart interactivity helpers ───────────────────────────────────────────

/** Distinct palette for compare-overlay series (one per MAX_COMPARE slot).
 * Deliberately avoids the price blue (#2563eb), MA cyan/orange, and the macro
 * violet, and every entry reads on both light and dark surfaces. */
export const COMPARE_COLORS = ['#db2777', '#0d9488', '#9333ea', '#e11d48']

export function compareColor(idx: number): string {
  return COMPARE_COLORS[idx % COMPARE_COLORS.length]
}

export const MAX_COMPARE = 4

// ── Marker categories (filings / 8-Ks / insider trades on the price chart) ────

export type MarkerCat = 'earnings' | 'k8_high' | 'k8_routine' | 'other_filing' | 'buy' | 'sell'

export const MARKER_META: Record<
  MarkerCat,
  { label: string; color: string; glyph: string; pos: 'top' | 'bottom' }
> = {
  earnings: { label: '10-K / 10-Q', color: '#2563eb', glyph: '▾', pos: 'top' },
  k8_high: { label: '8-K · high-signal', color: '#f59e0b', glyph: '▾', pos: 'top' },
  k8_routine: { label: '8-K · routine', color: '#fcd34d', glyph: '▾', pos: 'top' },
  other_filing: { label: 'Other filings', color: '#64748b', glyph: '▾', pos: 'top' },
  buy: { label: 'Insider buy', color: '#22c55e', glyph: '▴', pos: 'bottom' },
  sell: { label: 'Insider sell', color: '#ef4444', glyph: '▾', pos: 'bottom' },
}

export const MARKER_ORDER: MarkerCat[] = [
  'earnings', 'k8_high', 'k8_routine', 'other_filing', 'buy', 'sell',
]

export interface MarkerItem {
  key: string
  date: string // original event date
  snapDate: string // snapped to the nearest price bar (chart x position)
  cat: MarkerCat
  title: string
  detail?: string
  url?: string | null
}

/** A ChartRow plus the pro-chart extras. Compare overlays land in `cmp_TICKER`
 * keys; `vRaw` preserves the actual $ close when the display value is rebased
 * to % in percent mode. */
export interface ProChartRow extends ChartRow {
  avgVol20?: number | null
  chgPct?: number | null // day-over-day % change (vs previous close)
  vRaw?: number
  ma50Raw?: number | null
  ma200Raw?: number | null
  [key: `cmp_${string}`]: number | null | undefined
}

/** 20-day rolling average volume (null until 20 bars exist). */
export function withAvgVol(rows: ProChartRow[], n = 20): ProChartRow[] {
  let sum = 0
  let count = 0
  const window: (number | null)[] = []
  return rows.map((r) => {
    window.push(r.vol)
    if (r.vol !== null) {
      sum += r.vol
      count++
    }
    if (window.length > n) {
      const out = window.shift()
      if (out !== null && out !== undefined) {
        sum -= out
        count--
      }
    }
    return { ...r, avgVol20: window.length === n && count > 0 ? sum / count : null }
  })
}

/** As-of merge each compare series into `cmp_TICKER` keys (last value on or
 * before each price date — same approach as the macro overlay merge). */
export function mergeCompareSeries(rows: ProChartRow[], series: CompareSeries[]): ProChartRow[] {
  if (series.length === 0) return rows
  const merged = rows.map((r) => ({ ...r }))
  for (const s of series) {
    const pts = s.points.filter((p) => p.value !== null)
    let i = 0
    let last: number | null = null
    for (const row of merged) {
      while (i < pts.length && pts[i].date <= row.date) {
        last = pts[i].value as number
        i++
      }
      row[`cmp_${s.ticker}`] = last
    }
  }
  return merged
}

/** Rebase price/MAs/compare series to % change from each series' own first
 * visible value. Keeps the raw $ values in vRaw/ma50Raw/ma200Raw so tooltips
 * can show both. Series with no visible base stay null. */
export function toPercentMode(rows: ProChartRow[], compareTickers: string[]): ProChartRow[] {
  if (rows.length === 0) return rows
  const priceBase = rows.find((r) => r.v > 0)?.v ?? null
  const bases: Record<string, number | null> = {}
  for (const t of compareTickers) {
    const key = `cmp_${t}` as const
    bases[t] = rows.map((r) => r[key]).find((v): v is number => typeof v === 'number' && v > 0) ?? null
  }
  const pct = (v: number | null | undefined, base: number | null): number | null =>
    typeof v === 'number' && base ? ((v / base) - 1) * 100 : null

  return rows.map((r) => {
    const out: ProChartRow = {
      ...r,
      vRaw: r.v,
      ma50Raw: r.ma50,
      ma200Raw: r.ma200,
      v: pct(r.v, priceBase) ?? 0,
      ma50: pct(r.ma50, priceBase),
      ma200: pct(r.ma200, priceBase),
    }
    for (const t of compareTickers) {
      const key = `cmp_${t}` as const
      out[key] = pct(r[key], bases[t])
    }
    return out
  })
}

export interface WindowStats {
  high: number
  highDate: string
  low: number
  lowDate: string
  first: number
  last: number
}

/** High/low/first/last of the *visible* window — honest for any range/zoom. */
export function windowStats(rows: ProChartRow[]): WindowStats | null {
  let stats: WindowStats | null = null
  for (const r of rows) {
    const v = r.vRaw ?? r.v
    if (!(v > 0)) continue
    if (!stats) {
      stats = { high: v, highDate: r.date, low: v, lowDate: r.date, first: v, last: v }
      continue
    }
    if (v > stats.high) {
      stats.high = v
      stats.highDate = r.date
    }
    if (v < stats.low) {
      stats.low = v
      stats.lowDate = r.date
    }
    stats.last = v
  }
  return stats
}
