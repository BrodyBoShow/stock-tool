/** Saved intrinsic-value scenarios: a named set of the user's slider overrides
 *  (`ov`), persisted per ticker in localStorage, plus a compact URL encoding so
 *  a scenario can be shared by link. Only the *overrides* are stored — seeds are
 *  always re-derived live from the backend, so a saved scenario never goes stale
 *  against a number it didn't set. Mirrors the safe-parse pattern in
 *  recentlyViewed.ts / savedViews.ts. */

export interface Scenario {
  id: string
  name: string
  ov: Record<string, number>
}

const KEY = (ticker: string) => `stockbud.scenarios.${ticker.toUpperCase()}`
const MAX = 6

function isOv(x: unknown): x is Record<string, number> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false
  return Object.values(x as Record<string, unknown>).every(
    (v) => typeof v === 'number' && Number.isFinite(v),
  )
}

export function getScenarios(ticker: string): Scenario[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(ticker)) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter(
        (s): s is Scenario =>
          !!s &&
          typeof s === 'object' &&
          typeof (s as Scenario).id === 'string' &&
          typeof (s as Scenario).name === 'string' &&
          isOv((s as Scenario).ov),
      )
      .slice(0, MAX)
  } catch {
    return []
  }
}

export function saveScenario(
  ticker: string,
  name: string,
  ov: Record<string, number>,
): Scenario[] {
  const trimmed = name.trim().slice(0, 40)
  if (!trimmed) return getScenarios(ticker)
  // Replace a same-named scenario; keep the most recent MAX.
  const kept = getScenarios(ticker).filter((s) => s.name !== trimmed)
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const next = [...kept, { id, name: trimmed, ov }].slice(-MAX)
  try {
    localStorage.setItem(KEY(ticker), JSON.stringify(next))
  } catch {
    /* quota or disabled storage — saving is best-effort */
  }
  return next
}

export function deleteScenario(ticker: string, id: string): Scenario[] {
  const next = getScenarios(ticker).filter((s) => s.id !== id)
  try {
    localStorage.setItem(KEY(ticker), JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

/** Compact "key:value,key:value" encoding for the share URL's `iv` param. */
export function ovToString(ov: Record<string, number>): string {
  return Object.entries(ov)
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
}

export function ovFromString(s: string | null): Record<string, number> {
  if (!s) return {}
  const out: Record<string, number> = {}
  for (const pair of s.split(',')) {
    const [k, v] = pair.split(':')
    const n = Number(v)
    if (k && v !== undefined && Number.isFinite(n)) out[k] = n
  }
  return out
}
