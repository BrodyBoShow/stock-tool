import type { FactorKey } from '@/lib/constants'
import type { ScreenerRow } from '@/types/api'

export interface Filters {
  search: string
  sectors: string[] // empty = all sectors (multi-select)
  mins: Record<FactorKey, number> // 0 = "Any"
  minMarketCap: number // dollars; 0 = "Any"
  completeOnly: boolean // only rank names with all 4 component factors (server-side)
  excludePenny: boolean // drop names priced under $1 (client-side)
}

export const DEFAULT_FILTERS: Filters = {
  search: '',
  sectors: [],
  mins: { composite: 0, growth: 0, value: 0, quality: 0, momentum: 0 },
  minMarketCap: 0,
  completeOnly: true,
  excludePenny: false,
}

/** Market-cap floor presets (label, dollars). */
export const MARKET_CAP_OPTIONS: Array<{ label: string; value: number }> = [
  { label: 'Any size', value: 0 },
  { label: '≥ $300M (small+)', value: 300_000_000 },
  { label: '≥ $2B (mid+)', value: 2_000_000_000 },
  { label: '≥ $10B (large)', value: 10_000_000_000 },
  { label: '≥ $200B (mega)', value: 200_000_000_000 },
]

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
    if (f.sectors.length > 0 && (r.sector == null || !f.sectors.includes(r.sector)))
      return false
    // Size floor is a hard gate: unknown market cap is excluded when active
    // (unlike score minimums — a size filter exists to drop unsized names).
    if (f.minMarketCap > 0) {
      if (r.market_cap == null || r.market_cap < f.minMarketCap) return false
    }
    // Penny-stock exclude: drop known sub-$1 names (null price is kept — missing
    // ≠ penny). Frontend-only; the backend already floors scoring at $1.
    if (f.excludePenny && r.last_price != null && r.last_price < 1) return false
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
  if (f.sectors.length > 0) n += 1
  if (f.minMarketCap > 0) n += 1
  if (f.excludePenny) n += 1
  for (const key of Object.keys(f.mins) as FactorKey[]) {
    if (f.mins[key] > 0) n += 1
  }
  return n
}

// ── sort + URL state ──────────────────────────────────────────────────────────

export type ScreenerSortKey =
  | 'rank'
  | 'ticker'
  | 'sector'
  | 'composite'
  | 'growth_pctl'
  | 'value_pctl'
  | 'quality_pctl'
  | 'momentum_pctl'
  | 'last_price'
  | 'market_cap'
  | 'rank_delta'

export interface ScreenerSort {
  key: ScreenerSortKey
  dir: 1 | -1
}

export const DEFAULT_SORT: ScreenerSort = { key: 'composite', dir: -1 }

const SORT_KEYS = new Set<string>([
  'rank', 'ticker', 'sector', 'composite', 'growth_pctl', 'value_pctl',
  'quality_pctl', 'momentum_pctl', 'last_price', 'market_cap', 'rank_delta',
])

/** Serialize filters + sort into URL query params (defaults omitted, so a
 * pristine screen has a clean URL). Makes a screen bookmarkable + shareable. */
export function filtersToParams(f: Filters, sort: ScreenerSort): URLSearchParams {
  const sp = new URLSearchParams()
  if (f.search.trim()) sp.set('q', f.search.trim())
  if (f.sectors.length > 0) sp.set('sector', f.sectors.join(','))
  if (f.minMarketCap > 0) sp.set('mcap', String(f.minMarketCap))
  if (!f.completeOnly) sp.set('partial', '1')
  if (f.excludePenny) sp.set('penny', '1')
  for (const key of Object.keys(f.mins) as FactorKey[]) {
    if (f.mins[key] > 0) sp.set(key, String(f.mins[key]))
  }
  if (sort.key !== DEFAULT_SORT.key || sort.dir !== DEFAULT_SORT.dir) {
    sp.set('sort', sort.key)
    sp.set('dir', sort.dir === 1 ? 'asc' : 'desc')
  }
  return sp
}

/** Rebuild filters + sort from URL params (inverse of filtersToParams). */
export function filtersFromParams(sp: URLSearchParams): {
  filters: Filters
  sort: ScreenerSort
} {
  const mins = { ...DEFAULT_FILTERS.mins }
  for (const key of Object.keys(mins) as FactorKey[]) {
    const v = Number(sp.get(key))
    if (Number.isFinite(v) && v > 0) mins[key] = Math.min(100, Math.max(0, Math.round(v)))
  }
  const mcap = Number(sp.get('mcap'))
  const filters: Filters = {
    search: sp.get('q') ?? '',
    sectors: (sp.get('sector') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    minMarketCap: Number.isFinite(mcap) && mcap > 0 ? mcap : 0,
    completeOnly: sp.get('partial') !== '1',
    excludePenny: sp.get('penny') === '1',
    mins,
  }
  const sk = sp.get('sort')
  const sort: ScreenerSort =
    sk && SORT_KEYS.has(sk)
      ? { key: sk as ScreenerSortKey, dir: sp.get('dir') === 'asc' ? 1 : -1 }
      : DEFAULT_SORT
  return { filters, sort }
}
