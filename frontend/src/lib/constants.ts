/** Design tokens + factor/metric metadata — mirrors web/app.py exactly. */

/** Small uppercase section/field label used across the deep-dive panels. */
export const PANEL_LABEL =
  'text-[0.67rem] font-bold uppercase tracking-[0.06em] text-subtle'

/** Header row (<tr>) styling shared by the data tables (Portfolio, Market, Funds, Lab). */
export const TABLE_HEAD_ROW =
  'border-b border-divider text-left text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-subtle'

/** Header cell for the virtualized flex tables (Screener, Watchlist). */
export const VIRT_TABLE_HEAD_CELL =
  'flex items-center px-3 py-[6px] text-[0.66rem] font-bold uppercase tracking-[0.06em] whitespace-nowrap select-none'

/** Shared form-control styling so every form on the app reads identically. */
export const FORM_LABEL = 'text-[0.7rem] font-semibold text-muted'
export const FORM_INPUT =
  'rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[0.82rem] text-ink ' +
  'focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

/** Recharts font sizes — shared so every chart's axis ticks + legend match. */
export const CHART_TICK_SIZE = 11
export const CHART_LABEL_SIZE = 12

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

/** (bar color, high-score cell tint, header text color) per factor.
 *
 * Theme-aware factor identity quartet (2026-07 refresh): Growth = steel blue,
 * Value = forest green, Quality = petrol teal, Momentum = orange — all drawn
 * from the semantic tokens so both themes stay AA with no per-theme table.
 * These are var() strings: fine in HTML styles, but NOT in SVG presentation
 * attributes (Safari) — chart strokes must resolve them to hex first (see
 * ScoreStoryPanel's resolver / useChartTheme). */
export const FACTOR_TABLE: Record<
  FactorKey,
  { bar: string; tint: string; header: string }
> = {
  composite: {
    bar: 'var(--ink)',
    tint: 'color-mix(in srgb, var(--ink) 8%, transparent)',
    header: 'var(--ink)',
  },
  growth: {
    bar: 'var(--info)',
    tint: 'color-mix(in srgb, var(--info) 10%, transparent)',
    header: 'var(--info)',
  },
  value: {
    bar: 'var(--pos)',
    tint: 'color-mix(in srgb, var(--pos) 10%, transparent)',
    header: 'var(--pos)',
  },
  quality: {
    bar: 'var(--primary)',
    tint: 'color-mix(in srgb, var(--primary) 10%, transparent)',
    header: 'var(--primary)',
  },
  momentum: {
    bar: 'var(--warn)',
    tint: 'color-mix(in srgb, var(--warn) 10%, transparent)',
    header: 'var(--warn)',
  },
}

/** Plain-English factor definitions — shared by the screener legend, the holdings
 *  Score column and the portfolio factor-tilt bars (one source of truth). */
export const FACTOR_TIP: Record<FactorKey, string> = {
  composite:
    'Overall standing — a weighted blend of the four factor percentiles. 50 = median stock; higher is better-ranked across the whole universe.',
  growth: 'Revenue & EPS growth, percentile-ranked vs the universe.',
  value: 'Valuation — cheaper on P/E, P/S, EV/EBITDA and FCF yield ranks higher.',
  quality:
    'Profitability & balance-sheet strength — ROIC, margins, low leverage, clean accruals, low share issuance.',
  momentum:
    'Price trend that rewards a still-trending name — near its 52-week high, rising smoothly — over one that spiked then faded. Blends 12-minus-1 return, 52-week-high proximity and up-day fraction.',
}

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

/**
 * Theme-aware sector chip colors, derived from the sector's single hue.
 * `bg` mixes the hue into the current `--surface` (a light tint on light, a
 * subtle wash on dark) and `fg` mixes it toward `--ink` (a darkened hue on
 * light for AA, a lifted hue on dark) — so one categorical hue reads in BOTH
 * themes with no per-theme table. `hue` is the raw color for dots/rings.
 */
export function sectorChip(sector: string | null): {
  hue: string
  bg: string
  fg: string
} {
  const hue = sectorPillColors(sector)[1]
  return {
    hue,
    // Mix toward --ink for the text: since --ink is dark on light and light on
    // dark, the ink share lifts contrast in BOTH themes. At 55% hue every sector
    // clears WCAG-AA (min 4.9:1 on dark, 7.1:1 on light) while staying distinct.
    bg: `color-mix(in srgb, ${hue} 15%, var(--surface))`,
    fg: `color-mix(in srgb, ${hue} 55%, var(--ink))`,
  }
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
    ['prox_52w', 'higher'], // v6 (52-week-high proximity)
    ['pos_days', 'higher'], // v6 (up-day fraction)
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
  prox_52w: '52-Wk High Proximity',
  pos_days: 'Up-Day Fraction',
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
  prox_52w:
    'Not enough price history to measure 52-week-high proximity (needs ~3 months).',
  pos_days:
    'Not enough price history to measure the up-day fraction (needs ~3 months).',
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
  { id: 'DTWEXBGS', label: 'US Dollar', unit: '', dec: 1 },
  { id: 'BAMLH0A0HYM2', label: 'HY Spread', unit: '%', dec: 2 },
]
