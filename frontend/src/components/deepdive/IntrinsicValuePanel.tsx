import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useToast } from '@/components/ui/Toast'
import { getValuation } from '@/lib/api'
import { fmtDate, fmtMoney, fmtPct, fmtPrice } from '@/lib/format'
import {
  deleteScenario,
  getScenarios,
  ovFromString,
  ovToString,
  saveScenario,
  type Scenario,
} from '@/lib/scenarios'
import {
  forwardDcf,
  grahamNumber,
  impliedGrowth,
  marginOfSafety,
  multiplesFairValue,
} from '@/lib/valuation'
import type { ValuationInput, ValuationResponse } from '@/types/api'

// Effective assumption value: user override → data seed → 0.
function effOf(ov: Record<string, number>, seeds: Record<string, number>, k: string): number {
  return ov[k] ?? seeds[k] ?? 0
}

/** Base value/share for an arbitrary override set (used by the compare grid). */
function scenarioPerShare(
  ov: Record<string, number>,
  seeds: Record<string, number>,
  fcf0: number | null,
  netDebt: number,
  shares: number,
): number | null {
  if (fcf0 == null) return null
  return forwardDcf(fcf0, netDebt, shares, {
    gStart: effOf(ov, seeds, 'g_start'),
    r: effOf(ov, seeds, 'discount_rate'),
    gInf: effOf(ov, seeds, 'terminal_growth'),
    horizon: Math.round(effOf(ov, seeds, 'horizon')),
  }).perShare
}

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
    ok: 'bg-pos-strong',
    proxied: 'bg-warn-strong',
    stale: 'bg-warn-strong',
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

