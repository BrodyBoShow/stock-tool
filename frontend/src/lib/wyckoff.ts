/**
 * Wyckoff / Volume-Spread Analysis engine — professional, context-aware, and
 * honest about its limits.
 *
 * Pipeline (all client-side off free daily OHLCV — never touches the factor
 * model, no network, no cost):
 *
 *   computeVsa()       objective per-bar measures (spread, close location,
 *                      volume vs trailing average) → climax/wide/churn flags
 *   detectRange()      the current trading range (longest recent consolidation
 *                      that stays tight and contains most closes)
 *   classifyContext()  is the range ACCUMULATION (bottom, after markdown) or
 *                      DISTRIBUTION (top, after markup)? — from the trend INTO
 *                      the range + where the box sits in the ~52-week range.
 *                      This is the fix for "a spring shouldn't fire at the top".
 *   detectEvents()     the proper Wyckoff schematic, GATED by context:
 *                      accumulation → SC/AR/ST/Spring/Test/SOS/LPS
 *                      distribution → BC/UT/UTAD/SOW/LPSY
 *                      Each event carries a confidence and a phase tag.
 *   derivePhases()     phases A–E inferred from the detected event sequence.
 *   projectTarget()    Wyckoff range-height objective (cause→effect), labelled
 *                      a method estimate, not a forecast.
 *
 * Everything named (events, phases, target, context) is an INTERPRETATION on
 * daily data and is surfaced with explicit confidence and "not a forecast"
 * framing. The objective layer (VSA flags + the box) stands on its own.
 */
import type { PricePoint } from '@/types/api'

/* ── objective VSA layer ──────────────────────────────────────────────────── */

export type VsaClass = 'climax' | 'wide' | 'churn' | 'normal'

export interface VsaBar {
  date: string
  o: number
  h: number
  l: number
  c: number
  vol: number | null
  up: boolean
  relVol: number | null
  spreadRel: number | null
  closeLoc: number | null
  cls: VsaClass
}

const VOL_WINDOW = 20
const SPREAD_WINDOW = 20

function trailingAvg(vals: (number | null)[], i: number, n: number): number | null {
  const start = Math.max(0, i - n)
  const slice = vals.slice(start, i).filter((v): v is number => v != null)
  if (slice.length < Math.min(5, n)) return null
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

function classify(relVol: number | null, spreadRel: number | null): VsaClass {
  if (relVol != null && relVol >= 2 && spreadRel != null && spreadRel >= 1.4) return 'climax'
  if (relVol != null && relVol >= 1.5 && spreadRel != null && spreadRel <= 0.8) return 'churn'
  if (spreadRel != null && spreadRel >= 1.6 && (relVol == null || relVol < 2)) return 'wide'
  return 'normal'
}

export function computeVsa(prices: PricePoint[]): VsaBar[] {
  const bars = prices.filter(
    (p) => p.open != null && p.high != null && p.low != null && (p.close != null || p.adj_close != null),
  )
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

/* ── trading range ────────────────────────────────────────────────────────── */

export interface TradingRange {
  support: number
  resistance: number
  startIdx: number
  endIdx: number
}

/** Diagnostics for the range test — valid + why-not, for honest UI messaging. */
export interface RangeQuality {
  valid: boolean
  windowBars: number
  support: number
  resistance: number
  resistanceFlat: boolean
  supportFlat: boolean
  crossings: number
  containment: number
  startIdx: number
  endIdx: number
  failReasons: string[]
}

// A Wyckoff range is a HORIZONTAL channel — flat ceiling, flat floor, price
// oscillating between them, most closes contained. Testing those directly
// (rather than just "is the band narrow") rejects a slow drift masquerading as
// a base. Try several window lengths; the shortest valid one is the most
// recently formed range. (Approach adapted from GoldenPanda's range detector.)
const RANGE_WINDOWS = [40, 60, 80, 100, 130]
const MIN_RANGE_LEN = 20
// A wall may drift up to this share of the channel height across the window's
// thirds and still count as "flat". Recalibrated 0.25 → 0.40: at 0.25 only ~10%
// of stocks ever registered a range (measured over an 80-name sample), so the
// schematic read as permanently empty ("no trading range" on essentially every
// stock). 0.40 admits ~38% — a realistic range-vs-trend split — while the
// crossings + containment gates below still reject genuine trends and diagonal
// staircases (those fail on too-few midline crossings, not on wall flatness).
const BOUNDARY_FLAT_TOL = 0.4
const MIN_CROSSINGS = 3 // midline crossings → real oscillation, not drift
const MIN_CONTAINMENT = 0.8 // share of closes inside the channel

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round((sortedAsc.length - 1) * p)))
  return sortedAsc[idx]
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

