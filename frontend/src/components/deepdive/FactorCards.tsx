import { useQuery } from '@tanstack/react-query'

import { getLiveFactors } from '@/lib/api'
import { FACTOR_TABLE, isCommoditySensitive, type FactorKey } from '@/lib/constants'
import { DASH } from '@/lib/format'
import type { FactorSet, SecurityHeader } from '@/types/api'

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
}: {
  header: SecurityHeader
  ticker: string
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
  const changePct =
    data?.price != null && header.last_price != null && header.last_price > 0
      ? (data.price / header.last_price - 1) * 100
      : null
  const commodity = isCommoditySensitive(header.sector)

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
            <span className="text-[0.72rem] text-[#94a3b8]">
              from ${data.price.toFixed(2)}
              {changePct != null && changePct !== 0 && (
                <span
                  className={
                    'ml-1 font-semibold ' +
                    (changePct > 0 ? 'text-[#059669]' : 'text-[#dc2626]')
                  }
                >
                  {changePct > 0 ? '▲' : '▼'}
                  {Math.abs(changePct).toFixed(1)}%
                </span>
              )}{' '}
              · ~15-min delayed · Growth & Quality stay nightly
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
                (dark ? 'border-[#0f172a]' : 'border-[#e5e7eb] bg-white')
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
                    (dark ? 'text-[#94a3b8]' : 'text-[#6b7280]')
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
                      ? 'text-[#64748b]'
                      : 'text-[#9ca3af]'
                    : dark
                      ? 'text-white'
                      : 'text-[#111827]')
                }
              >
                {v === null ? DASH : v.toFixed(1)}
              </div>
              <div
                className={
                  'h-[7px] overflow-hidden rounded-full ' +
                  (dark ? 'bg-white/15' : 'bg-[#f3f4f6]')
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
                    (dark ? 'text-[#94a3b8]' : 'text-[#9ca3af]')
                  }
                >
                  <span
                    className={
                      live > nightly ? 'text-[#059669]' : 'text-[#dc2626]'
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
                    (dark ? 'text-[#94a3b8]' : 'text-[#9ca3af]')
                  }
                >
                  {v === null ? 'n/a' : `Top ${Math.max(1, Math.round(100 - v))}%`}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
