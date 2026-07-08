// Per-name "snooze" for the watchlist's what's-changed layer — a client-side,
// per-device mute so a name you've acknowledged stops nagging for a while. Kept
// in localStorage (ticker → expiry epoch ms); expired entries self-prune on read.
// Intentionally NOT server-side: it's a personal, ephemeral "I've seen this"
// gesture, not shared state.

const KEY = 'stockbud.watchlist.snoozes.v1'

type SnoozeMap = Record<string, number> // ticker → expiry epoch ms

function read(): SnoozeMap {
  try {
    const raw = localStorage.getItem(KEY)
    const map = raw ? (JSON.parse(raw) as SnoozeMap) : {}
    const now = Date.now()
    let changed = false
    for (const k of Object.keys(map)) {
      if (map[k] < now) {
        delete map[k]
        changed = true
      }
    }
    if (changed) localStorage.setItem(KEY, JSON.stringify(map))
    return map
  } catch {
    return {}
  }
}

/** Expiry epoch ms for a ticker's active snooze, or null if not snoozed. */
export function snoozedUntil(ticker: string): number | null {
  return read()[ticker] ?? null
}

/** Snooze a ticker for `days` (or unsnooze when days <= 0). */
export function snoozeTicker(ticker: string, days: number): void {
  const map = read()
  if (days <= 0) delete map[ticker]
  else map[ticker] = Date.now() + days * 86_400_000
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* storage full/blocked — snooze just won't persist */
  }
}
