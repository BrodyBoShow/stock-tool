import { useMutation } from '@tanstack/react-query'
import { TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { capWeights, whatIfStats, tradesToWeights, taxForSell } from '@/components/portfolio/portfolioUi'
import type { SimTrade } from '@/components/portfolio/portfolioUi'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { runProjection } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { FORM_INPUT } from '@/lib/constants'
import { fmtPct, fmtPrice, fmtRatio, fmtSignedMoney, fmtSignedPct, DASH } from '@/lib/format'
import type {
  PortfolioAnalyticsResponse,
  PortfolioHolding,
  PortfolioSummary,
  ProjectionResponse,
} from '@/types/api'

/**
 * What-If Rebalance Simulator — right drawer (mock §4.3). The impact grid is
 * CLIENT-side (whatIfStats over the analytics 1Y returns matrix) so it updates
 * as trades are edited; the Monte Carlo rerun goes to the server. All numbers
 * are trailing-history estimates — measurements, not advice. The app never
 * executes trades; the exit is "Copy trade list".
 *
 * Mount with a changing `key` to re-seed `initialTrades` (avoids syncing
 * props→state in an effect, which the React Compiler forbids).
 */
export interface RebalanceDrawerProps {
  open: boolean
  onClose: () => void
  holdings: PortfolioHolding[]
  summary: PortfolioSummary
  analytics: PortfolioAnalyticsResponse | undefined
  initialTrades: SimTrade[]
}

const IMPACT_LABELS: Array<{
  key: 'vol' | 'beta' | 'maxDD' | 'expReturn' | 'sharpe'
  label: string
  fmt: (v: number | null) => string
  goodWhenLower: boolean
}> = [
  { key: 'vol', label: 'Volatility (annualized, 1Y est.)', fmt: fmtPct, goodWhenLower: true },
  { key: 'beta', label: 'Beta (vs benchmark)', fmt: (v) => fmtRatio(v, 2), goodWhenLower: true },
  { key: 'maxDD', label: 'Max drawdown (1Y replay)', fmt: fmtSignedPct, goodWhenLower: false },
  { key: 'expReturn', label: 'Expected return (est., shrunk)', fmt: fmtSignedPct, goodWhenLower: false },
  { key: 'sharpe', label: 'Sharpe (1Y est.)', fmt: (v) => fmtRatio(v, 2), goodWhenLower: false },
]

function tradeTotal(t: SimTrade): number {
  return t.shares > 0 && t.price > 0 ? t.shares * t.price : 0
}

export function RebalanceDrawer(props: RebalanceDrawerProps) {
  const { open, onClose, holdings, summary, analytics } = props
  const toast = useToast()
  const [trades, setTrades] = useState<SimTrade[]>(() => props.initialTrades)
  const [mc, setMc] = useState<{ base: ProjectionResponse; what: ProjectionResponse } | null>(null)

  // Esc-to-close: the effect only wires the listener; the handler acts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const bench = analytics?.benchmark ?? summary.benchmark
  const tickerOptions = useMemo(() => {
    const held = holdings.map((h) => h.ticker).filter((t): t is string => !!t)
    const extra = (analytics?.candidates ?? []).filter((t) => !held.includes(t))
    return [...held, ...extra]
  }, [holdings, analytics])

  const priceFor = (ticker: string): number => {
    const h = holdings.find((x) => x.ticker === ticker)
    return (
      analytics?.last_close?.[ticker] ??
      h?.last_price ??
      0
    )
  }

  // Weights before/after + client-side stats over the same 1Y matrix so the
  // comparison is apples-to-apples (both are trailing-window estimates).
  const derived = useMemo(() => {
    if (!analytics?.returns) return null
    const baseW = tradesToWeights(holdings, [])
    const newW = tradesToWeights(holdings, trades)
    const before = whatIfStats(baseW, analytics.returns, bench, analytics.expected ?? undefined)
    const after = whatIfStats(newW, analytics.returns, bench, analytics.expected ?? undefined)
    return { baseW, newW, before, after }
  }, [analytics, holdings, trades, bench])

  // Tax preview: FIFO over each sold holding's lots at the trade price.
  const tax = useMemo(() => {
    let lt = 0
    let st = 0
    let washRisk = false
    for (const t of trades) {
      if (t.side !== 'sell') continue
      const h = holdings.find((x) => x.ticker === t.ticker)
      if (!h || !h.lots.length || !(t.shares > 0)) continue
      const px = t.price > 0 ? t.price : priceFor(t.ticker)
      const res = taxForSell(h.lots, t.shares, px, summary.as_of)
      lt += res.lt
      st += res.st
      if (h.wash_sale_risk && res.lt + res.st < 0) washRisk = true
    }
    return { lt, st, washRisk }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, holdings, summary.as_of])

  const mcMut = useMutation({
    mutationFn: async () => {
      // capWeights: the API rejects >50 tickers; keep the largest and renormalize
      const newW = capWeights(tradesToWeights(holdings, trades))
      const [base, what] = await Promise.all([
        runProjection({ years: 10, compare_bench: bench }),
        runProjection({ years: 10, weights: newW, compare_bench: bench }),
      ])
      return { base, what }
    },
    onSuccess: setMc,
    onError: (e: Error) => toast('error', e.message),
  })

  const setTrade = (i: number, patch: Partial<SimTrade>) => {
    setTrades((ts) => ts.map((t, j) => {
      if (j !== i) return t
      const next = { ...t, ...patch }
      // repriced when the ticker changes
      if (patch.ticker && patch.price === undefined) next.price = priceFor(patch.ticker)
      return next
    }))
  }

  const copyTrades = () => {
    const lines = trades
      .filter((t) => t.shares > 0)
      .map((t) => `${t.side.toUpperCase()} ${t.shares} ${t.ticker} @ ~${fmtPrice(t.price)} (≈ ${fmtPrice(tradeTotal(t))})`)
    if (!lines.length) return
    void navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => toast('success', 'Trade list copied — place them at your broker'))
      .catch(() => toast('error', 'Could not access the clipboard'))
  }

  const sells = trades.filter((t) => t.side === 'sell').reduce((a, t) => a + tradeTotal(t), 0)
  const buys = trades.filter((t) => t.side === 'buy').reduce((a, t) => a + tradeTotal(t), 0)

  return (
    <>
      <div
        className={
          'fixed inset-0 z-40 bg-slate-900/40 transition-opacity ' +
          (open ? 'opacity-100' : 'pointer-events-none opacity-0')
        }
        onClick={onClose}
      />
      <div
        className="fixed bottom-0 right-0 top-0 z-50 w-full max-w-[860px] overflow-y-auto bg-surface shadow-2xl transition-transform duration-300 md:w-[60%]"
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* header */}
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-surface px-6 py-4">
          <div>
            <div className="text-[1rem] font-bold text-ink">What-If Rebalance Simulator</div>
            <div className="mt-0.5 text-[0.72rem] text-muted">
              Model trades before you make them — compared to a do-nothing baseline. Estimates
              from trailing history; not advice, and nothing is executed here.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 text-muted hover:text-ink"
          >
            <Icon icon={X} size={18} />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* trades editor */}
          <section>
            <div className="mb-2 text-[0.68rem] font-bold uppercase tracking-wide text-muted">
              Proposed trades
            </div>
            <div className="space-y-1.5">
              {trades.map((t, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[80px_110px_1fr_110px_110px_32px] items-center gap-2 rounded-lg bg-surface-2 p-2"
                >
                  <select
                    value={t.side}
                    onChange={(e) => setTrade(i, { side: e.target.value as SimTrade['side'] })}
                    className={FORM_INPUT + ' text-[0.74rem]'}
                  >
                    <option value="sell">Sell</option>
                    <option value="buy">Buy</option>
                  </select>
                  <select
                    value={t.ticker}
                    onChange={(e) => setTrade(i, { ticker: e.target.value })}
                    className={FORM_INPUT + ' text-[0.74rem]'}
                  >
                    {tickerOptions.map((tk) => (
                      <option key={tk} value={tk}>{tk}</option>
                    ))}
                  </select>
                  <input
                    type="number" step="any" min="0"
                    value={t.shares || ''}
                    placeholder="shares"
                    onChange={(e) => setTrade(i, { shares: Number(e.target.value) || 0 })}
                    className={FORM_INPUT + ' text-[0.74rem]'}
                  />
                  <input
                    type="number" step="any" min="0"
                    value={t.price || ''}
                    placeholder="price"
                    onChange={(e) => setTrade(i, { price: Number(e.target.value) || 0 })}
                    className={FORM_INPUT + ' text-[0.74rem]'}
                  />
                  <span className="text-right text-[0.74rem] tabular-nums text-muted">
                    {tradeTotal(t) > 0 ? fmtPrice(tradeTotal(t)) : DASH}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTrades((ts) => ts.filter((_, j) => j !== i))}
                    aria-label="Remove trade"
                    className="text-muted hover:text-neg"
                  >
                    <Icon icon={X} size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setTrades((ts) => [
                  ...ts,
                  {
                    side: 'sell',
                    ticker: tickerOptions[0] ?? '',
                    shares: 0,
                    price: priceFor(tickerOptions[0] ?? ''),
                  },
                ])
              }
              className="mt-1.5 w-full rounded-lg border border-dashed border-line py-2 text-[0.74rem] text-muted hover:border-accent hover:bg-accent-soft hover:text-accent"
            >
              + Add trade
            </button>
            {(sells > 0 || buys > 0) && (
              <p className="mt-1.5 text-[0.68rem] text-muted">
                Selling ≈ {fmtPrice(sells)} · buying ≈ {fmtPrice(buys)}
                {sells > buys + 0.5 &&
                  ` · note: the stats and Monte Carlo below describe only the remaining INVESTED positions, fully re-scaled — the ${fmtPrice(sells - buys)} of unspent sale value (cash) is not modeled`}
                {buys > sells + 0.5 &&
                  ' · note: added purchases are modeled as reallocating today’s money to the new mix, not as new contributions'}
              </p>
            )}
          </section>

          {/* impact grid */}
          <section>
            <div className="mb-2 text-[0.68rem] font-bold uppercase tracking-wide text-muted">
              Projected impact (vs do-nothing baseline)
            </div>
            {!derived ? (
              <p className="text-[0.76rem] text-muted">
                Loading the returns matrix… (analytics unavailable — impact preview needs it)
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {IMPACT_LABELS.map(({ key, label, fmt, goodWhenLower }) => {
                  const b = derived.before[key]
                  const a = derived.after[key]
                  const delta = b != null && a != null ? a - b : null
                  const improved =
                    delta == null ? null : goodWhenLower ? delta < 0 : delta > 0
                  return (
                    <div key={key} className="rounded-lg border border-line bg-surface-2 p-3">
                      <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">
                        {label}
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-[0.78rem] tabular-nums text-muted line-through">
                          {fmt(b)}
                        </span>
                        <span className="text-subtle">→</span>
                        <span className="text-[1rem] font-bold tabular-nums text-ink">
                          {fmt(a)}
                        </span>
                        {delta != null && Math.abs(delta) > 1e-4 && (
                          <span
                            className="text-[0.7rem] font-semibold tabular-nums"
                            style={{ color: improved ? '#16a34a' : '#dc2626' }}
                          >
                            {delta > 0 ? '+' : ''}
                            {key === 'beta' || key === 'sharpe'
                              ? delta.toFixed(2)
                              : `${(delta * 100).toFixed(1)} pp`}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
                {/* tax impact */}
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">
                    Realized P/L (these sells, FIFO) — not the tax owed
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2 text-[0.85rem] font-bold tabular-nums">
                    {tax.lt === 0 && tax.st === 0 ? (
                      <span className="text-muted">no sells / no realized P/L</span>
                    ) : (
                      <>
                        <span style={{ color: plColor(tax.lt) }}>LT {fmtSignedMoney(tax.lt)}</span>
                        <span style={{ color: plColor(tax.st) }}>ST {fmtSignedMoney(tax.st)}</span>
                      </>
                    )}
                    {tax.washRisk && (
                      <span className="inline-flex items-center gap-1 rounded bg-neg-soft px-1.5 py-0.5 text-[0.64rem] font-bold text-neg">
                        <Icon icon={TriangleAlert} size={11} /> wash-sale risk (bought &lt;30d ago, selling at a loss)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            <p className="mt-1.5 text-[0.66rem] text-muted">
              Before/after both computed from your holdings&rsquo; trailing-1Y daily returns
              (same matrix, so the comparison is fair). Expected return is shrunk toward a
              ~8%/yr market prior — an estimate, not a forecast.
            </p>
          </section>

          {/* Monte Carlo rerun */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[0.68rem] font-bold uppercase tracking-wide text-muted">
                Monte Carlo — rerun with new weights (10y)
              </div>
              <button
                type="button"
                onClick={() => mcMut.mutate()}
                disabled={mcMut.isPending}
                className="rounded-lg bg-accent-solid px-3 py-1.5 text-[0.72rem] font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60"
              >
                {mcMut.isPending ? 'Running…' : 'Run cone'}
              </button>
            </div>
            {mc?.what?.terminal && mc.base?.terminal ? (
              <>
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                  <McStat
                    label="Median in 10y"
                    value={fmtK(mc.what.terminal.p50)}
                    sub={`vs ${fmtK(mc.base.terminal.p50)} do-nothing`}
                  />
                  <McStat
                    label="Range (P10–P90)"
                    value={`${fmtK(mc.what.terminal.p10)}–${fmtK(mc.what.terminal.p90)}`}
                    sub={`vs ${fmtK(mc.base.terminal.p10)}–${fmtK(mc.base.terminal.p90)}`}
                  />
                  <McStat
                    label="Median worst DD"
                    value={mc.what.max_drawdown ? `${Math.round(mc.what.max_drawdown.p50 * 100)}%` : DASH}
                    sub={mc.base.max_drawdown ? `vs ${Math.round(mc.base.max_drawdown.p50 * 100)}% do-nothing` : undefined}
                  />
                  <McStat
                    label={`Beat ${bench}`}
                    value={mc.what.benchmark ? `${Math.round(mc.what.benchmark.prob_beat * 100)}%` : DASH}
                    sub={mc.base.benchmark ? `vs ${Math.round(mc.base.benchmark.prob_beat * 100)}% do-nothing` : undefined}
                  />
                </div>
                <p className="mt-1.5 text-[0.66rem] text-muted">
                  {mc.what.excluded && mc.what.excluded.length > 0 &&
                    `Excluded (no data): ${mc.what.excluded.join(', ')}. `}
                  Classic risk-return tradeoff: compare the medians AND the drawdowns —
                  a lower median with a much shallower valley can be the better book.
                </p>
              </>
            ) : (
              <p className="text-[0.72rem] text-muted">
                Run the cone to compare 10-year outcome distributions (current vs rebalanced).
              </p>
            )}
          </section>
        </div>

        {/* footer */}
        <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-line bg-surface px-6 py-3.5">
          <button
            type="button"
            onClick={() => setTrades([])}
            className="rounded-lg border border-line px-3.5 py-2 text-[0.74rem] font-semibold text-muted hover:bg-surface-2"
          >
            Clear trades
          </button>
          <button
            type="button"
            onClick={copyTrades}
            disabled={!trades.some((t) => t.shares > 0)}
            className="rounded-lg bg-accent-solid px-3.5 py-2 text-[0.74rem] font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
            title="StockBud never places orders — copy the list and place them at your broker"
          >
            Copy trade list
          </button>
        </div>
      </div>
    </>
  )
}

function fmtK(v: number | null | undefined): string {
  if (v == null) return DASH
  return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`
}

function McStat(props: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-2.5">
      <div className="text-[0.58rem] font-semibold uppercase tracking-wide text-muted">
        {props.label}
      </div>
      <div className="mt-0.5 text-[0.9rem] font-bold tabular-nums text-ink">{props.value}</div>
      {props.sub && <div className="text-[0.62rem] tabular-nums text-muted">{props.sub}</div>}
    </div>
  )
}
