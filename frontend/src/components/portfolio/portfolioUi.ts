/**
 * Shared vocabulary + client-side math for the Portfolio tab (Phase 2).
 *
 * The Rebalance Simulator's what-if stats (vol/β/Sharpe/maxDD) are computed
 * HERE from the analytics endpoint's aligned 1Y daily-returns matrix, so the
 * drawer updates instantly as the user edits trades; the Monte Carlo rerun
 * goes back to the server (POST /portfolio/projection). Formulas mirror the
 * backend (σ×√252, pairwise-complete β, FIFO tax walk, IRS anniversary LT).
 *
 * HONESTY: expected returns are the backend's shrunk estimates (50% toward an
 * ~8% market prior) — display them as estimates, never as promises.
 */
import type {
  PortfolioAllocation,
  PortfolioFlag,
  PortfolioHolding,
  PortfolioLot,
  PortfolioSummary,
} from '@/types/api'

// ── Constants ───────────────────────────────────────────────────────────────
export const BENCHMARK_OPTIONS = ['SPY', 'QQQ', 'VTI', 'SCHD', 'IWM', 'AGG']

export type RangeKey = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'Max'
export const RANGES: RangeKey[] = ['1M', '3M', '6M', 'YTD', '1Y', 'Max']

export const TRADING_DAYS = 252

/** Severity chip styling (mock's HIGH/MED/LOW badges). */
export const SEVERITY_TONES: Record<string, { badge: string; border: string }> = {
  high: { badge: 'bg-red-600 text-white', border: 'border-l-red-500' },
  med: { badge: 'bg-amber-500 text-white', border: 'border-l-amber-400' },
  low: { badge: 'bg-slate-400 text-white', border: 'border-l-slate-300' },
}

/** Consistent sector hue across chips, donut and legend. */
const SECTOR_COLORS: Record<string, string> = {
  'Information Technology': '#3b82f6',
  'Communication Services': '#8b5cf6',
  Energy: '#b45309',
  Financials: '#15803d',
  'Consumer Discretionary': '#0d9488',
  'Consumer Staples': '#0ea5e9',
  'Health Care': '#dc2626',
  Industrials: '#64748b',
  Materials: '#a16207',
  Utilities: '#7c3aed',
  'Real Estate': '#be185d',
}

export function sectorColor(sector: string | null | undefined): string {
  return (sector && SECTOR_COLORS[sector]) || '#94a3b8'
}

/** Short sector label for chips (mock shows "Comms", "Tech"…). */
const SECTOR_SHORT: Record<string, string> = {
  'Information Technology': 'Tech',
  'Communication Services': 'Comms',
  'Consumer Discretionary': 'Cons D',
  'Consumer Staples': 'Cons S',
  'Health Care': 'Health',
  Financials: 'Fin',
  Industrials: 'Indust',
  Energy: 'Energy',
  Materials: 'Matls',
  Utilities: 'Utils',
  'Real Estate': 'RE',
}

export function sectorShort(sector: string | null | undefined): string {
  if (!sector) return '—'
  return SECTOR_SHORT[sector] ?? sector.slice(0, 6)
}

// ── Range slicing ───────────────────────────────────────────────────────────
/** Index into `dates` (ISO strings, ascending) where the range starts. */
export function rangeStartIndex(dates: string[], range: RangeKey): number {
  if (range === 'Max' || dates.length === 0) return 0
  const last = new Date(dates[dates.length - 1] + 'T00:00:00Z')
  let cutoff: Date
  if (range === 'YTD') {
    cutoff = new Date(Date.UTC(last.getUTCFullYear(), 0, 1))
  } else {
    const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[range]
    cutoff = new Date(last)
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
  }
  const iso = cutoff.toISOString().slice(0, 10)
  const idx = dates.findIndex((d) => d >= iso)
  return idx < 0 ? 0 : idx
}

