/**
 * Wyckoff / Volume-Spread Analysis (VSA) primitives — Tier 1, objective only.
 *
 * Everything here is a reproducible measurement off daily OHLCV: bar spread
 * (high-low), where the close sits within the bar, and volume relative to its
 * own trailing average. We DO NOT label discretionary Wyckoff events/phases
 * (Spring, UTAD, "Phase C", …) — those are subjective and only clear in
 * hindsight. We flag bars whose volume/spread are objectively extreme, and we
 * draw a trading range only when price is genuinely consolidating.
 *
 * Candles are split-adjusted client-side via the adj_close/close ratio so they
 * line up with the adjusted-close line used in the default Price mode.
 */
import type { PricePoint } from '@/types/api'

export type VsaClass = 'climax' | 'wide' | 'churn' | 'normal'

export interface VsaBar {
  date: string
  o: number
  h: number
  l: number
  c: number
  vol: number | null
  up: boolean
  /** volume / trailing 20-bar volume average (null until enough history). */
  relVol: number | null
  /** spread / trailing 20-bar spread average. */
  spreadRel: number | null
  /** 0 = closed at the low, 1 = closed at the high of the bar. */
  closeLoc: number | null
  cls: VsaClass
}

export interface TradingRange {
  support: number
  resistance: number
}

const VOL_WINDOW = 20
const SPREAD_WINDOW = 20

/** Trailing average of the previous `n` non-null values (excludes current). */
function trailingAvg(vals: (number | null)[], i: number, n: number): number | null {
  const start = Math.max(0, i - n)
  const slice = vals.slice(start, i).filter((v): v is number => v != null)
  if (slice.length < Math.min(5, n)) return null
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

/** Classify a bar from its relative volume + relative spread (objective). */
function classify(relVol: number | null, spreadRel: number | null): VsaClass {
  if (relVol != null && relVol >= 2 && spreadRel != null && spreadRel >= 1.4) {
    return 'climax' // extreme volume on a wide bar — a volume climax
  }
  if (relVol != null && relVol >= 1.5 && spreadRel != null && spreadRel <= 0.8) {
    return 'churn' // heavy volume, little price progress — effort vs no result
  }
  if (spreadRel != null && spreadRel >= 1.6 && (relVol == null || relVol < 2)) {
    return 'wide' // wide spread without a volume climax
  }
  return 'normal'
}

/** Build VSA bars from a price history (ascending by date). */
export function computeVsa(prices: PricePoint[]): VsaBar[] {
  const bars = prices.filter(
    (p) => p.open != null && p.high != null && p.low != null && (p.close != null || p.adj_close != null),
  )
  // Split-adjust the raw OHL by the close→adj_close ratio so candles align
  // with the adjusted line. Close itself becomes adj_close.
  const adj = bars.map((p) => {
    const rawClose = p.close ?? p.adj_close ?? 0
    const factor = p.close && p.close !== 0 && p.adj_close != null ? p.adj_close / p.close : 1
    return {
      date: p.date,
      o: (p.open as number) * factor,
      h: (p.high as number) * factor,
      l: (p.low as number) * factor,
      c: p.adj_close ?? rawClose,
      vol: p.volume,
    }
  })

  const vols = adj.map((b) => b.vol)
  const spreads = adj.map((b) => b.h - b.l)

  return adj.map((b, i) => {
    const spread = b.h - b.l
    const volAvg = trailingAvg(vols, i, VOL_WINDOW)
    const spreadAvg = trailingAvg(spreads, i, SPREAD_WINDOW)
    const relVol = volAvg && volAvg > 0 && b.vol != null ? b.vol / volAvg : null
    const spreadRel = spreadAvg && spreadAvg > 0 ? spread / spreadAvg : null
    const closeLoc = spread > 0 ? (b.c - b.l) / spread : null
    return {
      date: b.date,
      o: b.o,
      h: b.h,
      l: b.l,
      c: b.c,
      vol: b.vol,
      up: b.c >= b.o,
      relVol,
      spreadRel,
      closeLoc,
      cls: classify(relVol, spreadRel),
    }
  })
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round((sortedAsc.length - 1) * p)))
  return sortedAsc[idx]
}

/**
 * Detect a *current* trading range from the trailing portion of the visible
 * bars — but only return one when price is genuinely consolidating. Uses robust
 * percentiles (so a single spike doesn't define the band) and requires most
 * closes to sit inside a reasonably tight band. Returns null otherwise (no
 * false range drawn).
 */
const RANGE_WINDOW = 50

export function detectRange(bars: VsaBar[]): TradingRange | null {
  const n = bars.length
  if (n < 12) return null
  const w = Math.min(n, RANGE_WINDOW)
  const recent = bars.slice(n - w)
  const lows = recent.map((b) => b.l).sort((a, b) => a - b)
  const highs = recent.map((b) => b.h).sort((a, b) => a - b)
  const support = percentile(lows, 0.15)
  const resistance = percentile(highs, 0.85)
  if (!(support > 0) || !(resistance > support)) return null
  const width = resistance / support - 1
  const inside = recent.filter((b) => b.c >= support && b.c <= resistance).length / w
  if (width > 0.25 || inside < 0.65) return null
  return { support, resistance }
}