// Friendly label for "one slider step" — "+1y" for the horizon, "+0.25pt" for rates.
function fmtStep(step: number, unit: string): string {
  if (unit === 'years') return '+1y'
  return `+${parseFloat((step * 100).toFixed(2))}pt`
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-[0.62rem] uppercase tracking-wide text-subtle">{label}</div>
      <div className="mt-0.5 text-[0.95rem] font-bold text-ink tabular-nums">{value}</div>
      {sub && <div className="text-[0.62rem] text-subtle">{sub}</div>}
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
        <span className="text-[0.72rem] font-medium text-ink">{label}</span>
        <span className="flex items-center gap-1.5 text-[0.72rem] tabular-nums text-ink">
          {show(value)}
          {changed && (
            <button
              type="button"
              onClick={() => onChange(seed)}
              className="text-[0.6rem] text-muted hover:text-accent"
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
        className="mt-1 w-full accent-accent"
      />
      <div className="text-[0.6rem] text-subtle">
        {changed ? 'you set this · ' : 'seeded · '}
        {source}
      </div>
    </div>
  )
}

const CMP_DRIVERS: Array<{ key: string; label: string }> = [
  { key: 'g_start', label: 'Growth' },
  { key: 'discount_rate', label: 'Discount' },
  { key: 'terminal_growth', label: 'Terminal' },
  { key: 'horizon', label: 'Horizon' },
]

/** Side-by-side base value/share for the live edit + selected saved scenarios. */
function ComparisonGrid({
  rows,
  seeds,
  fcf0,
  netDebt,
  shares,
  price,
}: {
  rows: Array<{ id: string; name: string; ov: Record<string, number>; focal?: boolean }>
  seeds: Record<string, number>
  fcf0: number | null
  netDebt: number
  shares: number
  price: number | null
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[0.7rem]">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-subtle">
            <th className="px-2.5 py-1.5 font-semibold">Scenario</th>
            {CMP_DRIVERS.map((d) => (
              <th key={d.key} className="px-2 py-1.5 text-right font-semibold">
                {d.label}
              </th>
            ))}
            <th className="px-2.5 py-1.5 text-right font-semibold">Value/sh</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">vs price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const ps = scenarioPerShare(row.ov, seeds, fcf0, netDebt, shares)
            const mos = ps != null ? marginOfSafety(ps, price) : null
            return (
              <tr
                key={row.id}
                className={
                  'border-b border-line last:border-0 ' +
                  (row.focal ? 'bg-accent-soft' : '')
                }
              >
                <td className="px-2.5 py-1.5 font-semibold text-ink">{row.name}</td>
                {CMP_DRIVERS.map((d) => {
                  const v = effOf(row.ov, seeds, d.key)
                  return (
                    <td
                      key={d.key}
                      className="px-2 py-1.5 text-right tabular-nums text-muted"
                    >
                      {d.key === 'horizon' ? `${Math.round(v)}y` : fmtPct(v)}
                    </td>
                  )
                })}
                <td className="px-2.5 py-1.5 text-right font-bold tabular-nums text-ink">
                  {fmtPrice(ps)}
                </td>
                <td
                  className={
                    'px-2.5 py-1.5 text-right tabular-nums ' +
                    (mos != null && mos >= 0 ? 'text-pos' : 'text-neg')
                  }
                >
                  {mos != null ? fmtPct(mos) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function IntrinsicValuePanel({ ticker }: { ticker: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['valuation', ticker],
    queryFn: () => getValuation(ticker),
    staleTime: 5 * 60_000,
  })

  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  // Seed overrides from a shared ?iv=... link on first mount (one-time).
  const [ov, setOv] = useState<Record<string, number>>(() =>
    ovFromString(searchParams.get('iv')),
  )
  const [showWork, setShowWork] = useState(false)
  const [saved, setSaved] = useState<Scenario[]>(() => getScenarios(ticker))
  const [compareIds, setCompareIds] = useState<string[]>([])

  // Reset overrides + comparison + saved list when the ticker changes (the page
  // does not remount on a param change). Render-phase reset — React's sanctioned
  // "adjust state when a prop changes" pattern, not an effect.
  const [prevTicker, setPrevTicker] = useState(ticker)
  if (prevTicker !== ticker) {
    setPrevTicker(ticker)
    setOv(ovFromString(searchParams.get('iv')))
    setCompareIds([])
    setSaved(getScenarios(ticker))
  }

  const seeds = useMemo(
    () => Object.fromEntries((data?.assumptions ?? []).map((a) => [a.key, a.seed])),
    [data],
  )
  const eff = (k: string) => ov[k] ?? seeds[k] ?? 0

  const doSave = () => {
    if (Object.keys(ov).length === 0) {
      toast('error', 'Move a slider first — nothing to save yet')
      return
    }
    const name = window.prompt('Name this scenario (e.g. "Conservative")')
    if (name == null || !name.trim()) return
    setSaved(saveScenario(ticker, name, ov))
    toast('success', `Saved "${name.trim().slice(0, 40)}"`)
  }

  const doShare = async () => {
    const qs = ovToString(ov)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (qs) next.set('iv', qs)
        else next.delete('iv')
        return next
      },
      { replace: true },
    )
    const url = `${window.location.origin}${window.location.pathname}${qs ? `?iv=${encodeURIComponent(qs)}` : ''}`
    try {
      await navigator.clipboard.writeText(url)
      toast('success', 'Share link copied')
    } catch {
      toast('error', 'Link is in the address bar — copy failed')
    }
  }

  const toggleCompare = (id: string) =>
    setCompareIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 3 ? ids : [...ids, id],
    )

  const removeSaved = (id: string) => {
    setSaved(deleteScenario(ticker, id))
    setCompareIds((ids) => ids.filter((x) => x !== id))
  }

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

    // Per-driver sensitivity: bump each DCF lever by one slider step, holding the
    // rest at their current values, and measure the $/share swing off the base.
    const baseShare = base?.perShare ?? null
    const DCF_KEYS = new Set(['g_start', 'discount_rate', 'terminal_growth', 'horizon'])
    const sensitivity =
      fcf0 != null && active.has('forward_dcf') && baseShare != null
        ? (data.assumptions ?? [])
            .filter((a) => DCF_KEYS.has(a.key))
            .map((a) => {
              const p = { gStart, r, gInf, horizon }
              if (a.key === 'g_start') p.gStart = gStart + a.step
              else if (a.key === 'discount_rate') p.r = r + a.step
              else if (a.key === 'terminal_growth') p.gInf = gInf + a.step
              else if (a.key === 'horizon') p.horizon = horizon + Math.round(a.step || 1)
              const res = forwardDcf(fcf0, netDebt, shares, p)
              const delta = res.perShare != null ? res.perShare - baseShare : null
              return { key: a.key, label: a.label, step: a.step, unit: a.unit, delta }
            })
            .filter((s): s is typeof s & { delta: number } => s.delta != null && isFinite(s.delta))
            .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
        : []

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
      histFcf, revCagr, epsG, price, netDebt, horizon, sensitivity,
      fcf0, shares,
    }
  }, [data, ov]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="h-4 w-40 animate-pulse rounded bg-surface-3" />
      <div className="mt-3 h-20 animate-pulse rounded bg-surface-3" />
    </section>
  }
  if (error || !data || !computed) {
    return <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h3 className="text-sm font-bold text-ink">Intrinsic value</h3>
      <p className="mt-2 text-[0.8rem] text-muted">Valuation inputs are unavailable for this name.</p>
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
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Intrinsic value</h3>
        <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-warn">
          Not investment advice
        </span>
      </div>
      <p className="mt-1 text-[0.72rem] text-muted">
        Your assumptions, transparent math — every input below shows its filing source and date.
        {' '}
        {data.peer_context.n > 0 && `Peers: ${data.peer_context.n} ${data.sector} names.`}
      </p>

      {/* Foreign filer: financials were converted to USD. Disclose the currency,
          rate, and rate date HERE, next to the figures — not buried in the reasons. */}
      {data.fx && data.currency !== 'USD' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border border-info bg-info-soft px-2.5 py-1.5 text-[0.68rem] text-sky-800">
          <span className="font-semibold">Reports in {data.currency}</span>
          <span className="text-info">·</span>
          <span>
            figures shown in USD, converted at 1 {data.currency} = {data.fx.usd_per_unit} USD
          </span>
          {data.fx.rate_date && (
            <>
              <span className="text-info">·</span>
              <span>FRED daily rate {data.fx.rate_date}</span>
            </>
          )}
        </div>
      )}

      {/* ── Headline: reverse-DCF (market-implied growth vs history) ── */}
      {active.has('reverse_dcf') && (
        <div className="mt-4 rounded-lg border border-accent bg-accent-soft p-3">
          <div className="text-[0.62rem] font-semibold uppercase tracking-wide text-accent">
            What growth is priced in?
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[1.4rem] font-extrabold leading-none text-accent tabular-nums">
                {c.implied == null
                  ? '—'
                  : c.implied <= -0.2
                    ? '≤ −20%'
                    : c.implied >= 0.4
                      ? '≥ +40%'
                      : fmtPct(c.implied)}
                <span className="text-[0.7rem] font-medium text-accent"> /yr</span>
              </div>
              <div className="text-[0.62rem] text-muted">market-implied FCF growth ({c.horizon}y)</div>
            </div>
            <div>
              <div className="text-[1.4rem] font-extrabold leading-none text-ink tabular-nums">
                {c.histFcf != null ? fmtPct(c.histFcf) : c.revCagr != null ? fmtPct(c.revCagr) : '—'}
                <span className="text-[0.7rem] font-medium text-subtle"> /yr</span>
              </div>
              <div className="text-[0.62rem] text-muted">
                {c.histFcf != null ? 'its actual FCF growth (history)' : 'its revenue growth (proxy)'}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[0.72rem] leading-relaxed text-muted">
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
            <span className="text-[0.7rem] font-semibold text-ink">Scenario value per share</span>
            <span className="text-[0.62rem] text-subtle">
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
                  <span className="text-[0.58rem] text-subtle">{k}</span>
                </div>
              ),
            )}
            {/* price marker */}
            {price != null && (
              <div className="absolute top-0 -translate-x-1/2" style={{ left: `${pos(price)}%` }}>
                <span className="block h-5 w-0.5 bg-accent-solid" />
                <span className="text-[0.58rem] font-semibold text-accent">price</span>
              </div>
            )}
          </div>
          <div className="mt-1 flex justify-between text-[0.6rem] tabular-nums text-subtle">
            <span>{fmtPrice(c.bear?.perShare)}</span>
            <span>{fmtPrice(c.bull?.perShare)}</span>
          </div>
          {c.base.tvShareOfPv > 0.75 && (
            <p className="mt-1 text-[0.62rem] text-warn">
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
          className="mt-2 text-[0.66rem] font-medium text-accent hover:text-accent-hover"
        >
          ↺ Reset all to data-seeded
        </button>
      )}

      {/* ── Scenarios: save / compare (≤3) / share the current assumptions ── */}
      {active.has('forward_dcf') && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted">
              Scenarios
            </span>
            <button
              type="button"
              onClick={doSave}
              className="rounded-md border border-line bg-surface px-2.5 py-1 text-[0.7rem] font-semibold text-muted hover:bg-surface-2"
            >
              ＋ Save current
            </button>
            <button
              type="button"
              onClick={doShare}
              className="rounded-md border border-line bg-surface px-2.5 py-1 text-[0.7rem] font-semibold text-muted hover:bg-surface-2"
            >
              🔗 Share link
            </button>
            <span className="text-[0.6rem] text-subtle">
              saved on this device · share encodes your sliders in the URL
            </span>
          </div>

          {saved.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {saved.map((s) => {
                const ps = scenarioPerShare(s.ov, seeds, c.fcf0, c.netDebt, c.shares)
                const on = compareIds.includes(s.id)
                return (
                  <span
                    key={s.id}
                    className={
                      'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.68rem] ' +
                      (on
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line bg-surface text-muted')
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setOv(s.ov)}
                      className="font-semibold hover:underline"
                      title="Load these sliders"
                    >
                      {s.name}
                    </button>
                    <span className="tabular-nums text-subtle">{fmtPrice(ps)}</span>
                    <button
                      type="button"
                      onClick={() => toggleCompare(s.id)}
                      className={
                        'rounded px-1 text-[0.56rem] font-bold uppercase tracking-wide ' +
                        (on ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-muted')
                      }
                      title="Add to the comparison table (up to 3)"
                    >
                      {on ? '✓ cmp' : 'cmp'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSaved(s.id)}
                      className="text-subtle hover:text-neg"
                      title="Delete scenario"
                    >
                      ✕
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {compareIds.length > 0 && (
            <ComparisonGrid
              rows={[
                { id: '__live__', name: 'Live edit', ov, focal: true },
                ...saved
                  .filter((s) => compareIds.includes(s.id))
                  .map((s) => ({ id: s.id, name: s.name, ov: s.ov })),
              ]}
              seeds={seeds}
              fcf0={c.fcf0}
              netDebt={c.netDebt}
              shares={c.shares}
              price={price}
            />
          )}
        </div>
      )}

      {/* ── Sensitivity: which lever moves fair value most ── */}
      {c.sensitivity.length > 0 && c.base?.perShare != null && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
          <div className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted">
            Sensitivity — one step off base {fmtPrice(c.base.perShare)}/sh
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {c.sensitivity.map((s) => {
              const pct = c.base?.perShare ? s.delta / c.base.perShare : null
              const up = s.delta >= 0
              return (
                <div
                  key={s.key}
                  className="flex items-baseline justify-between gap-2 rounded-md bg-surface px-2.5 py-1.5"
                >
                  <span className="text-[0.7rem] text-muted">
                    {s.label}{' '}
                    <span className="text-[0.62rem] text-subtle">{fmtStep(s.step, s.unit)}</span>
                  </span>
                  <span
                    className={`text-[0.72rem] font-semibold tabular-nums ${up ? 'text-pos' : 'text-neg'}`}
                  >
                    {up ? '+' : '−'}
                    {fmtPrice(Math.abs(s.delta))}
                    {pct != null && (
                      <span className="ml-1 text-[0.6rem] font-normal text-subtle">
                        ({up ? '+' : '−'}
                        {fmtPct(Math.abs(pct))})
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-[0.6rem] text-subtle">
            Each row holds the other levers fixed and nudges one by a single slider step — biggest
            mover first. A local read, not a full re-solve.
          </p>
        </div>
      )}

      {/* ── suppression reasons ── */}
      {data.applicability.reasons.length > 0 && (
        <div className="mt-4 rounded-lg bg-surface-2 p-3">
          {data.applicability.reasons.map((rsn, i) => (
            <p key={i} className="text-[0.68rem] leading-relaxed text-muted">
              • {rsn}
            </p>
          ))}
        </div>
      )}

      {/* ── inputs & sources (verifiability) ── */}
      <button
        type="button"
        onClick={() => setShowWork((s) => !s)}
        className="mt-4 text-[0.7rem] font-semibold text-muted hover:text-ink"
      >
        {showWork ? '▾' : '▸'} Inputs & sources ({data.inputs.length})
      </button>
      {showWork && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[0.68rem]">
            <thead>
              <tr className="border-b border-line text-left text-subtle">
                <th className="py-1 pr-2 font-medium">Input</th>
                <th className="py-1 pr-2 text-right font-medium">Value</th>
                <th className="py-1 pr-2 font-medium">Source</th>
                <th className="py-1 font-medium">As of</th>
              </tr>
            </thead>
            <tbody>
              {data.inputs.map((i) => (
                <tr key={i.key} className="border-b border-line align-top">
                  <td className="py-1 pr-2 text-ink">
                    <span className="mr-1 inline-block"><QualityDot status={i.quality.status} /></span>
                    {i.label}
                    {i.quality.flags.length > 0 && (
                      <div className="text-[0.58rem] text-warn">{i.quality.flags[0]}</div>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-ink">
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
                  <td className="py-1 pr-2 text-subtle">{sourceText(i)}</td>
                  <td className="py-1 text-subtle">{i.as_of_date ? fmtDate(i.as_of_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[0.62rem] leading-relaxed text-subtle">{data.disclaimer}</p>
    </section>
  )
}