/** Rebase a growth curve to 1.0 at `start` (for range-zoomed TWR display). */
export function rebase(curve: number[], start: number): number[] {
  const base = curve[start]
  if (!base) return curve.slice(start)
  const out: number[] = []
  for (let i = start; i < curve.length; i++) out.push(curve[i] / base)
  return out
}

export interface RangeStats {
  ret: number | null
  benchRet: number | null
  deltaPp: number | null // portfolio − benchmark, in percentage POINTS
  bestDay: { date: string; ret: number } | null
  worstDay: { date: string; ret: number } | null
  upPct: number | null
  vol: number | null // annualized
}

/** Quick stats for the visible window, from the (already daily) growth curves. */
export function rangeStats(
  dates: string[],
  twrCurve: number[],
  benchCurve: number[],
  start: number,
): RangeStats {
  const n = twrCurve.length
  if (n - start < 2 || start >= n) {
    return { ret: null, benchRet: null, deltaPp: null, bestDay: null,
             worstDay: null, upPct: null, vol: null }
  }
  const rets: number[] = []
  let best: { date: string; ret: number } | null = null
  let worst: { date: string; ret: number } | null = null
  let up = 0
  for (let i = start + 1; i < n; i++) {
    const r = twrCurve[i] / twrCurve[i - 1] - 1
    rets.push(r)
    if (r > 0) up++
    if (!best || r > best.ret) best = { date: dates[i] ?? '', ret: r }
    if (!worst || r < worst.ret) worst = { date: dates[i] ?? '', ret: r }
  }
  const ret = twrCurve[n - 1] / twrCurve[start] - 1
  const benchRet =
    benchCurve.length === n && benchCurve[start]
      ? benchCurve[n - 1] / benchCurve[start] - 1
      : null
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const sd = Math.sqrt(
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rets.length - 1, 1),
  )
  return {
    ret,
    benchRet,
    deltaPp: benchRet != null ? (ret - benchRet) * 100 : null,
    bestDay: best,
    worstDay: worst,
    upPct: rets.length ? up / rets.length : null,
    vol: rets.length >= 20 ? sd * Math.sqrt(TRADING_DAYS) : null,
  }
}

/** Drawdown fraction series (≤ 0) from a growth curve. */
export function drawdownSeries(curve: number[]): number[] {
  let peak = -Infinity
  const out: number[] = []
  for (const v of curve) {
    if (v > peak) peak = v
    out.push(peak > 0 ? v / peak - 1 : 0)
  }
  return out
}

// ── Benchmark risk stats (shared by VsMarketPanel + the health engine) ───────
export interface BenchStats {
  vol: number | null
  maxDD: number | null
  sharpe: number | null
}

/** Annualized vol / max drawdown / Sharpe derived from a benchmark GROWTH curve
 *  (the same client-side derivation the vs-market table has always used — moved
 *  here so the health engine and the panel share one source). */
export function computeBenchStats(curve: number[]): BenchStats {
  if (!curve || curve.length < 3) return { vol: null, maxDD: null, sharpe: null }
  const rets: number[] = []
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]
    if (prev > 0) rets.push(curve[i] / prev - 1)
  }
  if (rets.length < 2) return { vol: null, maxDD: null, sharpe: null }
  let sum = 0
  for (let i = 0; i < rets.length; i++) sum += rets[i]
  const mean = sum / rets.length
  let sq = 0
  for (let i = 0; i < rets.length; i++) sq += (rets[i] - mean) * (rets[i] - mean)
  const sd = Math.sqrt(sq / (rets.length - 1))
  const vol = sd * Math.sqrt(252)
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : null
  let peak = curve[0]
  let maxDD = 0
  for (let i = 1; i < curve.length; i++) {
    if (curve[i] > peak) peak = curve[i]
    if (peak > 0) {
      const dd = curve[i] / peak - 1
      if (dd < maxDD) maxDD = dd
    }
  }
  return { vol, maxDD, sharpe }
}