function assessWindow(bars: VsaBar[], startIdx: number, endIdx: number): RangeQuality {
  const seg = bars.slice(startIdx, endIdx + 1)
  const windowBars = seg.length
  const support = percentile(seg.map((b) => b.l).sort((a, b) => a - b), 0.05)
  const resistance = percentile(seg.map((b) => b.h).sort((a, b) => a - b), 0.95)
  const height = resistance - support
  const base: RangeQuality = {
    valid: false, windowBars, support, resistance, resistanceFlat: false,
    supportFlat: false, crossings: 0, containment: 0, startIdx, endIdx, failReasons: [],
  }
  if (!(height > 0) || !(support > 0)) {
    return { ...base, failReasons: ['No measurable range.'] }
  }
  // 1. Flat ceiling AND flat floor across thirds of the window.
  const third = Math.floor(windowBars / 3)
  const hi: number[] = []
  const lo: number[] = []
  for (let i = 0; i < 3; i++) {
    const part = seg.slice(i * third, i === 2 ? windowBars : (i + 1) * third)
    hi.push(percentile(part.map((b) => b.h).sort((a, b) => a - b), 0.95))
    lo.push(percentile(part.map((b) => b.l).sort((a, b) => a - b), 0.05))
  }
  const resistanceFlat = (Math.max(...hi) - Math.min(...hi)) / height <= BOUNDARY_FLAT_TOL
  const supportFlat = (Math.max(...lo) - Math.min(...lo)) / height <= BOUNDARY_FLAT_TOL
  // 2. Oscillation: midline crossings.
  const mid = (support + resistance) / 2
  let crossings = 0
  for (let i = 1; i < seg.length; i++) {
    const a = seg[i - 1].c - mid
    const b = seg[i].c - mid
    if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) crossings++
  }
  // 3. Containment.
  const containment = seg.filter((b) => b.c >= support && b.c <= resistance).length / windowBars
  const fail: string[] = []
  if (!resistanceFlat) fail.push('Ceiling is not holding level — price is stepping up or down at the top.')
  if (!supportFlat) fail.push('Floor is not holding level — support keeps shifting.')
  if (crossings < MIN_CROSSINGS) fail.push('Price has not oscillated between the walls enough to be a real range.')
  if (containment < MIN_CONTAINMENT) fail.push('Too many closes finishing outside the channel.')
  const valid = resistanceFlat && supportFlat && crossings >= MIN_CROSSINGS && containment >= MIN_CONTAINMENT
  return {
    valid, windowBars, support, resistance, resistanceFlat, supportFlat,
    crossings, containment, startIdx, endIdx, failReasons: valid ? [] : fail,
  }
}

/**
 * Assess the current trading range across several recent windows; the shortest
 * VALID one wins (most recently formed base). If none qualifies, returns the
 * longest window's diagnostics so the UI can say *why* it isn't a range.
 */
export function assessRange(bars: VsaBar[]): RangeQuality {
  const n = bars.length
  if (n < MIN_RANGE_LEN) {
    return {
      valid: false, windowBars: n, support: 0, resistance: 0, resistanceFlat: false,
      supportFlat: false, crossings: 0, containment: 0, startIdx: 0, endIdx: n - 1,
      failReasons: ['Not enough price history to assess a range.'],
    }
  }
  let last: RangeQuality | null = null
  for (const w of RANGE_WINDOWS) {
    if (n < w) continue
    const q = assessWindow(bars, n - w, n - 1)
    if (q.valid) return q
    last = q
  }
  return last ?? assessWindow(bars, Math.max(0, n - RANGE_WINDOWS[0]), n - 1)
}

/** Back-compat wrapper: the TradingRange or null. */
export function detectRange(bars: VsaBar[]): TradingRange | null {
  const q = assessRange(bars)
  return q.valid
    ? { support: q.support, resistance: q.resistance, startIdx: q.startIdx, endIdx: q.endIdx }
    : null
}

/* ── context: accumulation vs distribution ────────────────────────────────── */

