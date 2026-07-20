/**
 * Shared vocabulary for the Funds tab (Phase 2). Category metadata, color
 * helpers, and the column/sort types the leaderboard + category tables agree on.
 *
 * HONESTY: the free data stack (SEC/yfinance/FRED) gives AUM, volume, NAV→
 * premium/discount, beta, category, issuer, and equity holdings — but NOT
 * expense ratio, tracking error, or bid-ask spread. So there is deliberately no
 * `exp` / `te` / `spread` column and no "Cheapest" badge anywhere here. Do not
 * add them back with placeholder numbers.
 */
import type { EnrichedFund } from '@/types/api'

// ── Categories ────────────────────────────────────────────────────────────
export interface CatMeta {
  key: string // engine category value
  label: string // full display name
  short: string // 3-letter badge code
  accent: string // left-border / tile hue
  badge: string // tailwind classes for the small category pill
}

/** Ordered category metadata. `accent` matches the mock's colored left-borders. */
export const FUND_CATEGORIES: CatMeta[] = [
  { key: 'Commodity', label: 'Commodity', short: 'COMM', accent: '#d4af37',
    badge: 'bg-amber-100 text-amber-800' },
  { key: 'Crypto', label: 'Crypto', short: 'CRY', accent: '#f7931a',
    badge: 'bg-orange-100 text-orange-800' },
  { key: 'Leveraged/Inverse', label: 'Leveraged/Inverse', short: 'LEV', accent: '#dc2626',
    badge: 'bg-red-100 text-red-700' },
  { key: 'Other', label: 'Other (Broad Market)', short: 'OTH', accent: '#3b82f6',
    badge: 'bg-blue-100 text-blue-700' },
]

const CAT_BY_KEY = new Map(FUND_CATEGORIES.map((c) => [c.key, c]))

/** Category metadata, falling back to a neutral "Other"-style entry. */
export function catMeta(key: string | null | undefined): CatMeta {
  const hit = key ? CAT_BY_KEY.get(key) : undefined
  return (
    hit ?? {
      key: key ?? 'Other', label: key ?? 'Other', short: 'OTH', accent: '#3b82f6',
      badge: 'bg-blue-100 text-blue-700',
    }
  )
}

/** Leveraged/inverse funds carry a decay warning in the drawer. */
export function isLeveraged(category: string | null | undefined): boolean {
  return category === 'Leveraged/Inverse'
}

// ── Colors ────────────────────────────────────────────────────────────────
export interface Swatch { bg: string; fg: string }

/**
 * Rank-within-category chip tone: top quartile green, bottom quartile red,
 * middle slate. `rank` is 1-based (1 = best), `n` the category size.
 */
export function rankTone(rank: number | null, n: number | null): string {
  if (!rank || !n || n < 2) return 'bg-surface-2 text-muted'
  const pct = (rank - 1) / (n - 1)
  if (pct <= 0.25) return 'bg-pos-soft text-pos'
  if (pct >= 0.75) return 'bg-neg-soft text-neg'
  return 'bg-surface-2 text-muted'
}

/**
 * Watchlist-bridge overlap tone (high overlap = strong match, framed positively
 * like the mock: green ≥30%, amber ≥15%, slate below).
 */
export function bridgeTone(pct: number): string {
  if (pct >= 0.3) return 'bg-pos-soft text-pos'
  if (pct >= 0.15) return 'bg-warn-soft text-warn'
  return 'bg-surface-2 text-muted'
}

/**
 * Compare-mode overlap-matrix tone — here high overlap is a REDUNDANCY warning,
 * so the scale is inverted: green (<30%, well diversified) → amber → red (>70%,
 * essentially the same exposure). Returns a faint tinted cell background (theme
 * tokens so the wash reads on dark too).
 */
export function overlapMatrixColor(j: number): Swatch {
  if (j >= 0.7) return { bg: 'var(--neg-soft)', fg: 'var(--neg)' }
  if (j >= 0.3) return { bg: 'var(--warn-soft)', fg: 'var(--warn)' }
  return { bg: 'var(--pos-soft)', fg: 'var(--pos)' }
}

// ── Columns / sorting ───────────────────────────────────────────────────────
export type FundColumnKey =
  | 'spark' | 'price' | 'r1w' | 'r1m' | 'r3m' | 'r90d' | 'rytd'
  | 'aum' | 'avg_volume' | 'premium_discount' | 'beta' | 'vol' | 'mdd' | 'sharpe'

export type FundSortKey = Exclude<FundColumnKey, 'spark'> | 'ticker'
export interface FundSort { key: FundSortKey; dir: 'asc' | 'desc' }

export interface FundColumnDef {
  label: string // header text
  num: boolean // right-aligned monospace numeric
  sortable: boolean
}

/** Column header metadata. Rendering/formatting lives in the table component. */
export const FUND_COLUMNS: Record<FundColumnKey, FundColumnDef> = {
  spark: { label: '90D', num: false, sortable: false },
  price: { label: 'Price', num: true, sortable: true },
  r1w: { label: '1W', num: true, sortable: true },
  r1m: { label: '1M', num: true, sortable: true },
  r3m: { label: '3M', num: true, sortable: true },
  r90d: { label: '90D %', num: true, sortable: true },
  rytd: { label: 'YTD', num: true, sortable: true },
  aum: { label: 'AUM', num: true, sortable: true },
  avg_volume: { label: 'Vol', num: true, sortable: true },
  premium_discount: { label: 'P/D', num: true, sortable: true },
  beta: { label: 'β SPY', num: true, sortable: true },
  vol: { label: 'Vol σ', num: true, sortable: true },
  mdd: { label: 'Max DD', num: true, sortable: true },
  sharpe: { label: 'Sharpe', num: true, sortable: true },
}

/** Columns shown by default (the 3 most-actionable ETF fields + price/returns). */
export const DEFAULT_FUND_COLUMNS: FundColumnKey[] = [
  'spark', 'price', 'r1w', 'r1m', 'r3m', 'rytd', 'aum', 'avg_volume',
]

/** Optional columns offered by the "Columns ▾" toolbar dropdown. */
export const OPTIONAL_FUND_COLUMNS: FundColumnKey[] = [
  'r90d', 'premium_discount', 'beta', 'vol', 'mdd', 'sharpe',
]

/** Numeric value for sorting a fund by a sort key (nulls sort last via caller). */
export function fundSortValue(f: EnrichedFund, key: FundSortKey): number | null {
  switch (key) {
    case 'ticker': return null // handled as a string compare by the caller
    case 'price': return f.last_close
    default: return (f[key] as number | null) ?? null
  }
}

/** Apply a sort to a copy of the fund list; nulls always sink to the bottom. */
export function sortFunds(funds: EnrichedFund[], sort: FundSort): EnrichedFund[] {
  const out = [...funds]
  const mul = sort.dir === 'asc' ? 1 : -1
  if (sort.key === 'ticker') {
    out.sort((a, b) => mul * (a.ticker || '').localeCompare(b.ticker || ''))
    return out
  }
  out.sort((a, b) => {
    const av = fundSortValue(a, sort.key)
    const bv = fundSortValue(b, sort.key)
    if (av == null && bv == null) return 0
    if (av == null) return 1 // nulls last regardless of dir
    if (bv == null) return -1
    return mul * (av - bv)
  })
  return out
}

/** AUM formatter: $2.3T / $58.2B / $412M (fund AUM is already in dollars). */
export function fmtAum(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export const MAX_COMPARE = 6
