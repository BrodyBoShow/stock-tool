import type { FactorKey } from '@/lib/constants'
import type { ScreenerRow } from '@/types/api'

export interface Filters {
  search: string
  sector: string // "All" = no sector filter
  mins: Record<FactorKey, number> // 0 = "Any"
}

export const DEFAULT_FILTERS: Filters = {
  search: '',
  sector: 'All',
  mins: { composite: 0, growth: 0, value: 0, quality: 0, momentum: 0 },
}

const FACTOR_FIELD: Record<FactorKey, keyof ScreenerRow> = {
  composite: 'composite',
  growth: 'growth_pctl',
  value: 'value_pctl',
  quality: 'quality_pctl',
  momentum: 'momentum_pctl',
}

/**
 * Mirror of web/app.py _apply_screener_filters: score minimums keep
 * null-score rows (missing data is not a failing score).
 */
export function applyFilters(rows: ScreenerRow[], f: Filters): ScreenerRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter((r) => {
    if (q) {
      const tickerHit = r.ticker.toLowerCase().includes(q)
      const nameHit = (r.name ?? '').toLowerCase().includes(q)
      if (!tickerHit && !nameHit) return false
    }
    if (f.sector !== 'All' && r.sector !== f.sector) return false
    for (const key of Object.keys(f.mins) as FactorKey[]) {
      const min = f.mins[key]
      if (min > 0) {
        const v = r[FACTOR_FIELD[key]] as number | null
        if (v !== null && v < min) return false
      }
    }
    return true
  })
}

export function activeFilterCount(f: Filters): number {
  let n = 0
  if (f.search.trim()) n += 1
  if (f.sector !== 'All') n += 1
  for (const key of Object.keys(f.mins) as FactorKey[]) {
    if (f.mins[key] > 0) n += 1
  }
  return n
}