export const VSA_LABEL: Record<Exclude<VsaClass, 'normal'>, string> = {
  climax: 'Climax volume',
  wide: 'Wide spread',
  churn: 'Churn / no-demand',
}

/* ── Tier 2: candidate Wyckoff events (heuristic, NOT confirmed) ───────────────
 *
 * These are CANDIDATE annotations, not assertions. We only emit them inside a
 * detected trading range (the only context where these events are meaningful),
 * and each rule is an objective, reproducible test against that range's support
 * (S) / resistance (R) — e.g. a "spring" is literally "a bar whose low pierced
 * S but whose close came back above S". We deliberately do NOT label discre-
 * tionary phases (A–E) or infer intent. The UI frames every marker as a
 * candidate. Client-side, no model impact, no cost. */

export type WyckoffEventType = 'spring' | 'upthrust' | 'sc' | 'bc' | 'sos' | 'sow'

export interface WyckoffEvent {
  idx: number
  date: string
  type: WyckoffEventType
  /** true = bullish-leaning (at support), false = bearish-leaning (at resistance). */
  bullish: boolean
  label: string
  note: string
}

export const WYCKOFF_EVENT_META: Record<
  WyckoffEventType,
  { label: string; bullish: boolean; note: string }
> = {
  spring: {
    label: 'Spring',
    bullish: true,
    note: 'Low pierced support but the close recovered back above it — a possible false breakdown (shakeout).',
  },
  sc: {
    label: 'Sell climax',
    bullish: true,
    note: 'Climax-volume down bar at the low of the range — possible selling exhaustion.',
  },
  sos: {
    label: 'Strength',
    bullish: true,
    note: 'Wide, strong-close up bar that closed above resistance on heavy volume — a possible sign of strength.',
  },
  upthrust: {
    label: 'Upthrust',
    bullish: false,
    note: 'High pierced resistance but the close fell back below it — a possible false breakout.',
  },
  bc: {
    label: 'Buy climax',
    bullish: false,
    note: 'Climax-volume up bar at the high of the range — possible buying exhaustion.',
  },
  sow: {
    label: 'Weakness',
    bullish: false,
    note: 'Wide, weak-close down bar that closed below support on heavy volume — a possible sign of weakness.',
  },
}

/**
 * Detect candidate events within a trading range. Returns [] when there is no
 * range (we don't annotate trending/choppy charts — events there are noise).
 * One event per bar at most, conservative thresholds.
 */
const EVENT_COOLDOWN = 5 // bars — collapse clusters of the same event type

export function detectEvents(bars: VsaBar[], range: TradingRange | null): WyckoffEvent[] {
  if (!range) return []
  const { support: S, resistance: R } = range
  const out: WyckoffEvent[] = []
  const lastIdxByType = new Map<WyckoffEventType, number>()
  // The range is built from the trailing RANGE_WINDOW bars, so only annotate
  // bars in that same window — applying the *current* S/R to price from months
  // ago (when the stock traded elsewhere) would manufacture false signals.
  const start = Math.max(0, bars.length - RANGE_WINDOW)
  bars.forEach((b, idx) => {
    if (idx < start) return
    let type: WyckoffEventType | null = null
    if (b.l < S && b.c >= S) {
      type = 'spring' // pierced support, closed back inside
    } else if (b.h > R && b.c <= R) {
      type = 'upthrust' // pierced resistance, closed back inside
    } else if (b.c < S && !b.up && (b.cls === 'wide' || b.cls === 'climax') && (b.closeLoc ?? 1) < 0.4) {
      type = 'sow' // strong-close breakdown below support
    } else if (b.c > R && b.up && (b.cls === 'wide' || b.cls === 'climax') && (b.closeLoc ?? 0) > 0.6) {
      type = 'sos' // strong-close breakout above resistance
    } else if (b.cls === 'climax' && !b.up && b.l <= S * 1.02) {
      type = 'sc' // selling climax at the low
    } else if (b.cls === 'climax' && b.up && b.h >= R * 0.98) {
      type = 'bc' // buying climax at the high
    }
    if (!type) return
    // Collapse a run of the same event into its first bar so a sustained move
    // doesn't stamp the chart with a dozen identical labels.
    const prev = lastIdxByType.get(type)
    if (prev != null && idx - prev < EVENT_COOLDOWN) {
      lastIdxByType.set(type, idx)
      return
    }
    lastIdxByType.set(type, idx)
    const m = WYCKOFF_EVENT_META[type]
    out.push({ idx, date: b.date, type, bullish: m.bullish, label: m.label, note: m.note })
  })
  return out
}
