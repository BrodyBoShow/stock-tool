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
export function detectRange(bars: VsaBar[]): TradingRange | null {
  const n = bars.length
  if (n < 12) return null
  const w = Math.min(n, 50)
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