export type WyckoffContextKind = 'accumulation' | 'distribution' | 'undetermined'

export interface WyckoffContext {
  kind: WyckoffContextKind
  /** -1 = clear distribution … +1 = clear accumulation. */
  bias: number
  /** 0..1 — how confident the accumulation/distribution call is. */
  confidence: number
  /** return of price over the bars leading INTO the range. */
  priorTrend: number
  /** 0 = box at the bottom of the ~52-wk range, 1 = at the top. */
  posInRange: number
  note: string | null
}

const TREND_LOOKBACK = 60
const POSITION_LOOKBACK = 250

export function classifyContext(bars: VsaBar[], range: TradingRange): WyckoffContext {
  const { startIdx, endIdx, support, resistance } = range
  const boxMid = (support + resistance) / 2

  // Trend INTO the range: return over the run-up/run-down before it began.
  const L = Math.min(startIdx, TREND_LOOKBACK)
  const priorTrend =
    L >= 10 && bars[startIdx - L].c > 0 ? bars[startIdx].c / bars[startIdx - L].c - 1 : 0

  // Where the box sits within the longer range it lives in.
  const look = bars.slice(Math.max(0, endIdx - POSITION_LOOKBACK), endIdx + 1)
  const lo = Math.min(...look.map((b) => b.l))
  const hi = Math.max(...look.map((b) => b.h))
  const posInRange = hi > lo ? (boxMid - lo) / (hi - lo) : 0.5

  // Two signals, each in [-1, +1] where + leans accumulation.
  const trendSig = clamp(-priorTrend / 0.25, -1, 1) // a downtrend into the box → accumulation
  const posSig = clamp((0.5 - posInRange) / 0.3, -1, 1) // low in the range → accumulation
  const agree = Math.sign(trendSig) === Math.sign(posSig) && trendSig !== 0
  const bias = clamp((trendSig + posSig) / 2, -1, 1)
  const confidence = clamp(Math.abs(bias) * (agree ? 1.25 : 0.7), 0, 1)

  let kind: WyckoffContextKind = 'undetermined'
  if (bias >= 0.35) kind = 'accumulation'
  else if (bias <= -0.35) kind = 'distribution'

  let note: string | null
  if (kind === 'distribution' && priorTrend < 0) {
    note = 'Could be re-distribution (a pause in a downtrend) — confirmed only on the breakout direction.'
  } else if (kind === 'accumulation' && priorTrend > 0) {
    note = 'Could be re-accumulation (a pause in an uptrend) rather than a bottom.'
  } else if (kind === 'distribution') {
    note = 'Distribution context — Springs are suppressed; watch upthrusts and supply.'
  } else if (kind === 'accumulation') {
    note = 'Accumulation context — Upthrusts are suppressed; watch springs and demand.'
  } else {
    note = 'Range context unclear — showing objective volume/spread only, no schematic labels.'
  }

  return { kind, bias, confidence, priorTrend, posInRange, note }
}

/* ── Wyckoff events (context-gated schematic) ─────────────────────────────── */

export type WyckoffEventType =
  | 'SC' | 'AR' | 'ST' | 'spring' | 'test' | 'SOS' | 'LPS' // accumulation
  | 'BC' | 'ARd' | 'STd' | 'UT' | 'UTAD' | 'SOW' | 'LPSY' // distribution

export type WyckoffPhaseId = 'A' | 'B' | 'C' | 'D' | 'E'

export interface WyckoffEvent {
  idx: number
  date: string
  type: WyckoffEventType
  phase: WyckoffPhaseId
  bullish: boolean
  /** 0..1 — how cleanly this bar matches the textbook event. */
  confidence: number
  label: string
  note: string
}

export const WYCKOFF_EVENT_META: Record<
  WyckoffEventType,
  { label: string; bullish: boolean; note: string }