/** Single best / worst DAY return from a growth curve (differences the curve;
 *  use the TWR/bench growth curves, never the raw value array — TWR strips
 *  deposit timing). null when the curve is too short. */
export function bestWorstDay(curve: number[]): { best: number | null; worst: number | null } {
  if (!curve || curve.length < 2) return { best: null, worst: null }
  let best: number | null = null
  let worst: number | null = null
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]
    if (!(prev > 0)) continue
    const r = curve[i] / prev - 1
    if (best === null || r > best) best = r
    if (worst === null || r < worst) worst = r
  }
  return { best, worst }
}

// ── Portfolio Health Score ──────────────────────────────────────────────────
// A DETERMINISTIC 0-100 diagnostic of measurable STRUCTURAL issues — NOT a
// rating of the user's stock-picking, and NOT advice. Start at 100 and subtract
// measured penalties; each factor renders a plain-English "cost N pts" line, and
// the transparent breakdown is the whole point. Every input already ships in the
// /portfolio payload — nothing is fabricated. Short history / missing metrics /
// no risk profile are handled honestly (see HEALTH_MIN_DAYS and the notes).

export const HEALTH_MIN_DAYS = 60 // matches the 60-obs beta gate; below this we don't score

export type HealthBand = 'needs_attention' | 'balanced' | 'resilient'

export interface HealthFactor {
  key: 'concentration' | 'sector' | 'drawdown' | 'sharpe' | 'relative' | 'diversification' | 'riskfit'
  label: string
  penalty: number // points lost (already renormalized + capped)
  maxPenalty: number // this factor's renormalized budget
  reason: string | null // plain-English line; null when the factor passed
  ok: boolean // rounded penalty === 0
}

export interface HealthScore {
  status: 'ok' | 'insufficient_history'
  score: number | null // null when insufficient_history
  band: HealthBand | null
  factors: HealthFactor[]
  scoredCount: number
  totalFactors: number
  notes: string[] // disclosures (dropped factors, etc.)
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const pct = (x: number) => `${Math.round(x * 100)}%`

export function healthBand(score: number): HealthBand {
  if (score < 50) return 'needs_attention'
  if (score < 75) return 'balanced'
  return 'resilient'
}

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  needs_attention: 'Needs Attention',
  balanced: 'Balanced',
  resilient: 'Resilient',
}

/** Internal per-factor spec before renormalization. */
interface RawFactor {
  key: HealthFactor['key']
  label: string
  baseMax: number // effective base budget (already reduced for a dropped sub-part)
  available: boolean
  needsHistory: boolean // true = return-based; deferred until ~3mo of daily returns
  rawFraction: number // 0..1 of baseMax incurred
  reason: (finalPenalty: number) => string // built after renorm using the final pts
}

