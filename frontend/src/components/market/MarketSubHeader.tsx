import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { getAlerts } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { fmtDate, fmtSignedPct } from '@/lib/format'
import type { MarketOverviewResponse } from '@/types/api'

import { useWatchlistSet } from '@/hooks/useWatchlist'
import { cacheAgeLabel } from './utils'

/** Freshness-tier chip: calm/gray, lagging/blue, stale/amber — mirrors FreshnessRow tone. */
const FRESH_TIER: Record<'current' | 'lagging' | 'stale', { label: string; cls: string }> = {
  current: { label: 'current', cls: 'bg-gray-100 text-gray-500' },
  lagging: { label: 'lagging', cls: 'bg-blue-50 text-blue-700' },
  stale: { label: 'stale', cls: 'bg-amber-50 text-amber-700' },
}

/** Thin sticky context strip that stays visible on scroll — the persistent
 * "where the market stands" read while the tiers scroll past below it. */
export function MarketSubHeader({ d, onRefresh }: { d: MarketOverviewResponse; onRefresh: () => void }) {
  const { tickers } = useWatchlistSet()
  const { data: alertsData } = useQuery({
    queryKey: ['alerts'],
    queryFn: getAlerts,
    staleTime: 60 * 1000,
  })
  const alertCount = alertsData?.triggered.length ?? 0
  const wlCount = tickers.size
  const tier = (d.freshness?.tier ?? 'current') as 'current' | 'lagging' | 'stale'
  const freshChip = FRESH_TIER[tier]
  const spy1d = d.market.spy_r1d

  // Sits BELOW the global TopNav (sticky top-0 z-30, ~56px). Offset a touch less
  // than the nav height with a lower z-index so it tucks under the nav with no
  // gap regardless of the nav's exact height, and never covers it.
  return (
    <div className="sticky top-12 z-20 -mx-4 border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/75 sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.72rem]">
        <span className="font-bold uppercase tracking-[0.1em] text-indigo-600">Market</span>

        <span className="flex items-center gap-1.5 text-slate-500">
          <span className="tabular-nums text-slate-700">{fmtDate(d.as_of)}</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.06em] ${freshChip.cls}`}>
            {freshChip.label}
          </span>
        </span>

        {d.read?.state && (
          <>
            <span className="text-gray-300" aria-hidden>·</span>
            <span className="font-semibold text-slate-700">{d.read.state}</span>
          </>
        )}

        {spy1d != null && (
          <>
            <span className="text-gray-300" aria-hidden>·</span>
            <span className="flex items-center gap-1 text-slate-500">
              SPY
              <span className="font-bold tabular-nums" style={{ color: plColor(spy1d) }}>{fmtSignedPct(spy1d)}</span>
            </span>
          </>
        )}

        <span className="text-gray-300" aria-hidden>·</span>
        {wlCount > 0 ? (
          <Link to="/watchlist" className="flex items-center gap-1 font-semibold text-slate-600 hover:text-indigo-600">
            Watchlist
            <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-indigo-50 px-1 text-[0.6rem] font-bold text-indigo-600">
              {wlCount}
            </span>
          </Link>
        ) : (
          <Link to="/watchlist" className="font-semibold text-slate-400 hover:text-indigo-600">＋ Watchlist</Link>
        )}

        {alertCount > 0 && (
          <>
            <span className="text-gray-300" aria-hidden>·</span>
            <Link to="/alerts" className="flex items-center gap-1 font-semibold text-slate-600 hover:text-indigo-600">
              Alerts
              <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[0.6rem] font-bold text-white">
                {alertCount}
              </span>
            </Link>
          </>
        )}

        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
          title="Refresh market data (r)"
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 5.5A6.5 6.5 0 1 0 17 10M17 4v3h-3" />
          </svg>
          <span className="tabular-nums">updated {cacheAgeLabel(d.cache_age_seconds)}</span>
        </button>
      </div>
    </div>
  )
}