> = {
  SC: { label: 'SC', bullish: true, note: 'Selling climax — heavy-volume, wide down bar at the low; possible selling exhaustion that sets the range floor.' },
  AR: { label: 'AR', bullish: true, note: 'Automatic rally — the bounce off the selling climax that sets the range ceiling.' },
  ST: { label: 'ST', bullish: true, note: 'Secondary test — a revisit of the lows on lighter volume, testing for remaining supply.' },
  spring: { label: 'Spring', bullish: true, note: 'Spring / shakeout — price dipped below support and closed back inside; best when volume is light (no supply).' },
  test: { label: 'Test', bullish: true, note: 'Test of the spring — a low-volume revisit holding above the spring low.' },
  SOS: { label: 'SOS', bullish: true, note: 'Sign of strength — a wide, strong-close up bar pushing above resistance on rising volume.' },
  LPS: { label: 'LPS', bullish: true, note: 'Last point of support — a higher low holding above the broken resistance after a sign of strength.' },
  BC: { label: 'BC', bullish: false, note: 'Buying climax — heavy-volume, wide up bar at the high; possible buying exhaustion that sets the range ceiling.' },
  ARd: { label: 'AR', bullish: false, note: 'Automatic reaction — the drop off the buying climax that sets the range floor.' },
  STd: { label: 'ST', bullish: false, note: 'Secondary test — a revisit of the highs on lighter volume, testing for remaining demand.' },
  UT: { label: 'UT', bullish: false, note: 'Upthrust — price poked above resistance and closed back inside; supply absorbing the breakout.' },
  UTAD: { label: 'UTAD', bullish: false, note: 'Upthrust after distribution — a late false breakout above resistance, often the last high before markdown.' },
  SOW: { label: 'SOW', bullish: false, note: 'Sign of weakness — a wide, weak-close down bar breaking below support on rising volume.' },
  LPSY: { label: 'LPSY', bullish: false, note: 'Last point of supply — a lower high failing below the broken support after a sign of weakness.' },
}

function pushEvent(
  out: WyckoffEvent[],
  bars: VsaBar[],
  idx: number,
  type: WyckoffEventType,
  phase: WyckoffPhaseId,
  confidence: number,
) {
  const m = WYCKOFF_EVENT_META[type]
  out.push({
    idx,
    date: bars[idx].date,
    type,
    phase,
    bullish: m.bullish,
    confidence: clamp(confidence, 0, 1),
    label: m.label,
    note: m.note,
  })
}

/**
 * Detect the Wyckoff schematic appropriate to the context. Accumulation and
 * distribution are mirror images; undetermined context yields no events.
 */