export function computeHealthScore(args: {
  summary: PortfolioSummary
  holdings: PortfolioHolding[]
  flags: PortfolioFlag[]
  performance: { twr_curve: number[]; bench_curve: number[] } | null
  allocation: PortfolioAllocation | null
  benchStats: BenchStats
  riskAlignment?: { has_profile: boolean; in_band_weight_pct: number } | null
}): HealthScore {
  const { summary, holdings, flags, performance, allocation, benchStats, riskAlignment } = args
  const hasProfile = !!riskAlignment?.has_profile
  const totalFactors = hasProfile ? 7 : 6

  // Honesty gate: with NO holdings there is nothing to diagnose → copy only,
  // never a fabricated number. Point-in-time factors (concentration,
  // diversification, sector) are valid from day one; return-based factors
  // (drawdown, Sharpe, relative) are deferred until ~3 months of history and
  // disclosed — so a genuinely concentrated new book still gets its warning
  // instead of an unhelpful "no score".
  const twr = performance?.twr_curve ?? []
  const usableHoldings = holdings.filter((h) => (h.weight ?? 0) > 0)
  if (usableHoldings.length === 0) {
    return {
      status: 'insufficient_history',
      score: null,
      band: null,
      factors: [],
      scoredCount: 0,
      totalFactors,
      notes: [],
    }
  }
  const hasHistory = twr.length >= HEALTH_MIN_DAYS

  const raw: RawFactor[] = []

  // 1 — Single-name concentration (base 24).
  const weights = usableHoldings.map((h) => h.weight ?? 0)
  let topW = 0
  let topTicker = ''
  for (const h of usableHoldings) {
    const w = h.weight ?? 0
    if (w > topW) { topW = w; topTicker = h.ticker ?? '' }
  }
  const concFlags = flags.filter((f) => f.kind === 'concentration')
  const concBase = clamp01((topW - 0.1) / 0.3) * 20
  const concExtra = Math.min(Math.max(concFlags.length - 1, 0) * 2, 4)
  raw.push({
    key: 'concentration',
    label: 'Single-name concentration',
    baseMax: 24,
    available: true,
    needsHistory: false,
    rawFraction: (concBase + concExtra) / 24,
    reason: (p) =>
      `${topTicker || 'Your largest holding'} is ${pct(topW)} of the book` +
      (concFlags.length > 1 ? ` (${concFlags.length} names over the threshold)` : '') +
      ` — concentration cost ${Math.round(p)} pts.`,
  })

  // 2 — Sector concentration (base 14).
  const sectorFlag = flags.filter((f) => f.kind === 'sector')
  let maxSectorW: number | null = null
  let maxSector = ''
  for (const f of sectorFlag) {
    if (f.weight != null && (maxSectorW === null || f.weight > maxSectorW)) {
      maxSectorW = f.weight; maxSector = f.sector ?? ''
    }
  }
  if (maxSectorW === null && allocation?.sectors) {
    for (const s of allocation.sectors) {
      if (s.weight != null && (maxSectorW === null || s.weight > maxSectorW)) {
        maxSectorW = s.weight; maxSector = s.sector
      }
    }
  }
  raw.push({
    key: 'sector',
    label: 'Sector concentration',
    baseMax: 14,
    available: maxSectorW !== null,
    needsHistory: false,
    rawFraction: maxSectorW !== null ? clamp01((maxSectorW - 0.3) / 0.3) : 0,
    reason: (p) => `${pct(maxSectorW ?? 0)} in ${maxSector || 'one sector'} — sector concentration cost ${Math.round(p)} pts.`,
  })

  // 3 — Drawdown / downside (base 22: abs 14 + excess-vs-SPY 8).
  const maxDD = summary.max_drawdown
  const benchDD = benchStats.maxDD
  const ddAbs = maxDD != null ? clamp01((Math.abs(maxDD) - 0.15) / 0.35) * 14 : 0
  const ddExcess =
    maxDD != null && benchDD != null
      ? clamp01((Math.abs(maxDD) - Math.abs(benchDD)) / 0.2) * 8
      : 0
  const ddBaseMax = benchDD != null ? 22 : 14 // drop only the vs-SPY sub-part if no bench
  raw.push({
    key: 'drawdown',
    label: 'Drawdown & downside',
    baseMax: ddBaseMax,
    available: maxDD != null && hasHistory,
    needsHistory: true,
    rawFraction: maxDD != null ? (ddAbs + ddExcess) / ddBaseMax : 0,
    reason: (p) =>
      `Worst drawdown ${pct(maxDD ?? 0)}` +
      (benchDD != null ? ` (${summary.benchmark} ${pct(benchDD)})` : '') +
      ` — cost ${Math.round(p)} pts.`,
  })

  // 4 — Risk-adjusted return / Sharpe (base 16: abs 10 + vs-SPY 6).
  const sharpe = summary.sharpe
  const benchSharpe = benchStats.sharpe
  const shAbs = sharpe != null ? clamp01((1.0 - sharpe) / 1.0) * 10 : 0
  const shVs =
    sharpe != null && benchSharpe != null && sharpe < benchSharpe
      ? clamp01((benchSharpe - sharpe) / 0.6) * 6
      : 0
  const shBaseMax = benchSharpe != null ? 16 : 10
  raw.push({
    key: 'sharpe',
    label: 'Risk-adjusted return',
    baseMax: shBaseMax,
    available: sharpe != null && hasHistory,
    needsHistory: true,
    rawFraction: sharpe != null ? (shAbs + shVs) / shBaseMax : 0,
    reason: (p) =>
      `Sharpe ${(sharpe ?? 0).toFixed(2)}` +
      (benchSharpe != null ? ` vs ${summary.benchmark} ${benchSharpe.toFixed(2)}` : '') +
      ` — risk-adjusted return cost ${Math.round(p)} pts.`,
  })

  // 5 — Relative performance vs benchmark (base 10). Deliberately LOW-weighted
  // so the band reads as structural resilience, not "did you beat the market."
  const deltaPp =
    summary.twr_total != null && summary.bench_total != null
      ? (summary.twr_total - summary.bench_total) * 100
      : null
  raw.push({
    key: 'relative',
    label: `Return vs ${summary.benchmark}`,
    baseMax: 10,
    available: deltaPp != null && hasHistory,
    needsHistory: true,
    rawFraction: deltaPp != null ? clamp01((1 - deltaPp) / 16) : 0,
    reason: (p) => `Trailing ${summary.benchmark} by ${Math.abs(deltaPp ?? 0).toFixed(1)} pts — cost ${Math.round(p)} pts.`,
  })

  // 6 — Diversification via effective N (base 14).
  const sumSq = weights.reduce((a, w) => a + w * w, 0)
  const effN = sumSq > 0 ? 1 / sumSq : null
  raw.push({
    key: 'diversification',
    label: 'Diversification',
    baseMax: 14,
    available: effN != null,
    needsHistory: false,
    rawFraction: effN != null ? clamp01((15 - effN) / 12) : 0,
    reason: (p) => `Only ~${Math.round(effN ?? 0)} effective holdings — concentration of bets cost ${Math.round(p)} pts.`,
  })

  // 7 — Risk-fit vs the user's stated profile (base 12) — only when a profile exists.
  if (hasProfile && riskAlignment && riskAlignment.in_band_weight_pct != null) {
    const inBand = riskAlignment.in_band_weight_pct // fraction 0..1
    raw.push({
      key: 'riskfit',
      label: 'Fit to your risk profile',
      baseMax: 12,
      available: true,
      needsHistory: false,
      rawFraction: clamp01((0.8 - inBand) / 0.8),
      reason: (p) => `${pct(inBand)} of weight inside your chosen risk bands — cost ${Math.round(p)} pts.`,
    })
  }

  // Renormalize the AVAILABLE factors' budgets to sum to 100, so the score is
  // always out of 100 and a dropped factor never silently inflates it.
  const active = raw.filter((f) => f.available)
  const budgetSum = active.reduce((a, f) => a + f.baseMax, 0)
  const notes: string[] = []
  const dropped = raw.filter((f) => !f.available)
  // Split "waiting on history" (honest, temporary) from "data unavailable".
  const historyDropped = dropped.filter((f) => f.needsHistory && !hasHistory)
  const dataDropped = dropped.filter((f) => !historyDropped.includes(f))
  if (historyDropped.length > 0) {
    notes.push(
      `Based on about ${twr.length} trading days — drawdown, risk-adjusted ` +
        `return and return-vs-${summary.benchmark} factors need roughly three ` +
        `months of history, so this score reflects the structural factors ` +
        `(concentration, diversification, sector) for now.`,
    )
  }
  if (dataDropped.length > 0) {
    notes.push(
      `Scored without ${dataDropped.map((f) => f.label.toLowerCase()).join(', ')} ` +
        `— unavailable for this book.`,
    )
  }

  let totalPenalty = 0
  const factors: HealthFactor[] = active.map((f) => {
    const maxPenalty = budgetSum > 0 ? (f.baseMax * 100) / budgetSum : 0
    const penalty = f.rawFraction * maxPenalty
    totalPenalty += penalty
    const ok = Math.round(penalty) === 0
    return {
      key: f.key,
      label: f.label,
      penalty,
      maxPenalty,
      reason: ok ? null : f.reason(penalty),
      ok,
    }
  })

  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)))
  return {
    status: 'ok',
    score,
    band: healthBand(score),
    factors,
    scoredCount: active.length,
    totalFactors,
    notes,
  }
}

