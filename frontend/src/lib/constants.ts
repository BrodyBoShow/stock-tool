/** Design tokens + factor/metric metadata — mirrors web/app.py exactly. */

/** Small uppercase section/field label used across the deep-dive panels. */
export const PANEL_LABEL =
  'text-[0.67rem] font-bold uppercase tracking-[0.06em] text-gray-500'

/** Sectors whose factor scores are structurally commodity-price-driven — their
 * Value/Momentum/Quality all ride the underlying commodity (oil, metals), so a
 * high rank reflects the commodity trend, not durability. Used to flag "read the
 * catalyst, not the rank" on the score. */
export const COMMODITY_SENSITIVE_SECTORS = new Set(['Energy', 'Materials'])

export function isCommoditySensitive(sector: string | null | undefined): boolean {
  return sector != null && COMMODITY_SENSITIVE_SECTORS.has(sector)
}

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
  // Union of v1 + v2 sub-metrics. FactorInputsTable renders only the rows
  // actually present in the served snapshot's sub_pctls, so the same table
  // works whether the backend is on v1_linear or v2_linear.
  quality: [
    ['gross_margin', 'higher'],
    ['operating_margin', 'higher'],
    ['roic', 'higher'],
    ['debt_to_equity', 'lower'],
    ['net_debt_ebitda', 'lower'],
    ['accruals', 'lower'], // v2
    ['share_count_trend', 'lower'], // v2
    ['insider_net_buy', 'higher'], // v2
  ],
  momentum: [
    ['r3m', 'higher'],
    ['r6m', 'higher'],
    ['r12m', 'higher'], // v1
    ['r12_1m', 'higher'], // v2 (12-minus-1)
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
  r12_1m: '12-1 Momentum',
  accruals: 'Accruals (Sloan)',
  share_count_trend: 'Net Share Issuance',
  insider_net_buy: 'Insider Net Buy',
}

/**
 * Why a sub-metric is blank. Shown as a tooltip on the "n/a" cell so a dash
 * reads as intentional, not a broken pipeline. These describe the *common*
 * reasons honestly (we don't assert a single per-company cause): most blanks
 * are structural — a metric that doesn't exist for the business (banks have no
 * gross margin, pre-revenue firms have no P/E) — or a line the company simply
 * doesn't break out in its SEC filings.
 */
export const METRIC_NA_REASON: Record<string, string> = {
  revenue_cagr:
    'Needs 3 years of revenue history. Blank for recent listings, or when revenue is zero/negative (e.g. a pre-revenue company).',
  eps_growth:
    "Prior-period EPS isn't available or was ~zero, so a year-over-year growth rate can't be computed.",
  pe: 'Earnings are negative or not reported — a negative P/E carries no meaning, so it is left blank rather than shown as a misleading number.',
  ps: 'No revenue reported (e.g. a pre-commercial biotech), so price-to-sales is undefined.',
  ev_ebitda:
    'EBITDA is negative or not reported, so the multiple would be meaningless.',
  fcf_yield:
    "Operating cash flow or market cap isn't available to compute free-cash-flow yield.",
  gross_margin:
    'No cost-of-revenue line in the filings — normal for banks, insurers, and REITs (no COGS), or for pre-revenue firms. Some companies report cost under custom tags we may not capture.',
  operating_margin:
    'No revenue, or no operating-income subtotal reported (some financials present their P&L differently).',
  roic:
    "No invested-capital or operating-income basis reported for this company's structure.",
  debt_to_equity:
    'No interest-bearing debt on the balance sheet (often equity-funded), or shareholders’ equity is negative/unreported.',
  net_debt_ebitda:
    'No debt reported, or EBITDA is negative/unavailable.',
  accruals:
    "Balance-sheet or cash-flow inputs the accruals calc needs aren't reported.",
  share_count_trend:
    'Not enough share-count history yet to measure net issuance.',
  insider_net_buy:
    'No insider (Form 4) transactions recorded for this company in the lookback window. Coverage is still backfilling across the expanded universe.',
  r3m: 'Not enough price history for a 3-month return (e.g. a recent listing).',
  r6m: 'Not enough price history for a 6-month return (e.g. a recent listing).',
  r12m: 'Not enough price history for a 12-month return (e.g. a recent listing).',
  r12_1m: 'Not enough price history for 12-minus-1 momentum (needs ~13 months).',
}

export const METRIC_NA_REASON_FALLBACK =
  "Not reported in this company's filings, or not applicable to its business model."

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
/** Which direction is "good" for each fundamental metric (drives heatmap color). */
export const HIGHER_IS_BETTER: Record<string, boolean> = {
  ttm_revenue: true,
  fcf: true,
  ttm_eps: true,
  gross_margin: true,
  operating_margin: true,
  roic: true,
  debt_to_equity: false,
  net_debt_ebitda: false,
  current_ratio: true,
  revenue_cagr: true,
  eps_growth: true,
  share_count_trend: false, // shrinking share count (buybacks) is the good direction
}

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

/** FRED macro context series — CONTEXT ONLY, never feeds factor scores.
 *  Mirrors web/app.py MACRO_DISPLAY: (id, label, unit suffix, decimals). */
export const MACRO_DISPLAY: Array<{
  id: string
  label: string
  unit: string
  dec: number
}> = [
  { id: 'DGS10', label: '10Y Treasury', unit: '%', dec: 2 },
  { id: 'DGS2', label: '2Y Treasury', unit: '%', dec: 2 },
  { id: 'FEDFUNDS', label: 'Fed Funds', unit: '%', dec: 2 },
  { id: 'CPIAUCSL', label: 'CPI', unit: '', dec: 1 },
  { id: 'VIXCLS', label: 'VIX', unit: '', dec: 2 },
]
