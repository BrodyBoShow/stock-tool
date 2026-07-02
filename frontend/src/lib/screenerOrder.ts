/**
 * The screener's visible result order, stored so the deep dive can offer a
 * J/K prev-next pager ("Screener result 12 of 240"). Written whenever the
 * screener renders a sorted result set; read-only on the deep dive. Session-
 * scoped: a direct link (no screener visit this session) shows no pager.
 */
const KEY = 'stockbud.screener.order.v1'
const MAX = 2000

export function setScreenerOrder(tickers: string[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(tickers.slice(0, MAX)))
  } catch {
    /* storage blocked — pager just won't show */
  }
}

export function getScreenerOrder(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

/** Pager info for a ticker, or null when it isn't in the stored set. */
export function pagerFor(
  ticker: string,
): { index: number; total: number; prev: string | null; next: string | null } | null {
  const order = getScreenerOrder()
  const i = order.indexOf(ticker.toUpperCase())
  if (i < 0) return null
  return {
    index: i + 1,
    total: order.length,
    prev: i > 0 ? order[i - 1] : null,
    next: i < order.length - 1 ? order[i + 1] : null,
  }
}
