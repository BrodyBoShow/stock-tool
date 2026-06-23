import type { MacroObservation } from '@/types/api'

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
