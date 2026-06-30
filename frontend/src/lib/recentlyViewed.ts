/** Recently-viewed tickers (most-recent first), persisted in localStorage.
 *  Recorded when a deep-dive opens; surfaced as a quick-jump strip on the
 *  screener. */
const KEY = 'stockbud.recentlyViewed'
const MAX = 8

export function getRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string').slice(0, MAX)
  } catch {
    return []
  }
}

export function pushRecent(ticker: string): void {
  const t = ticker.toUpperCase()
  const next = [t, ...getRecent().filter((x) => x !== t)].slice(0, MAX)
  localStorage.setItem(KEY, JSON.stringify(next))
}
