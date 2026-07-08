import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ErrorCard } from '@/components/ErrorCard'
import { DisclaimerChip } from '@/components/portfolio/redesign/DisclaimerChip'
import { ExploreChips } from '@/components/portfolio/redesign/ExploreChips'
import { NextActionCTA } from '@/components/portfolio/redesign/NextActionCTA'
import { Skeleton } from '@/components/ui/skeleton'
import { WatchlistChanges } from '@/components/WatchlistChanges'
import { StalenessNudge } from '@/components/watchlist/StalenessNudge'
import { WatchlistHero, type WatchlistHeroView } from '@/components/watchlist/WatchlistHero'
import { WatchlistTable } from '@/components/WatchlistTable'
import { getWatchlist, getWatchlistChanges } from '@/lib/api'
import type { WatchlistChange } from '@/types/api'

/** How "active" a change is (same weighting the WatchlistChanges cards use):
 *  review due > new 8-Ks > news spike > insider buys > rank move. 0 = quiet. */
function activityScore(c: WatchlistChange): number {
  let s = 0
  if (c.review_due) s += 1000
  s += c.new_events * 100
  if (c.news_spike) s += 75
  if (c.insider_buy_count > 0) s += 50
  if (c.rank != null && c.rank_prior != null) s += Math.abs(c.rank_prior - c.rank)
  return s
}

/** Plain-English one-liner for the single most-notable change (hero + CTA copy).
 *  Branch order MUST match activityScore's weighting so the headline describes
 *  the signal that actually made this the top name. */
function changeHeadline(c: WatchlistChange): string {
  if (c.review_due) return 'a thesis review is due'
  if (c.new_events > 0) {
    return `${c.new_events} new 8-K${c.new_events > 1 ? 's' : ''}${
      c.latest_event_label ? ` · ${c.latest_event_label}` : ''
    }`
  }
  // News-coverage volume is context, not a signal (GDELT, name-matched) — say so.
  if (c.news_spike) return 'a jump in news coverage (context, not a signal)'
  if (c.insider_buy_count > 0) {
    return `${c.insider_buy_count} insider buy${c.insider_buy_count > 1 ? 's' : ''} (3m)`
  }
  if (c.rank != null && c.rank_prior != null && c.rank !== c.rank_prior) {
    // rank_prior − rank > 0 means it climbed (a lower rank number is better)
    return `rank ${c.rank_prior - c.rank > 0 ? 'up' : 'down'} to #${c.rank}`
  }
  return 'a score move'
}

export function WatchlistPage() {
  const navigate = useNavigate()
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    staleTime: 5 * 60 * 1000,
  })

  // "What changed" digest — recent rank/score moves, 8-Ks, insider buys, review
  // due. Live-quote-backed, so refetch on a short cadence like the screener.
  const { data: changes } = useQuery({
    queryKey: ['watchlist', 'changes'],
    queryFn: getWatchlistChanges,
    staleTime: 60 * 1000,
    refetchInterval: 90 * 1000,
    refetchOnWindowFocus: true,
  })

  const rows = data?.rows ?? []

  // Hero view model: total watched, how many moved, and the single most-active
  // name (for the headline + the one CTA). Derived from the digest already
  // fetched — no extra request.
  const hero = useMemo<WatchlistHeroView>(() => {
    const active = (changes?.rows ?? []).filter((c) => activityScore(c) > 0)
    const top = [...active].sort((a, b) => activityScore(b) - activityScore(a))[0]
    return {
      total: rows.length,
      // cap at total: the two queries have different refetch cadences, so a
      // transient stale window must never read a nonsensical attention > total
      attention: Math.min(active.length, rows.length),
      loading: changes === undefined,
      top: top ? { ticker: top.ticker, line: changeHeadline(top) } : null,
    }
  }, [changes, rows.length])

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-[280px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  // ── empty state ────────────────────────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-extrabold text-slate-900">Watchlist</h1>
        <div className="rounded-card border border-dashed border-slate-300 bg-white/60 p-10 text-center shadow-card">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-[1.3rem] text-amber-500">
            ★
          </div>
          <p className="mt-3 text-sm font-semibold text-gray-700">No saved names yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[0.82rem] text-gray-400">
            Tap the star on any row in the screener — or the “Add to watchlist”
            button on a deep dive — to start tracking it here.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-indigo-700"
          >
            Browse the screener
          </Link>
        </div>
      </div>
    )
  }

  const scrollToGrid = () =>
    document.getElementById('watchlist-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // Three states — never assert "quiet" (and never send the user away) while the
  // digest is still loading: fall back to a calm, always-valid action.
  const cta = hero.loading
    ? {
        intent: 'info' as const,
        message: 'Checking your watched names for overnight updates…',
        ctaLabel: 'See your names',
        onCta: scrollToGrid,
      }
    : hero.top
      ? {
          intent: 'primary' as const,
          message: `${hero.top.ticker} has the most movement on your radar — ${hero.top.line}.`,
          ctaLabel: `Review ${hero.top.ticker}`,
          onCta: () => navigate(`/securities/${hero.top!.ticker}`),
        }
      : {
          intent: 'primary' as const,
          message: 'Your watched names are quiet — a good moment to hunt for new candidates.',
          ctaLabel: 'Find ideas on the Screener',
          onCta: () => navigate('/'),
        }

  return (
    <div className="space-y-5">
      {/* Zone A — summary + one next-action */}
      <WatchlistHero view={hero} />
      <NextActionCTA {...cta} />

      {/* Zone B — what moved, prune nudges, then the full sortable grid */}
      {changes && changes.rows.length > 0 && <WatchlistChanges rows={changes.rows} />}
      <StalenessNudge rows={rows} />
      <div id="watchlist-grid">
        <WatchlistTable rows={rows} />
      </div>

      {/* Zone C — explore next + the single disclaimer */}
      <div className="flex flex-col gap-3 border-t border-slate-100 pt-4">
        <ExploreChips
          ariaLabel="Explore other tabs"
          chips={[
            { label: 'Open the Screener', to: '/' },
            { label: 'Portfolio', to: '/portfolio' },
            { label: 'Market', to: '/market' },
          ]}
        />
        <DisclaimerChip
          variant="footer"
          text="Not investment advice — tracking & analytics on the names you're watching. StockBud never places orders."
        />
      </div>
    </div>
  )
}