export function detectEvents(
  bars: VsaBar[],
  range: TradingRange,
  context: WyckoffContext,
): WyckoffEvent[] {
  if (context.kind === 'undetermined') return []
  const { startIdx, endIdx, support, resistance } = range
  const len = endIdx - startIdx + 1
  if (len < MIN_RANGE_LEN) return []
  const earlyEnd = startIdx + Math.floor(len * 0.4) // Phase A window
  const lateStart = startIdx + Math.floor(len * 0.5) // Phase C/D window
  const out: WyckoffEvent[] = []
  const span = resistance - support

  if (context.kind === 'accumulation') {
    // SC — strongest-volume wide down bar near the floor, early.
    let sc = -1
    let scVol = 0
    for (let i = startIdx; i <= earlyEnd; i++) {
      const b = bars[i]
      if (!b.up && b.l <= support * 1.04 && (b.relVol ?? 0) > scVol && (b.relVol ?? 0) >= 1.3) {
        scVol = b.relVol ?? 0
        sc = i
      }
    }
    if (sc >= 0) pushEvent(out, bars, sc, 'SC', 'A', Math.min(1, scVol / 3))

    // AR — highest high after SC within the first ~60%.
    if (sc >= 0) {
      let ar = -1
      let arHi = -Infinity
      for (let i = sc + 1; i <= startIdx + Math.floor(len * 0.6); i++) {
        if (bars[i] && bars[i].h > arHi) {
          arHi = bars[i].h
          ar = i
        }
      }
      if (ar >= 0) pushEvent(out, bars, ar, 'AR', 'A', 0.55)
    }

    // ST — revisit of the floor on lighter volume than SC.
    let stCount = 0
    for (let i = (sc >= 0 ? sc + 2 : startIdx); i <= endIdx && stCount < 2; i++) {
      const b = bars[i]
      if (b.l <= support * 1.05 && !b.up && (b.relVol ?? 99) < scVol * 0.85) {
        pushEvent(out, bars, i, 'ST', i < lateStart ? 'B' : 'D', 0.5)
        stCount++
        i += 4
      }
    }

    // Spring — pierce of support with a close back inside, in Phase C. Low
    // volume on the pierce is the high-conviction case.
    let springIdx = -1
    for (let i = lateStart; i <= endIdx; i++) {
      const b = bars[i]
      if (b.l < support && b.c >= support) {
        const lowVol = (b.relVol ?? 1) <= 1.3
        pushEvent(out, bars, i, 'spring', 'C', lowVol ? 0.75 : 0.45)
        springIdx = i
        break
      }
    }
    // Test — low-volume hold after the spring.
    if (springIdx >= 0) {
      for (let i = springIdx + 1; i <= Math.min(endIdx, springIdx + 8); i++) {
        const b = bars[i]
        if (b.l >= bars[springIdx].l && b.l <= support * 1.03 && (b.relVol ?? 1) < 1) {
          pushEvent(out, bars, i, 'test', 'C', 0.5)
          break
        }
      }
    }

    // SOS — strong-close breakout above resistance, late.
    for (let i = lateStart; i <= endIdx; i++) {
      const b = bars[i]
      if (b.up && b.c > resistance && (b.cls === 'wide' || b.cls === 'climax') && (b.closeLoc ?? 0) > 0.55) {
        pushEvent(out, bars, i, 'SOS', 'D', Math.min(1, (b.relVol ?? 1) / 2.2))
        // LPS — first higher-low pullback holding above the broken resistance.
        for (let j = i + 1; j <= Math.min(endIdx, i + 8); j++) {
          if (!bars[j].up && bars[j].l >= resistance * 0.98) {
            pushEvent(out, bars, j, 'LPS', 'D', 0.5)
            break
          }
        }
        break
      }
    }
  } else {
    // ── distribution (mirror of accumulation) ──
    let bc = -1
    let bcVol = 0
    for (let i = startIdx; i <= earlyEnd; i++) {
      const b = bars[i]
      if (b.up && b.h >= resistance * 0.96 && (b.relVol ?? 0) > bcVol && (b.relVol ?? 0) >= 1.3) {
        bcVol = b.relVol ?? 0
        bc = i
      }
    }
    if (bc >= 0) pushEvent(out, bars, bc, 'BC', 'A', Math.min(1, bcVol / 3))

    if (bc >= 0) {
      let ar = -1
      let arLo = Infinity
      for (let i = bc + 1; i <= startIdx + Math.floor(len * 0.6); i++) {
        if (bars[i] && bars[i].l < arLo) {
          arLo = bars[i].l
          ar = i
        }
      }
      if (ar >= 0) pushEvent(out, bars, ar, 'ARd', 'A', 0.55)
    }

    let stCount = 0
    for (let i = (bc >= 0 ? bc + 2 : startIdx); i <= endIdx && stCount < 2; i++) {
      const b = bars[i]
      if (b.h >= resistance * 0.95 && b.up && (b.relVol ?? 99) < bcVol * 0.85) {
        pushEvent(out, bars, i, 'STd', i < lateStart ? 'B' : 'D', 0.5)
        stCount++
        i += 4
      }
    }

    // UT (mid-range) and UTAD (Phase C) — both pokes above resistance closing
    // back inside; the later one is the UTAD.
    let utCount = 0
    let lastUT = -1
    for (let i = startIdx + 3; i <= endIdx; i++) {
      const b = bars[i]
      if (b.h > resistance && b.c <= resistance) {
        const isLate = i >= lateStart
        if (isLate) {
          pushEvent(out, bars, i, 'UTAD', 'C', (b.relVol ?? 1) >= 1.3 ? 0.7 : 0.5)
          lastUT = i
          break
        } else if (utCount < 2) {
          pushEvent(out, bars, i, 'UT', 'B', 0.5)
          utCount++
          lastUT = i
          i += 4
        }
      }
    }

    // SOW — strong-close breakdown below support, late.
    for (let i = Math.max(lateStart, lastUT + 1); i <= endIdx; i++) {
      const b = bars[i]
      if (!b.up && b.c < support && (b.cls === 'wide' || b.cls === 'climax') && (b.closeLoc ?? 1) < 0.45) {
        pushEvent(out, bars, i, 'SOW', 'D', Math.min(1, (b.relVol ?? 1) / 2.2))
        for (let j = i + 1; j <= Math.min(endIdx, i + 8); j++) {
          if (bars[j].up && bars[j].h <= support * 1.02) {
            pushEvent(out, bars, j, 'LPSY', 'D', 0.5)
            break
          }
        }
        break
      }
    }
  }

  void span
  return out.sort((a, b) => a.idx - b.idx)
}