// ── What-if portfolio stats (Rebalance Simulator) ───────────────────────────
export interface WhatIfStats {
  vol: number | null
  beta: number | null
  sharpe: number | null
  maxDD: number | null // most negative point of the weighted 1Y path
  expReturn: number | null // Σw·shrunk-expected (estimate, labeled)
}

/**
 * Portfolio stats for an arbitrary weight vector over the analytics returns
 * matrix. Each day's portfolio return = Σ wᵢ·rᵢ over the tickers with data
 * that day, renormalized over the available weight (missing tickers sit out).
 */
export function whatIfStats(
  weights: Record<string, number>,
  returns: Record<string, (number | null)[]>,
  benchTicker: string,
  expected?: Record<string, { exp_return: number | null; vol: number | null }>,
): WhatIfStats {
  const tickers = Object.keys(weights).filter(
    (t) => weights[t] > 0 && returns[t] && returns[t].length > 0,
  )
  if (tickers.length === 0) {
    return { vol: null, beta: null, sharpe: null, maxDD: null, expReturn: null }
  }
  const nDays = Math.max(...tickers.map((t) => returns[t].length))
  const bench = returns[benchTicker] ?? []

  const port: number[] = []
  const benchAligned: (number | null)[] = []
  for (let d = 0; d < nDays; d++) {
    let acc = 0
    let wSum = 0
    for (const t of tickers) {
      const r = returns[t][d]
      if (r != null) {
        acc += weights[t] * r
        wSum += weights[t]
      }
    }
    if (wSum > 0) {
      port.push(acc / wSum)
      benchAligned.push(bench[d] ?? null)
    }
  }
  if (port.length < 20) {
    return { vol: null, beta: null, sharpe: null, maxDD: null, expReturn: null }
  }

  const mean = port.reduce((a, b) => a + b, 0) / port.length
  const sd = Math.sqrt(
    port.reduce((a, b) => a + (b - mean) ** 2, 0) / (port.length - 1),
  )
  const vol = sd * Math.sqrt(TRADING_DAYS)
  const sharpe = sd > 1e-12 ? (mean / sd) * Math.sqrt(TRADING_DAYS) : null

  // pairwise-complete beta vs benchmark
  let beta: number | null = null
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < port.length; i++) {
    const b = benchAligned[i]
    if (b != null) pairs.push([port[i], b])
  }
  if (pairs.length >= 60) {
    const pm = pairs.reduce((a, p) => a + p[0], 0) / pairs.length
    const bm = pairs.reduce((a, p) => a + p[1], 0) / pairs.length
    let cov = 0
    let bvar = 0
    for (const [p, b] of pairs) {
      cov += (p - pm) * (b - bm)
      bvar += (b - bm) ** 2
    }
    if (bvar > 1e-12) beta = cov / bvar
  }

  // max drawdown of the weighted path
  let level = 1
  let peak = 1
  let maxDD = 0
  for (const r of port) {
    level *= 1 + r
    if (level > peak) peak = level
    maxDD = Math.min(maxDD, level / peak - 1)
  }

  // weighted shrunk expected return (estimate)
  let expReturn: number | null = null
  if (expected) {
    let acc = 0
    let wSum = 0
    for (const t of tickers) {
      const e = expected[t]?.exp_return
      if (e != null) {
        acc += weights[t] * e
        wSum += weights[t]
      }
    }
    expReturn = wSum > 0 ? acc / wSum : null
  }

  return { vol, beta, sharpe, maxDD, expReturn }
}

