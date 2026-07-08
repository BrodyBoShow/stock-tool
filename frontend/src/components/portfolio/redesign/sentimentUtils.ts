/** Pure sentiment helpers (no JSX) — kept out of the .tsx component file so React
 *  Fast Refresh stays happy (a component file may only export components). */

/** Direction of a value. `neutral` is for data that isn't a gain/loss (counts,
 * neutral metrics) — it never gets a color or an arrow. */
export type Sentiment = 'pos' | 'neg' | 'neutral'

export function sentimentFromNumber(n: number, eps = 1e-9): Sentiment {
  return n > eps ? 'pos' : n < -eps ? 'neg' : 'neutral'
}

export function sentimentColorClass(s: Sentiment): string {
  return s === 'pos' ? 'text-pos' : s === 'neg' ? 'text-neg' : 'text-ink'
}

export const SENTIMENT_GLYPH: Record<Sentiment, string> = { pos: '▲', neg: '▼', neutral: '' }
export const SENTIMENT_WORD: Record<Sentiment, string> = {
  pos: 'positive',
  neg: 'negative',
  neutral: 'neutral',
}
