// Client-side intrinsic-value math. The backend ships only raw, provenance-
// tagged inputs + assumption seeds; every number the panel shows is computed
// here, in the browser, from those inputs — so the user can reproduce it. No
// single "fair value" is ever emitted as truth; these are scenario outputs of
// assumptions the user controls.
//
// Conventions: netDebt = total_debt − cash (can be negative = net cash).
//   enterprise_value − netDebt = equity_value ; equity_value / shares = per share.

export interface DcfAssumptions {
  gStart: number // stage-1 growth (year 1)
  r: number // discount rate
  gInf: number // terminal growth
  horizon: number // years
}

export interface DcfResult {
  perShare: number | null
  enterpriseValue: number
  equityValue: number
  pvExplicit: number
  pvTerminal: number
  tvShareOfPv: number // fraction of EV that is the terminal value (assumption-risk gauge)
  series: { t: number; g: number; fcf: number; pv: number }[]
}

/** Two-stage FCF DCF: growth fades linearly gStart → gInf over the horizon,
 *  then a Gordon terminal value. Terminal growth is clamped strictly below r. */
export function forwardDcf(
  fcf0: number,
  netDebt: number,
  shares: number,
  a: DcfAssumptions,
): DcfResult {
  const gInf = Math.min(a.gInf, a.r - 0.0001) // Gordon requires g∞ < r
  const H = Math.max(1, Math.round(a.horizon))
  let fcf = fcf0
  let pvExplicit = 0
  const series: DcfResult['series'] = []
  for (let t = 1; t <= H; t++) {
    const frac = H > 1 ? (t - 1) / (H - 1) : 1
    const g = a.gStart + (gInf - a.gStart) * frac
    fcf = fcf * (1 + g)
    const pv = fcf / Math.pow(1 + a.r, t)
    pvExplicit += pv
    series.push({ t, g, fcf, pv })
  }
  const tvH = (fcf * (1 + gInf)) / (a.r - gInf)
  const pvTerminal = tvH / Math.pow(1 + a.r, H)
  const enterpriseValue = pvExplicit + pvTerminal
  const equityValue = enterpriseValue - netDebt // − debt + cash
  const perShare = shares > 0 ? equityValue / shares : null
  const tvShareOfPv = enterpriseValue > 0 ? pvTerminal / enterpriseValue : 0
  return { perShare, enterpriseValue, equityValue, pvExplicit, pvTerminal, tvShareOfPv, series }
}

/** Reverse DCF: hold today's price fixed, solve for the stage-1 FCF growth the
 *  price implies. EV is monotonic in gStart, so bisection converges fast.
 *  Returns null when FCF/shares make it meaningless; clamps to [-20%, +40%]. */
export function impliedGrowth(
  fcf0: number,
  netDebt: number,
  shares: number,
  price: number,
  opts: { r: number; gInf: number; horizon: number },
): number | null {
  if (!(fcf0 > 0) || !(shares > 0) || !(price > 0)) return null
  const targetEV = price * shares + netDebt // equity + netDebt
  const evAt = (g: number) =>
    forwardDcf(fcf0, netDebt, shares, { gStart: g, ...opts }).enterpriseValue - targetEV
  let lo = -0.2
  let hi = 0.4
  if (evAt(lo) > 0) return lo // price implies < −20% growth
  if (evAt(hi) < 0) return hi // price needs > +40% growth
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2
    const fm = evAt(mid)
    if (Math.abs(fm) < targetEV * 1e-7) return mid
    if (fm < 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export interface MultiplesInputs {
  eps: number | null
  revPerShare: number | null
  ebitda: number | null
  fcf0: number | null
  netDebt: number
  shares: number
}

export interface PeerMedians {
  pe?: number | null
  ps?: number | null
  ev_ebitda?: number | null
  fcf_yield?: number | null
}

/** Peer-relative fair value: apply each sector-median multiple to this company's
 *  own earnings/revenue/EBITDA/FCF. EV multiples bridge back through net debt. */
export function multiplesFairValue(i: MultiplesInputs, peer: PeerMedians) {
  const pe = peer.pe != null && i.eps != null && i.eps > 0 ? peer.pe * i.eps : null
  const ps = peer.ps != null && i.revPerShare != null ? peer.ps * i.revPerShare : null
  const evEbitda =
    peer.ev_ebitda != null && i.ebitda != null && i.shares > 0
      ? (peer.ev_ebitda * i.ebitda - i.netDebt) / i.shares
      : null
  // P/FCF = 1 / median FCF-yield; guard a ≤0 median (would explode/flip sign).
  const pfcfMult = peer.fcf_yield != null && peer.fcf_yield > 0 ? 1 / peer.fcf_yield : null
  const pfcf =
    pfcfMult != null && i.fcf0 != null && i.fcf0 > 0 && i.shares > 0
      ? pfcfMult * (i.fcf0 / i.shares)
      : null
  return { pe, ps, evEbitda, pfcf, pfcfMult }
}

/** Graham number — a 1930s earnings×book rule-of-thumb, context only. */
export function grahamNumber(eps: number | null, bvps: number | null): number | null {
  if (eps == null || bvps == null || eps <= 0 || bvps <= 0) return null
  return Math.sqrt(22.5 * eps * bvps)
}

/** Margin of safety = (value − price) / value, as a fraction (can be negative). */
export function marginOfSafety(value: number | null, price: number | null): number | null {
  if (value == null || price == null || value <= 0) return null
  return (value - price) / value
}