// ── Trades → weights ────────────────────────────────────────────────────────
export interface SimTrade {
  side: 'sell' | 'buy'
  ticker: string
  shares: number
  price: number // per share (last close or live)
}

/**
 * Apply trades to the current holdings → new weight vector (over the SAME
 * total money: sells move value to buys; any unspent sale value is dropped
 * from the weights, i.e. treated as cash out of the simulated book).
 */
export function tradesToWeights(
  holdings: PortfolioHolding[],
  trades: SimTrade[],
): Record<string, number> {
  const value: Record<string, number> = {}
  for (const h of holdings) {
    if (h.ticker && h.market_value) value[h.ticker] = h.market_value
  }
  for (const t of trades) {
    const amt = t.shares * t.price
    if (!(amt > 0)) continue
    if (t.side === 'sell') {
      value[t.ticker] = Math.max((value[t.ticker] ?? 0) - amt, 0)
    } else {
      value[t.ticker] = (value[t.ticker] ?? 0) + amt
    }
  }
  const total = Object.values(value).reduce((a, b) => a + b, 0)
  const w: Record<string, number> = {}
  if (total <= 0) return w
  for (const [t, v] of Object.entries(value)) {
    if (v > 0) w[t] = v / total
  }
  return w
}

/**
 * The projection API caps `weights` at 50 entries. For 50+ position books,
 * keep the 50 largest weights and renormalize — a raw 422 on "Run cone" would
 * be worse than a slightly-truncated tail (the drop is disclosed by the sim's
 * excluded/assumptions output being shorter than the book).
 */
