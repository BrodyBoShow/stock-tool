/** Number formatters — exact ports of web/app.py fmt_* so the two UIs agree. */

const DASH = '—' // —

function f(v: number | null | undefined): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null
  return v
}

export function fmtPct(v: number | null | undefined, decimals = 1): string {
  const x = f(v)
  if (x === null) return DASH
  return `${(x * 100).toFixed(decimals)}%`
}

export function fmtX(v: number | null | undefined, decimals = 1): string {
  const x = f(v)
  if (x === null) return DASH
  return `${x.toFixed(decimals)}×`
}

export function fmtPrice(v: number | null | undefined): string {
  const x = f(v)
  if (x === null) return DASH
  return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtMoney(v: number | null | undefined): string {
  const x = f(v)
  if (x === null) return DASH
  const a = Math.abs(x)
  if (a >= 1e12) return `$${(x / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(x / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(x / 1e6).toFixed(1)}M`
  return `$${x.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function fmtPctl(v: number | null | undefined): string {
  const x = f(v)
  return x === null ? DASH : x.toFixed(1)
}

const PCT_INPUTS = new Set([
  'gross_margin',
  'operating_margin',
  'fcf_yield',
  'revenue_cagr',
  'eps_growth',
])
const X_INPUTS = new Set(['pe', 'ps', 'ev_ebitda', 'debt_to_equity', 'net_debt_ebitda'])
const RETURN_INPUTS = new Set(['r3m', 'r6m', 'r12m'])

/** Format a factor-input value with appropriate units (port of fmt_input). */
export function fmtInput(
  key: string,
  v: number | null | undefined,
  roicIsProxy = false,
): string {
  const x = f(v)
  if (x === null) return DASH
  if (PCT_INPUTS.has(key)) return fmtPct(x)
  if (key === 'roic') {
    const base = fmtPct(x)
    return roicIsProxy ? `${base}*` : base
  }
  if (X_INPUTS.has(key)) return fmtX(x)
  if (RETURN_INPUTS.has(key)) {
    const sign = x >= 0 ? '+' : ''
    return `${sign}${(x * 100).toFixed(1)}%`
  }
  return x.toFixed(4)
}

const PCT_METRICS = new Set([
  'gross_margin',
  'operating_margin',
  'revenue_cagr',
  'eps_growth',
  'share_count_trend',
])
const X_METRICS = new Set(['debt_to_equity', 'net_debt_ebitda', 'current_ratio'])

/** Format a fundamental_metrics value with appropriate units (port of fmt_metric). */
export function fmtMetric(
  metric: string,
  v: number | null | undefined,
  roicIsProxy = false,
): string {
  const x = f(v)
  if (x === null) return DASH
  if (metric === 'ttm_revenue' || metric === 'fcf') return fmtMoney(x)
  if (metric === 'ttm_eps') return `$${x.toFixed(2)}`
  if (PCT_METRICS.has(metric)) return fmtPct(x)
  if (metric === 'roic') {
    const base = fmtPct(x)
    return roicIsProxy ? `${base}*` : base
  }
  if (X_METRICS.has(metric)) return fmtX(x, 2)
  return x.toFixed(4)
}

/** "2026-06-10" -> "Jun 10, 2026" (UTC-safe: no timezone shift on date-only strings). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export { DASH }