/* ── phases ───────────────────────────────────────────────────────────────── */

export interface WyckoffPhase {
  id: WyckoffPhaseId
  startIdx: number
  endIdx: number
}

/**
 * Infer phase boundaries from the detected event sequence. Best-effort: we only
 * draw the phases we can anchor to real events, so a sparse schematic yields
 * fewer bands rather than guesses.
 */
export function derivePhases(
  bars: VsaBar[],
  range: TradingRange,
  context: WyckoffContext,
  events: WyckoffEvent[],
): WyckoffPhase[] {
  if (context.kind === 'undetermined' || events.length === 0) return []
  const { startIdx, endIdx, support, resistance } = range
  const idxOf = (types: WyckoffEventType[]) => {
    const e = events.find((x) => types.includes(x.type))
    return e ? e.idx : -1
  }
  const stop = idxOf(context.kind === 'accumulation' ? ['AR'] : ['ARd'])
  const cIdx = idxOf(context.kind === 'accumulation' ? ['spring', 'test'] : ['UTAD'])
  const dIdx = idxOf(context.kind === 'accumulation' ? ['SOS', 'LPS'] : ['SOW', 'LPSY'])

  const phases: WyckoffPhase[] = []
  const aEnd = stop > 0 ? stop : startIdx + Math.floor((endIdx - startIdx) * 0.25)
  phases.push({ id: 'A', startIdx, endIdx: aEnd })

  const bEnd = cIdx > 0 ? cIdx - 1 : dIdx > 0 ? dIdx - 1 : Math.floor((aEnd + endIdx) / 2)
  if (bEnd > aEnd) phases.push({ id: 'B', startIdx: aEnd + 1, endIdx: bEnd })

  if (cIdx > 0) {
    const cEnd = dIdx > cIdx ? dIdx - 1 : Math.min(endIdx, cIdx + 4)
    phases.push({ id: 'C', startIdx: cIdx, endIdx: cEnd })
  }

  const dStart = (phases[phases.length - 1]?.endIdx ?? bEnd) + 1
  // Phase E only if price has actually left the box at the end.
  const last = bars[endIdx]
  const brokeOut =
    context.kind === 'accumulation' ? last.c > resistance : last.c < support
  if (dStart <= endIdx) {
    phases.push({ id: 'D', startIdx: dStart, endIdx: brokeOut && dIdx > 0 ? Math.max(dIdx, dStart) : endIdx })
  }
  if (brokeOut) {
    const eStart = (phases[phases.length - 1]?.endIdx ?? dStart) + 1
    if (eStart <= endIdx) phases.push({ id: 'E', startIdx: eStart, endIdx })
  }
  return phases.filter((p) => p.endIdx >= p.startIdx)
}

/* ── cause → effect target (range-height objective) ───────────────────────── */

export interface WyckoffTarget {
  price: number
  direction: 'up' | 'down'
  basis: string
}

export function projectTarget(range: TradingRange, context: WyckoffContext): WyckoffTarget | null {
  if (context.kind === 'undetermined') return null
  const height = range.resistance - range.support
  if (context.kind === 'accumulation') {
    return { price: range.resistance + height, direction: 'up', basis: 'Range-height objective above resistance' }
  }
  return { price: Math.max(0, range.support - height), direction: 'down', basis: 'Range-height objective below support' }
}

/* ── top-level analysis ───────────────────────────────────────────────────── */