export function capWeights(
  weights: Record<string, number>,
  max = 50,
): Record<string, number> {
  const entries = Object.entries(weights)
  if (entries.length <= max) return weights
  const top = [...entries].sort((a, b) => b[1] - a[1]).slice(0, max)
  const total = top.reduce((a, [, w]) => a + w, 0)
  const out: Record<string, number> = {}
  for (const [t, w] of top) out[t] = total > 0 ? w / total : 0
  return out
}

// ── Client-side FIFO tax preview (mirrors the backend) ──────────────────────
/** IRS long-term = held MORE than one year (anniversary; Feb 29 → Mar 1). */
export function isLongTerm(acquiredISO: string, asofISO: string): boolean {
  const [y, m, d] = acquiredISO.split('-').map(Number)
  let ann: Date
  if (m === 2 && d === 29) ann = new Date(Date.UTC(y + 1, 2, 1))
  else ann = new Date(Date.UTC(y + 1, m - 1, d))
  return new Date(asofISO + 'T00:00:00Z') > ann
}

export interface TaxPreview {
  lt: number
  st: number
}

/** FIFO walk of the open lots for a hypothetical sell at `px`. */
export function taxForSell(
  lots: PortfolioLot[],
  sellShares: number,
  px: number,
  asofISO: string,
): TaxPreview {
  let remaining = sellShares
  let lt = 0
  let st = 0
  for (const lot of lots) {
    if (remaining <= 1e-9) break
    // dust lots can round to 0 shares on the wire — 0/0 below would NaN the tax
    if (lot.shares <= 0) continue
    const take = Math.min(lot.shares, remaining)
    const pl = take * px - lot.cost * (take / lot.shares)
    if (isLongTerm(lot.acquired, asofISO)) lt += pl
    else st += pl
    remaining -= take
  }
  return { lt, st }
}

// ── Verdict synthesis ───────────────────────────────────────────────────────
export interface Verdict {
  tone: 'good' | 'warn' | 'bad'
  headline: string
  detail: string
  fixCount: number
}

