import { useQuery } from '@tanstack/react-query'

import { getLiveFactors } from '@/lib/api'
import type { FactorKey } from '@/lib/constants'
import type { FactorPctls } from '@/lib/factorReading'
import type { LiveFactorsResponse, SecurityHeader } from '@/types/api'

// Value & Momentum move intraday with price; the composite follows. Growth &
// Quality are filing-driven and never live-adjust (mirrors engine.live_factors
// and the Factors-pane tiles).
const LIVE_KEYS = new Set<FactorKey>(['composite', 'value', 'momentum'])
const MOVE_EPS = 0.1 // only treat a live value as "moved" past this delta
const KEYS: FactorKey[] = ['composite', 'growth', 'value', 'quality', 'momentum']

export interface EffectiveFactors {
  /** Live-adjusted mode active: a fresh (non-stale) price applied to real scores. */
  isLive: boolean
  /** The per-factor value the WHOLE deep-dive should display — live where it
   *  moved, nightly otherwise. Identical to the nightly header when not live. */
  pctls: FactorPctls
  /** Which factors are currently showing a moved (live-adjusted) value. */
  moved: Record<FactorKey, boolean>
  /** Live universe rank (matches the screener's live #) when live, else null. */
  rank: number | null
  rankTotal: number | null
  /** Raw response for callers that also need price / as_of / the nightly pair. */
  data: LiveFactorsResponse | undefined
}

function nightlyPctls(h: SecurityHeader): FactorPctls {
  return {
    composite: h.composite,
    growth: h.growth_pctl,
    value: h.value_pctl,
    quality: h.quality_pctl,
    momentum: h.momentum_pctl,
  }
}

/**
 * Single shared live-factors read for the deep-dive. Every score surface — the
 * header stamp/gauge/rank, the factor tiles, "what drives the composite", and
 * the score breakdown — calls this with the SAME react-query key
 * (`['live-factors', ticker]`), so they all display one consistent number:
 * live-adjusted when a fresh price has moved Value/Momentum (and the composite),
 * nightly otherwise. Growth & Quality always stay at the nightly score.
 */
export function useEffectiveFactors(ticker: string, header: SecurityHeader): EffectiveFactors {
  const { data } = useQuery({
    queryKey: ['live-factors', ticker],
    queryFn: () => getLiveFactors(ticker),
    staleTime: 60 * 1000,
    // Keep refreshing only while a live (non-stale) adjustment is in effect.
    refetchInterval: (q) => (q.state.data?.live && !q.state.data.stale ? 90 * 1000 : false),
  })

  const isLive = Boolean(data?.live && !data?.stale && data?.has_scores)
  const nightly = nightlyPctls(header)
  const liveSet = isLive ? (data?.live_factors ?? null) : null

  const pctls: FactorPctls = { ...nightly }
  const moved: Record<FactorKey, boolean> = {
    composite: false,
    growth: false,
    value: false,
    quality: false,
    momentum: false,
  }
  if (liveSet) {
    for (const k of KEYS) {
      if (!LIVE_KEYS.has(k)) continue
      const lv = liveSet[k]
      const ng = nightly[k]
      if (lv != null && ng != null && Math.abs(lv - ng) >= MOVE_EPS) {
        pctls[k] = lv
        moved[k] = true
      }
    }
  }

  return {
    isLive,
    pctls,
    moved,
    rank: isLive ? (data?.rank ?? null) : null,
    rankTotal: isLive ? (data?.rank_total ?? null) : null,
    data,
  }
}
