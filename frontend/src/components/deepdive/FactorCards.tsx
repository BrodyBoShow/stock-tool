import { useQuery } from '@tanstack/react-query'

import { Sparkline } from '@/components/screener/Sparkline'
import { getLiveFactors } from '@/lib/api'
import { FACTOR_TABLE, isCommoditySensitive, type FactorKey } from '@/lib/constants'
import {
  compositeContributions,
  factorAgreement,
  isValueTrap,
  type FactorPctls,
} from '@/lib/factorReading'
import { DASH } from '@/lib/format'
import type { FactorSet, PricePoint, SecurityHeader } from '@/types/api'

/** Local clock for an epoch-seconds timestamp (the live quote's as-of time). */
function fmtClock(epoch: number | null | undefined): string | null {
  if (epoch == null) return null
  return new Date(epoch * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

const ORDER: Array<{ key: FactorKey; label: string }> = [
  { key: 'composite', label: 'Composite' },
  { key: 'growth', label: 'Growth' },
  { key: 'value', label: 'Value' },
  { key: 'quality', label: 'Quality' },
  { key: 'momentum', label: 'Momentum' },
]

// Factors whose percentile moves with intraday price (Growth & Quality are
// filing-driven, so they're never live-adjusted — mirrors engine.live_factors).
const LIVE_KEYS = new Set<FactorKey>(['composite', 'value', 'momentum'])

function nightlyOf(header: SecurityHeader, key: FactorKey): number | null {
  switch (key) {
    case 'composite':
      return header.composite
    case 'growth':
      return header.growth_pctl
    case 'value':
      return header.value_pctl
    case 'quality':
      return header.quality_pctl
    case 'momentum':
      return header.momentum_pctl
  }
}

function liveOf(set: FactorSet | null, key: FactorKey): number | null {
  if (!set) return null
  return set[key]
}

export function FactorCards({
  header,
  ticker,
  prices,
}: {
  header: SecurityHeader
  ticker: string
  prices?: PricePoint[]
}) {
  const { data } = useQuery({
    queryKey: ['live-factors', ticker],
    queryFn: () => getLiveFactors(ticker),
    staleTime: 60 * 1000,
    // Refresh while a live (non-stale) adjustment is in effect — i.e. the
    // market is moving the price. When closed/stale it settles and stops.
    refetchInterval: (q) =>
      q.state.data?.live && !q.state.data.stale ? 90 * 1000 : false,
  })

  const isLive = Boolean(data?.live && !data?.stale && data?.has_scores)
  const clock = fmtClock(data?.as_of_epoch)
  // Recent price action that drives the live momentum adjustment (context only).
  const recentPx = (prices ?? [])
    .slice(-20)
    .map((p) => p.adj_close ?? p.close)
    .filter((x): x is number => x != null)
  const changePct =
    data?.price != null && header.last_price != null && header.last_price > 0
      ? (data.price / header.last_price - 1) * 100
      : null
  const commodity = isCommoditySensitive(header.sector)

  // Transparency readout (Phase 1) — computed from the nightly score the user
  // sees. Descriptive only; nothing here re-ranks the stock.
  const pctls: FactorPctls = {
    composite: header.composite,
    growth: header.growth_pctl,
    value: header.value_pctl,
    quality: header.quality_pctl,
    momentum: header.momentum_pctl,
  }
  const trap = isValueTrap(pctls)
  const agree = factorAgreement(pctls)
  const contrib = compositeContributions(pctls, header.details?.weights)

  return (
    <div>
      {commodity && (
        <div
          className="mb-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.78rem] text-amber-800"
          title={
            `${header.sector} names are commodity-price-driven: Value, Momentum and ` +
            `even Quality move with the underlying commodity (e.g. oil). A high rank ` +
            `reflects the recent commodity trend, not durability.`
          }
        >
          <span className="mt-px flex-none">⚠</span>
          <span>
            <span className="font-semibold">Commodity-sensitive score.</span> This{' '}
            {header.sector} name&rsquo;s factors ride commodity prices. Read the
            catalyst (oil, filings, events), not just the rank.
          </span>
        </div>
      )}
      {trap && (
        <div
          className="mb-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.78rem] text-amber-800"
          title={
            `Value ${header.value_pctl?.toFixed(0)} · Quality ${header.quality_pctl?.toFixed(0)} · ` +
            `Momentum ${header.momentum_pctl?.toFixed(0)}. A cheap valuation paired with weak quality ` +
            `and weak price trend is the classic "value trap" — the market may be pricing in real ` +
            `deterioration. This is a caveat to investigate, not a sell signal.`
          }
        >
          <span className="mt-px flex-none">⚠</span>
          <span>
            <span className="font-semibold">Cheap, but weak on quality and momentum.</span> Worth
            checking <em>why</em> it&rsquo;s cheap before treating the Value rank as a bargain —
            value (≥{75}) with weak quality &amp; momentum (≤{33}) is often cheap for a reason.
          </span>
        </div>
      )}
      {isLive && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[0.72rem] font-semibold text-sky-700"
            title={
              `Value & Momentum (and the composite) are recomputed from the ` +
              `latest price (~15-min delayed) against last night's cross-section. ` +
              `Growth & Quality are filing-driven, so they stay at the nightly score.`
            }
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-sky-500"
              style={{ animation: 'ckpulse 2s ease-in-out infinite' }}
            />
            Live-adjusted scores
          </span>
          {data?.price != null && (
            <span className="text-[0.72rem] text-slate-400">
              from ${data.price.toFixed(2)}
              {changePct != null && changePct !== 0 && (
                <span
                  className={
                    'ml-1 font-semibold ' +
                    (changePct > 0 ? 'text-emerald-600' : 'text-red-600')
                  }
                >
                  {changePct > 0 ? '▲' : '▼'}
                  {Math.abs(changePct).toFixed(1)}%
                </span>
              )}{' '}
              · ~15-min delayed · Growth & Quality stay nightly
            </span>
          )}
          {clock && (
            <span className="text-[0.72rem] text-slate-400">as of {clock}</span>
          )}
          {recentPx.length >= 2 && (
            <span
              className="inline-flex items-center gap-1 text-[0.66rem] text-slate-400"
              title="Adjusted close over the last 20 sessions — the price trend behind the live Momentum adjustment, not the momentum percentile itself."
            >
              <Sparkline data={recentPx} width={60} height={16} />
              price · 20d
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        {ORDER.map(({ key, label }) => {
          const nightly = nightlyOf(header, key)
          const live = isLive ? liveOf(data?.live_factors ?? null, key) : null
          const adjustable = LIVE_KEYS.has(key)
          // Show the live value when it meaningfully differs from nightly.
          const moved =
            adjustable &&
            live != null &&
            nightly != null &&
            Math.abs(live - nightly) >= 0.1
          const v = moved ? live : nightly
          const dark = key === 'composite'
          const bar = FACTOR_TABLE[key].bar
          return (
            <div
              key={key}
              className={
                'rounded-card border p-4 shadow-card ' +
                (dark ? 'border-slate-900' : 'border-gray-200 bg-white')
              }
              style={
                dark
                  ? { background: 'linear-gradient(135deg, #0f172a, #1e293b)' }
                  : undefined
              }
            >
              <div className="flex items-center justify-between">
                <div
                  className={
                    'text-[0.78rem] font-bold uppercase tracking-[0.04em] ' +
                    (dark ? 'text-slate-400' : 'text-gray-500')
                  }
                >
                  {label}
                </div>
                {moved && (
                  <span
                    className={
                      'rounded px-1 py-0.5 text-[0.58rem] font-bold uppercase tracking-wide ' +
                      (dark ? 'bg-sky-400/20 text-sky-300' : 'bg-sky-50 text-sky-600')
                    }
                    title="Adjusted from the latest price"
                  >
                    live
                  </span>
                )}
              </div>
              <div
                className={
                  'mb-2 mt-1 text-[1.8rem] font-extrabold ' +
                  (v === null
                    ? dark
                      ? 'text-slate-500'
                      : 'text-gray-400'
                    : dark
                      ? 'text-white'
                      : 'text-gray-900')
                }
              >
                {v === null ? DASH : v.toFixed(1)}
              </div>
              <div
                className={
                  'h-[7px] overflow-hidden rounded-full ' +
                  (dark ? 'bg-white/15' : 'bg-gray-100')
                }
              >
                {v !== null && (
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, v))}%`,
                      background: dark ? '#fff' : bar,
                    }}
                  />
                )}
              </div>
              {moved && nightly != null && live != null ? (
                <div
                  className={
                    'mt-[7px] text-[0.72rem] ' +
                    (dark ? 'text-slate-400' : 'text-gray-400')
                  }
                >
                  <span
                    className={
                      live > nightly ? 'text-emerald-600' : 'text-red-600'
                    }
                  >
                    {live > nightly ? '▲' : '▼'}
                    {Math.abs(live - nightly).toFixed(1)}
                  </span>{' '}
                  from {nightly.toFixed(1)} nightly
                </div>
              ) : (
                <div
                  className={
                    'mt-[7px] text-[0.72rem] ' +
                    (dark ? 'text-slate-400' : 'text-gray-400')
                  }
                >
                  {v === null ? 'n/a' : `Top ${Math.max(1, Math.round(100 - v))}%`}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {header.composite != null && contrib.parts.length > 0 && (
        <div className="mt-3 rounded-card border border-gray-200 bg-white p-3.5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-gray-500">
              What drives the composite
            </span>
            <span
              className="text-[0.7rem] text-gray-400"
              title={
                `${agree.strong} of ${agree.total} scored factors sit at or above the ` +
                `${agree.threshold}th percentile. Descriptive only — broad agreement is not a ` +
                `backtested edge, and a single strong factor (often Value) can outrank it. ` +
                `${agree.threshold} is a presentation cutoff, not tuned on returns.`
              }
            >
              {agree.strong}/{agree.total} factors ≥ {agree.threshold}
              {agree.strongNames.length > 0 ? ` · ${agree.strongNames.join(' + ')}` : ''}
            </span>
          </div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-gray-100">
            {contrib.parts.map((p) => (
              <div
                key={p.key}
                style={{ width: `${p.share * 100}%`, background: FACTOR_TABLE[p.key].bar }}
                title={
                  `${p.label}: ${(p.share * 100).toFixed(0)}% of the weight × ${p.pctl.toFixed(0)} ` +
                  `pctl = ${p.points.toFixed(1)} pts of the composite`
                }
              />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {contrib.parts.map((p) => (
              <span key={p.key} className="flex items-center text-[0.68rem] text-gray-500">
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-sm"
                  style={{ background: FACTOR_TABLE[p.key].bar }}
                />
                {p.label} {(p.share * 100).toFixed(0)}%{' '}
                <span className="ml-0.5 text-gray-400">({p.pctl.toFixed(0)})</span>
              </span>
            ))}
          </div>
          {contrib.absent.length > 0 && (
            <div className="mt-1.5 text-[0.68rem] text-gray-400">
              {contrib.absent.map((a) => a.label).join(', ')} absent — its weight was
              redistributed across the scored factors.
            </div>
          )}
          <div className="mt-1 text-[0.66rem] text-gray-400">
            Weighted blend of the percentile ranks — segments are each factor&rsquo;s share of the
            renormalized weight; the number in parentheses is its percentile.
          </div>
        </div>
      )}
    </div>
  )
}