/** One-sentence portfolio state from the same numbers the page shows. */
export function buildVerdict(args: {
  twrTotal: number | null
  benchTotal: number | null
  benchmark: string
  volatility: number | null
  beta: number | null
  flags: PortfolioFlag[]
  firstDate: string
}): Verdict {
  const { twrTotal, benchTotal, benchmark, volatility, beta, flags } = args
  const deltaPp =
    twrTotal != null && benchTotal != null ? (twrTotal - benchTotal) * 100 : null
  const fixes = flags.filter((f) => f.fix)
  const drivers: string[] = []
  const conc = flags.filter((f) => f.kind === 'concentration')
  if (conc.length) {
    drivers.push(
      conc.length === 1
        ? `${conc[0].ticker} at ${Math.round((conc[0].weight ?? 0) * 100)}% of the book`
        : `${conc.length} positions above the single-name threshold`,
    )
  }
  const sector = flags.find((f) => f.kind === 'sector')
  if (sector?.sector && sector.weight != null) {
    drivers.push(`${Math.round(sector.weight * 100)}% in ${sector.sector}`)
  }
  if (volatility != null && volatility > 0.3) {
    drivers.push(
      `${Math.round(volatility * 100)}% volatility${beta != null ? ` (β ${beta.toFixed(2)})` : ''}`,
    )
  }
  const since = args.firstDate
    ? new Date(args.firstDate + 'T00:00:00Z').toLocaleDateString('en-US', {
        month: 'short', year: 'numeric', timeZone: 'UTC',
      })
    : ''

  let tone: Verdict['tone']
  let headline: string
  if (deltaPp == null) {
    tone = 'warn'
    headline = 'Not enough history yet to compare you to the market.'
  } else if (deltaPp >= 1) {
    tone = 'good'
    headline = `You're beating ${benchmark} by ${deltaPp.toFixed(1)} pts${since ? ` since ${since}` : ''}.`
  } else if (deltaPp > -1) {
    tone = 'warn'
    headline = `You're tracking ${benchmark}${since ? ` since ${since}` : ''} (${deltaPp >= 0 ? '+' : ''}${deltaPp.toFixed(1)} pts).`
  } else {
    tone = 'bad'
    headline = `You're underperforming ${benchmark} by ${Math.abs(deltaPp).toFixed(1)} pts${since ? ` since ${since}` : ''}.`
  }
  const detail = drivers.length
    ? `Driver${drivers.length > 1 ? 's' : ''}: ${drivers.join(' · ')}.`
    : 'No structural issues flagged — concentration, sector and drawdown all inside thresholds.'
  return { tone, headline, detail, fixCount: fixes.length }
}

// ── Snooze / dismiss store (localStorage; per-card, with expiry) ───────────
const SNOOZE_KEY = 'stockbud.portfolio.snoozes.v1'

type SnoozeMap = Record<string, number> // card key → expiry epoch ms

export function flagKey(f: PortfolioFlag): string {
  return `${f.kind}:${f.ticker ?? f.sector ?? 'portfolio'}`
}

function readSnoozes(): SnoozeMap {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY)
    const map = raw ? (JSON.parse(raw) as SnoozeMap) : {}
    const now = Date.now()
    let changed = false
    for (const k of Object.keys(map)) {
      if (map[k] < now) {
        delete map[k]
        changed = true
      }
    }
    if (changed) localStorage.setItem(SNOOZE_KEY, JSON.stringify(map))
    return map
  } catch {
    return {}
  }
}

export function activeSnoozes(): SnoozeMap {
  return readSnoozes()
}

export function snoozeFlag(f: PortfolioFlag, days: number): void {
  const map = readSnoozes()
  if (days <= 0) {
    // unsnooze: delete outright — writing expiry=now wouldn't prune until the
    // next millisecond, so the card would stay hidden in-session
    delete map[flagKey(f)]
  } else {
    map[flagKey(f)] = Date.now() + days * 86_400_000
  }
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map))
  } catch {
    /* storage full/blocked — snooze just won't persist */
  }
}

// ── Misc formatting helpers used across the tab ────────────────────────────
/** '2026-07' → "Jul '26" for the income calendar strip. */
export function fmtMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[(m ?? 1) - 1]} '${String(y).slice(2)}`
}
