/** Design tokens + factor/metric metadata — mirrors web/app.py exactly. */

export type FactorKey = 'composite' | 'growth' | 'value' | 'quality' | 'momentum'

export const FACTOR_ORDER: FactorKey[] = [
  'composite',
  'growth',
  'value',
  'quality',
  'momentum',
]

/** (bar color, high-score cell tint, header text color) per factor. */
export const FACTOR_TABLE: Record<
  FactorKey,
  { bar: string; tint: string; header: string }
> = {
  composite: { bar: '#1e293b', tint: 'rgba(30,41,59,0.08)', header: '#1e293b' },
  growth: { bar: '#3b82f6', tint: 'rgba(59,130,246,0.10)', header: '#2563eb' },
  value: { bar: '#10b981', tint: 'rgba(16,185,129,0.10)', header: '#059669' },
  quality: { bar: '#a855f7', tint: 'rgba(168,85,247,0.10)', header: '#9333ea' },
  momentum: { bar: '#f59e0b', tint: 'rgba(245,158,11,0.10)', header: '#d97706' },
}

export const LOW_SCORE_TINT = 'rgba(239,68,68,0.07)'

/** Sector pill colors: [background, text]. */
export const SECTOR_PILLS: Record<string, [string, string]> = {
  Technology: ['#dbeafe', '#1d4ed8'],
  'Information Technology': ['#dbeafe', '#1d4ed8'],
  'Health Care': ['#dcfce7', '#15803d'],
  Financials: ['#fef9c3', '#a16207'],
  'Real Estate': ['#fee2e2', '#b91c1c'],
  Materials: ['#f3e8ff', '#7e22ce'],
  Energy: ['#ffedd5', '#c2410c'],
  'Consumer Discretionary': ['#fce7f3', '#9d174d'],
  'Consumer Staples': ['#ecfeff', '#0e7490'],
  Utilities: ['#e0f2fe', '#0369a1'],
  Industrials: ['#f1f5f9', '#475569'],
  'Communication Services': ['#fdf4ff', '#86198f'],
}

export const SECTOR_PILL_DEFAULT: [string, string] = ['#f1f5f9', '#475569']

export function sectorPillColors(sector: string | null): [string, string] {
  if (!sector) return SECTOR_PILL_DEFAULT
  return SECTOR_PILLS[sector] ?? SECTOR_PILL_DEFAULT
}

/** Factor -> [metric key, better-when direction] (mirrors FACTOR_DEFS). */
export const FACTOR_DEFS: Record<
  Exclude<FactorKey, 'composite'>,
  Array<[string, 'higher' | 'lower']>
> = {
  growth: [
    ['revenue_cagr', 'higher'],
    ['eps_growth', 'higher'],
  ],
  value: [
    ['pe', 'lower'],
    ['ps', 'lower'],
    ['ev_ebitda', 'lower'],
    ['fcf_yield', 'higher'],
  ],
  quality: [
    ['gross_margin', 'higher'],
    ['operating_margin', 'higher'],
    ['roic', 'higher'],
    ['debt_to_equity', 'lower'],
    ['net_debt_ebitda', 'lower'],
  ],
  momentum: [
    ['r3m', 'higher'],
    ['r6m', 'higher'],
    ['r12m', 'higher'],
  ],
}

export const INPUT_LABELS: Record<string, string> = {
  revenue_cagr: 'Revenue CAGR (3y)',
  eps_growth: 'EPS Growth (YoY)',
  pe: 'P / E',
  ps: 'P / S',
  ev_ebitda: 'EV / EBITDA',
  fcf_yield: 'FCF Yield',
  gross_margin: 'Gross Margin',
  operating_margin: 'Op. Margin',
  roic: 'ROIC',
  debt_to_equity: 'Debt / Equity',
  net_debt_ebitda: 'Net Debt / EBITDA',
  r3m: '3-Month Return',
  r6m: '6-Month Return',
  r12m: '12-Month Return',
}

export const METRIC_DISPLAY_ORDER = [
  'ttm_revenue',
  'fcf',
  'ttm_eps',
  'gross_margin',
  'operating_margin',
  'roic',
  'debt_to_equity',
  'net_debt_ebitda',
  'current_ratio',
  'revenue_cagr',
  'eps_growth',
  'share_count_trend',
] as const

export const METRIC_LABELS: Record<string, string> = {
  ttm_revenue: 'Revenue (TTM)',
  fcf: 'Free Cash Flow',
  ttm_eps: 'EPS (TTM)',
  gross_margin: 'Gross Margin',
  operating_margin: 'Op. Margin',
  roic: 'ROIC',
  debt_to_equity: 'Debt / Equity',
  net_debt_ebitda: 'Net Debt / EBITDA',
  current_ratio: 'Current Ratio',
  revenue_cagr: 'Revenue CAGR',
  eps_growth: 'EPS Growth',
  share_count_trend: 'Share Count Trend',
}

/** Metrics that don't apply to banks / insurance / REITs. */
export const FINANCIAL_NULL_METRICS = new Set([
  'gross_margin',
  'operating_margin',
  'current_ratio',
  'net_debt_ebitda',
])
export const FINANCIAL_SECTORS = new Set(['Financials', 'Real Estate'])

/** Shared CSS grid template for the screener table header + rows. */
export const SCREENER_GRID =
  '38px minmax(150px,1.6fr) minmax(130px,1.3fr) repeat(5,minmax(78px,1fr)) minmax(90px,0.9fr)'

export const PREVIEW_N = 100