export interface WyckoffAnalysis {
  bars: VsaBar[]
  range: TradingRange | null
  rangeQuality: RangeQuality
  context: WyckoffContext | null
  events: WyckoffEvent[]
  phases: WyckoffPhase[]
  target: WyckoffTarget | null
  summary: string
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

function buildSummary(
  context: WyckoffContext | null,
  events: WyckoffEvent[],
  target: WyckoffTarget | null,
  rangeQuality: RangeQuality,
): string {
  if (!context) {
    const why = rangeQuality.failReasons[0]
    return `No valid trading range — price is trending or choppy, so no Wyckoff schematic is shown.${why ? ` (${why})` : ''}`
  }
  if (context.kind === 'undetermined') {
    return 'A range is present but its accumulation/distribution character is unclear, so only objective volume/spread is shown.'
  }
  const seen = new Set(events.map((e) => e.label))
  const names = [...seen].slice(0, 4).join(', ')
  const head =
    context.kind === 'accumulation'
      ? `Accumulation range (${pct(context.confidence)} confidence).`
      : `Distribution range (${pct(context.confidence)} confidence).`
  const evPart = names ? ` Detected: ${names}.` : ' No textbook events confirmed yet.'
  const tgtPart = target
    ? ` Range-height objective ≈ $${target.price.toFixed(2)} ${target.direction === 'up' ? 'above' : 'below'} the range on a confirmed break.`
    : ''
  return `${head}${evPart}${tgtPart} Interpretation on daily data — not a forecast.`
}

export function analyzeWyckoff(prices: PricePoint[]): WyckoffAnalysis {
  const bars = computeVsa(prices)
  const rangeQuality = assessRange(bars)
  const range: TradingRange | null = rangeQuality.valid
    ? {
        support: rangeQuality.support,
        resistance: rangeQuality.resistance,
        startIdx: rangeQuality.startIdx,
        endIdx: rangeQuality.endIdx,
      }
    : null
  const context = range ? classifyContext(bars, range) : null
  const events = range && context ? detectEvents(bars, range, context) : []
  const phases = range && context ? derivePhases(bars, range, context, events) : []
  const target =
    range && context && context.confidence >= 0.4 ? projectTarget(range, context) : null
  return {
    bars,
    range,
    rangeQuality,
    context,
    events,
    phases,
    target,
    summary: buildSummary(context, events, target, rangeQuality),
  }
}

/* ── walk-forward signal grader (no look-ahead) ───────────────────────────────
 *
 * The honest "do these signals actually work" test, adapted from GoldenPanda's
 * walk-forward backtest. For each bar i, we re-run the WHOLE analysis on
 * prices[0..i] ONLY — so a signal that fires on day i was computed without ever
 * seeing a later bar — then grade it on the bars strictly after i. Scoring and
 * grading never overlap, so the result can't borrow from the future. Runs
 * client-side on the already-fetched series, on demand. Small-sample, one ticker
 * — context, not proof. */

export type GradeDir = 'up' | 'down'

export interface GradedSignal {
  idx: number
  date: string
  type: WyckoffEventType
  label: string
  dir: GradeDir
  entry: number
  fwdReturn: number
  fwdHit: boolean
  targetBeforeStop: boolean | null
}

export interface SignalStat {
  signals: number
  fwdHits: number
  fwdRate: number
  avgFwdReturn: number
  tbsResolved: number
  tbsHits: number
  tbsRate: number
}

export interface WyckoffBacktest {
  warmup: number
  forwardDays: number
  threshold: number
  overall: SignalStat
  byType: Record<string, SignalStat>
  graded: GradedSignal[]
}

// Events worth grading as directional signals (the "decision" bars).
const GRADED_TYPES: WyckoffEventType[] = ['spring', 'SOS', 'SC', 'UTAD', 'SOW', 'BC']

function summariseSignals(graded: GradedSignal[]): SignalStat {
  const n = graded.length
  const fwdHits = graded.filter((g) => g.fwdHit).length
  const resolved = graded.filter((g) => g.targetBeforeStop !== null)
  const tbsHits = resolved.filter((g) => g.targetBeforeStop === true).length
  const avg = n ? graded.reduce((s, g) => s + g.fwdReturn, 0) / n : 0
  return {
    signals: n,
    fwdHits,
    fwdRate: n ? fwdHits / n : 0,
    avgFwdReturn: avg,
    tbsResolved: resolved.length,
    tbsHits,
    tbsRate: resolved.length ? tbsHits / resolved.length : 0,
  }
}

export function walkForwardGrade(
  prices: PricePoint[],
  opts?: { warmup?: number; forwardDays?: number; threshold?: number; stopFraction?: number },
): WyckoffBacktest {
  const warmup = opts?.warmup ?? 70
  const forwardDays = opts?.forwardDays ?? 21
  const threshold = opts?.threshold ?? 0.04
  const stopFraction = opts?.stopFraction ?? 0.5
  const fullBars = computeVsa(prices)
  const n = fullBars.length
  const graded: GradedSignal[] = []

  for (let i = warmup; i < n - 1; i++) {
    const a = analyzeWyckoff(prices.slice(0, i + 1)) // point-in-time: past only
    if (!a.range) continue
    const fired = a.events.filter((e) => e.idx === i && GRADED_TYPES.includes(e.type))
    if (fired.length === 0) continue
    const future = fullBars.slice(i + 1, i + 1 + forwardDays)
    if (future.length === 0) continue
    const entry = fullBars[i].c
    const { support: S, resistance: R } = a.range
    const height = R - S

    for (const e of fired) {
      const dir: GradeDir = e.bullish ? 'up' : 'down'
      const exit = future[future.length - 1].c
      const fwdReturn = entry > 0 ? exit / entry - 1 : 0
      const fwdHit = dir === 'up' ? fwdReturn >= threshold : fwdReturn <= -threshold

      const target = dir === 'up' ? R + height : Math.max(0, S - height)
      const stop = dir === 'up' ? S - stopFraction * height : R + stopFraction * height
      let tbs: boolean | null = null
      for (const b of future) {
        const hitTarget = dir === 'up' ? b.h >= target : b.l <= target
        const hitStop = dir === 'up' ? b.l <= stop : b.h >= stop
        if (hitTarget && hitStop) { tbs = false; break } // ambiguous intrabar → stop (conservative)
        if (hitTarget) { tbs = true; break }
        if (hitStop) { tbs = false; break }
      }
      graded.push({
        idx: i, date: fullBars[i].date, type: e.type, label: e.label, dir,
        entry, fwdReturn, fwdHit, targetBeforeStop: tbs,
      })
    }
  }

  const byType: Record<string, SignalStat> = {}
  for (const t of GRADED_TYPES) {
    const g = graded.filter((x) => x.type === t)
    if (g.length) byType[t] = summariseSignals(g)
  }
  return { warmup, forwardDays, threshold, overall: summariseSignals(graded), byType, graded }
}

/* ── evidence-row narration (explain, don't predict) ──────────────────────────
 * Term → plain meaning → the actual number. Adapted from GoldenPanda's narration
 * pattern. Pure presentation off the analysis — no AI, no cost. */

export interface EvidenceRow {
  term: string
  meaning: string
  value: string
}

export interface WyckoffNarration {
  rows: EvidenceRow[]
  caveat: string
  watch: string
}

export function buildEvidence(a: WyckoffAnalysis): WyckoffNarration {
  const rows: EvidenceRow[] = []
  if (a.range) {
    rows.push({
      term: 'Trading range',
      meaning: 'flat horizontal channel (support ↔ resistance)',
      value: `$${a.range.support.toFixed(2)} – $${a.range.resistance.toFixed(2)} · ${a.rangeQuality.windowBars} bars`,
    })
  }
  if (a.context && a.context.kind !== 'undetermined') {
    rows.push({
      term: 'Context',
      meaning: 'accumulation (bottom) vs distribution (top)',
      value: `${a.context.kind === 'accumulation' ? 'Accumulation' : 'Distribution'} · ${pct(a.context.confidence)} confidence`,
    })
  }
  // Most recent objective climax bar.
  for (let i = a.bars.length - 1; i >= 0; i--) {
    const b = a.bars[i]
    if (b.cls === 'climax' && b.relVol != null) {
      rows.push({
        term: 'Climax volume',
        meaning: 'heavy-volume effort / possible exhaustion',
        value: `${b.relVol.toFixed(1)}× avg on ${b.date}`,
      })
      break
    }
  }
  // Latest schematic event.
  const last = a.events[a.events.length - 1]
  if (last) {
    rows.push({
      term: last.label,
      meaning: WYCKOFF_EVENT_META[last.type].note.split(' — ')[0],
      value: `${last.date} · ${pct(last.confidence)} confidence`,
    })
  }
  if (a.target) {
    rows.push({
      term: 'Range-height objective',
      meaning: 'cause → effect projection (method estimate, not a forecast)',
      value: `$${a.target.price.toFixed(2)} ${a.target.direction === 'up' ? 'above' : 'below'} the range`,
    })
  }

  const caveat =
    'Daily-resolution interpretation on free EOD data — heuristic, not confirmed, and not advice.'
  let watch = 'Watch whether the next bars confirm or reject this read.'
  if (a.context?.kind === 'accumulation') {
    watch = 'Watch for a low-volume spring/test holding support, then a strong-volume break above resistance to confirm demand.'
  } else if (a.context?.kind === 'distribution') {
    watch = 'Watch for an upthrust that fails at resistance, then a wide-spread break below support to confirm supply.'
  }
  return { rows, caveat, watch }
}
