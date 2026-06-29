import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { getValuation } from '@/lib/api'
import { fmtDate, fmtMoney, fmtPct, fmtPrice } from '@/lib/format'
import {
  forwardDcf,
  grahamNumber,
  impliedGrowth,
  marginOfSafety,
  multiplesFairValue,
} from '@/lib/valuation'
import type { ValuationInput, ValuationResponse } from '@/types/api'

// Bear/Bull derive from the live "Base" sliders by fixed pessimism/optimism
// deltas (mirrors the backend scenario_bands), so dragging shifts the whole band.
const SCN = {
  bear: { dG: -0.05, dR: +0.015, gInf: 0.015 },
  bull: { dG: +0.05, dR: -0.01, gInf: 0.03 },
}

function inputOf(v: ValuationResponse, key: string): ValuationInput | undefined {
  return v.inputs.find((i) => i.key === key)
}
function valOf(v: ValuationResponse, key: string): number | null {
  return inputOf(v, key)?.value ?? null
}

// ── tiny presentational helpers ────────────────────────────────────────────
function QualityDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    ok: 'bg-emerald-500',
    proxied: 'bg-amber-500',
    stale: 'bg-amber-500',
    missing: 'bg-gray-300',
  }
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${map[status] ?? 'bg-gray-300'}`} />
}

function sourceText(i: ValuationInput): string {
  const s = i.source
  if (s.type === 'stored_metric') return `fundamental_metrics.${s.metric}`
  if (s.type === 'xbrl_fact') return `SEC XBRL · ${s.concept}`
  if (s.type === 'price') return 'prices_daily (EOD close)'
  if (s.type === 'derived') return `derived · ${s.formula ?? ''}`
  return s.type
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[0.62rem] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 text-[0.95rem] font-bold text-gray-900 tabular-nums">{value}</div>
      {sub && <div className="text-[0.62rem] text-gray-400">{sub}</div>}
    </div>
  )
}

function Slider({
  label,
  value,
  seed,
  min,
  max,
  step,
  unit,
  source,
  onChange,
}: {
  label: string
  value: number
  seed: number
  min: number
  max: number
  step: number
  unit: string
  source: string
  onChange: (v: number) => void
}) {
  const changed = Math.abs(value - seed) > 1e-9
  const show = (x: number) => (unit === 'years' ? `${Math.round(x)}y` : fmtPct(x))
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[0.72rem] font-medium text-gray-700">{label}</span>
        <span className="flex items-center gap-1.5 text-[0.72rem] tabular-nums text-gray-900">
          {show(value)}
          {changed && (
            <button
              type="button"
              onClick={() => onChange(seed)}
              className="text-[0.6rem] text-indigo-500 hover:text-indigo-700"
              title={`Reset to seeded ${show(seed)}`}
            >
              ↺
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-indigo-600"
      />
      <div className="text-[0.6rem] text-gray-400">
        {changed ? 'you set this · ' : 'seeded · '}
        {source}
      </div>
    </div>
  )
}

export function IntrinsicValuePanel({ ticker }: { ticker: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['valuation', ticker],
    queryFn: () => getValuation(ticker),
    staleTime: 5 * 60_000,
  })

  const [ov, setOv] = useState<Record<string, number>>({})
  const [showWork, setShowWork] = useState(false)

  const seeds = useMemo(
    () => Object.fromEntries((data?.assumptions ?? []).map((a) => [a.key, a.seed])),
    [data],
  )
  const eff = (k: string) => ov[k] ?? seeds[k] ?? 0

  const computed = useMemo(() => {
    if (!data) return null
    const fcf0 = valOf(data, 'fcf_ttm')
    const shares = valOf(data, 'shares_outstanding') ?? 0
    const debt = valOf(data, 'total_debt') ?? 0
    const cash = valOf(data, 'cash_and_equivalents') ?? 0
    const netDebt = debt - cash
    const eps = valOf(data, 'ttm_eps')
    const rev = valOf(data, 'ttm_revenue')
    const ebitda = valOf(data, 'ebitda_ttm')
    const bv = valOf(data, 'book_value')
    const price = data.current_price
    const bvps = bv != null && shares > 0 ? bv / shares : null
    const revPerShare = rev != null && shares > 0 ? rev / shares : null

    const r = eff('discount_rate')
    const gInf = eff('terminal_growth')
    const gStart = eff('g_start')
    const horizon = Math.round(eff('horizon'))
    const active = new Set(data.applicability.active_models)

    const base =
      fcf0 != null && active.has('forward_dcf')
        ? forwardDcf(fcf0, netDebt, shares, { gStart, r, gInf, horizon })
        : null
    const bear =
      fcf0 != null && active.has('forward_dcf')
        ? forwardDcf(fcf0, netDebt, shares, {
            gStart: Math.max(-0.05, gStart + SCN.bear.dG),
            r: Math.min(0.2, r + SCN.bear.dR),
            gInf: SCN.bear.gInf,
            horizon,
          })
        : null
    const bull =
      fcf0 != null && active.has('forward_dcf')
        ? forwardDcf(fcf0, netDebt, shares, {
            gStart: Math.min(0.15, gStart + SCN.bull.dG),
            r: Math.max(0.06, r + SCN.bull.dR),
            gInf: SCN.bull.gInf,
            horizon,
          })
        : null

    const implied =
      fcf0 != null && active.has('reverse_dcf') && price != null
        ? impliedGrowth(fcf0, netDebt, shares, price, { r, gInf, horizon })
        : null

    const mult = multiplesFairValue(
      { eps, revPerShare, ebitda, fcf0, netDebt, shares },
      data.peer_context.medians,
    )
    const graham = active.has('graham') ? grahamNumber(eps, bvps) : null
    const earnYield = eps != null && price ? eps / price : null
    const fcfYield = fcf0 != null && shares > 0 && price ? fcf0 / shares / price : null
    const histFcf = valOf(data, 'fcf_cagr_hist')
    const revCagr = valOf(data, 'revenue_cagr')
    const epsG = valOf(data, 'eps_growth')

    return {
      base, bear, bull, implied, mult, graham, earnYield, fcfYield,
      histFcf, revCagr, epsG, price, netDebt, horizon,
    }
  }, [data, ov]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
      <div className="mt-3 h-20 animate-pulse rounded bg-gray-100" />
    </section>
  }
  if (error || !data || !computed) {
    return <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <h3 className="text-sm font-bold text-gray-900">Intrinsic value</h3>
      <p className="mt-2 text-[0.8rem] text-gray-500">Valuation inputs are unavailable for this name.</p>
    </section>
  }

  const active = new Set(data.applicability.active_models)
  const c = computed
  const price = data.current_price

  // shared band scale for the MoS visual
  const bandPts = [c.bear?.perShare, c.base?.perShare, c.bull?.perShare, price].filter(
    (x): x is number => x != null && isFinite(x),
  )
  const lo = bandPts.length ? Math.min(...bandPts) : 0
  const hi = bandPts.length ? Math.max(...bandPts) : 1
  const pos = (x: number | null | undefined) =>
    x == null || hi === lo ? 50 : ((x - lo) / (hi - lo)) * 100

  return (
    <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">Intrinsic value</h3>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-amber-700">
          Not investment advice
        </span>
      </div>
      <p className="mt-1 text-[0.72rem] text-gray-500">
        Your assumptions, transparent math — every input below shows its filing source and date.
        {' '}
        {data.peer_context.n > 0 && `Peers: ${data.peer_context.n} ${data.sector} names.`}
      </p>

      {/* ── Headline: reverse-DCF (market-implied growth vs history) ── */}
      {active.has('reverse_dcf') && (
        <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
          <div className="text-[0.62rem] font-semibold uppercase tracking-wide text-indigo-600">
            What growth is priced in?
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[1.4rem] font-extrabold leading-none text-indigo-700 tabular-nums">
                {c.implied == null
                  ? '—'
                  : c.implied <= -0.2
                    ? '≤ −20%'
                    : c.implied >= 0.4
                      ? '≥ +40%'
                      : fmtPct(c.implied)}
                <span className="text-[0.7rem] font-medium text-indigo-400"> /yr</span>
              </div>
              <div className="text-[0.62rem] text-gray-500">market-implied FCF growth ({c.horizon}y)</div>
            </div>
            <div>
              <div className="text-[1.4rem] font-extrabold leading-none text-gray-700 tabular-nums">
                {c.histFcf != null ? fmtPct(c.histFcf) : c.revCagr != null ? fmtPct(c.revCagr) : '—'}
                <span className="text-[0.7rem] font-medium text-gray-400"> /yr</span>
              </div>
              <div className="text-[0.62rem] text-gray-500">
                {c.histFcf != null ? 'its actual FCF growth (history)' : 'its revenue growth (proxy)'}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[0.72rem] leading-relaxed text-gray-600">
            At {fmtPrice(price)}, the price assumes free cash flow compounds{' '}
            {c.implied != null ? `about ${fmtPct(c.implied)}/yr` : 'at a rate we can’t solve'} for {c.horizon} years.
            {c.histFcf != null && c.implied != null && c.histFcf > 0 && (
              <> That’s ~{(c.implied / c.histFcf).toFixed(1)}× its own recent track record — you decide if that’s realistic.</>
            )}
          </p>
        </div>
      )}

      {/* ── Margin-of-safety band (forward DCF scenarios) ── */}
      {active.has('forward_dcf') && c.base?.perShare != null && (
        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[0.7rem] font-semibold text-gray-700">Scenario value per share</span>
            <span className="text-[0.62rem] text-gray-400">
              base {fmtPrice(c.base.perShare)} · price {fmtPrice(price)}
              {marginOfSafety(c.base.perShare, price) != null &&
                ` · ${fmtPct(marginOfSafety(c.base.perShare, price))} margin`}
            </span>
          </div>
          <div className="relative h-9">
            {/* bear→bull track */}
            <div
              className="absolute top-4 h-1.5 rounded-full bg-gradient-to-r from-rose-200 via-slate-200 to-emerald-200"
              style={{ left: `${pos(c.bear?.perShare)}%`, right: `${100 - pos(c.bull?.perShare)}%` }}
            />
            {[['bear', c.bear?.perShare], ['base', c.base?.perShare], ['bull', c.bull?.perShare]].map(
              ([k, x]) => (
                <div
                  key={k as string}
                  className="absolute top-2.5 -translate-x-1/2 text-center"
                  style={{ left: `${pos(x as number)}%` }}
                >
                  <span className="block h-3 w-px bg-slate-400" />
                  <span className="text-[0.58rem] text-gray-400">{k}</span>
                </div>
              ),
            )}
            {/* price marker */}
            {price != null && (
              <div className="absolute top-0 -translate-x-1/2" style={{ left: `${pos(price)}%` }}>
                <span className="block h-5 w-0.5 bg-indigo-600" />
                <span className="text-[0.58rem] font-semibold text-indigo-600">price</span>
              </div>
            )}
          </div>
          <div className="mt-1 flex justify-between text-[0.6rem] tabular-nums text-gray-400">
            <span>{fmtPrice(c.bear?.perShare)}</span>
            <span>{fmtPrice(c.bull?.perShare)}</span>
          </div>
          {c.base.tvShareOfPv > 0.75 && (
            <p className="mt-1 text-[0.62rem] text-amber-600">
              ⚠ {fmtPct(c.base.tvShareOfPv)} of value is the terminal value — the result leans heavily
              on assumptions about the distant future.
            </p>
          )}
        </div>
      )}

      {/* ── Multiples + sanity yields ── */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {active.has('multiples_pe') && <Stat label="P/E fair value" value={fmtPrice(c.mult.pe)} sub={`peer ${data.peer_context.medians.pe?.toFixed(1) ?? '—'}× × EPS`} />}
        {active.has('multiples_ps') && <Stat label="P/S fair value" value={fmtPrice(c.mult.ps)} sub={`peer ${data.peer_context.medians.ps?.toFixed(1) ?? '—'}× × rev/sh`} />}
        {active.has('multiples_ev_ebitda') && <Stat label="EV/EBITDA fair value" value={fmtPrice(c.mult.evEbitda)} sub={`peer ${data.peer_context.medians.ev_ebitda?.toFixed(1) ?? '—'}×`} />}
        {active.has('multiples_pfcf') && <Stat label="P/FCF fair value" value={fmtPrice(c.mult.pfcf)} sub={c.mult.pfcfMult ? `peer ${c.mult.pfcfMult.toFixed(1)}×` : '—'} />}
        {c.earnYield != null && <Stat label="Earnings yield" value={fmtPct(c.earnYield)} sub="EPS / price" />}
        {c.fcfYield != null && <Stat label="FCF yield" value={fmtPct(c.fcfYield)} sub="FCF/sh / price" />}
        {active.has('graham') && c.graham != null && <Stat label="Graham number" value={fmtPrice(c.graham)} sub="√(22.5·EPS·BV/sh)" />}
      </div>

      {/* ── Sliders ── */}
      <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {data.assumptions.map((a) => (
          <Slider
            key={a.key}
            label={a.label}
            value={eff(a.key)}
            seed={a.seed}
            min={a.min}
            max={a.max}
            step={a.step}
            unit={a.unit}
            source={a.seed_source}
            onChange={(v) => setOv((o) => ({ ...o, [a.key]: v }))}
          />
        ))}
      </div>
      {Object.keys(ov).length > 0 && (
        <button
          type="button"
          onClick={() => setOv({})}
          className="mt-2 text-[0.66rem] font-medium text-indigo-600 hover:text-indigo-800"
        >
          ↺ Reset all to data-seeded
        </button>
      )}

      {/* ── suppression reasons ── */}
      {data.applicability.reasons.length > 0 && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          {data.applicability.reasons.map((rsn, i) => (
            <p key={i} className="text-[0.68rem] leading-relaxed text-gray-500">
              • {rsn}
            </p>
          ))}
        </div>
      )}

      {/* ── inputs & sources (verifiability) ── */}
      <button
        type="button"
        onClick={() => setShowWork((s) => !s)}
        className="mt-4 text-[0.7rem] font-semibold text-gray-600 hover:text-gray-900"
      >
        {showWork ? '▾' : '▸'} Inputs & sources ({data.inputs.length})
      </button>
      {showWork && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[0.68rem]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-400">
                <th className="py-1 pr-2 font-medium">Input</th>
                <th className="py-1 pr-2 text-right font-medium">Value</th>
                <th className="py-1 pr-2 font-medium">Source</th>
                <th className="py-1 font-medium">As of</th>
              </tr>
            </thead>
            <tbody>
              {data.inputs.map((i) => (
                <tr key={i.key} className="border-b border-gray-100 align-top">
                  <td className="py-1 pr-2 text-gray-700">
                    <span className="mr-1 inline-block"><QualityDot status={i.quality.status} /></span>
                    {i.label}
                    {i.quality.flags.length > 0 && (
                      <div className="text-[0.58rem] text-amber-600">{i.quality.flags[0]}</div>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-gray-900">
                    {i.value == null
                      ? '—'
                      : i.unit === 'ratio'
                        ? fmtPct(i.value)
                        : i.unit === 'shares'
                          ? fmtMoney(i.value).replace('$', '')
                          : i.unit === 'usd_per_share'
                            ? fmtPrice(i.value)
                            : fmtMoney(i.value)}
                  </td>
                  <td className="py-1 pr-2 text-gray-400">{sourceText(i)}</td>
                  <td className="py-1 text-gray-400">{i.as_of_date ? fmtDate(i.as_of_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[0.62rem] leading-relaxed text-gray-400">{data.disclaimer}</p>
    </section>
  )
}
