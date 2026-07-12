import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { getMarketPulse } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { fmtSignedPct } from '@/lib/format'
import type { MarketPulseName } from '@/types/api'

// Percentage-point gap (avg and spy are fractions, so ×100).
function pp(v: number): string {
  return `${(Math.abs(v) * 100).toFixed(1)}pp`
}

function PulseName({ label, n }: { label: string; n: MarketPulseName }) {
  return (
    <div>
      <div className="text-[0.6rem] font-bold uppercase tracking-[0.08em] text-subtle">{label}</div>
      <Link
        to={`/securities/${n.ticker}`}
        className="mt-0.5 flex items-baseline gap-1.5 hover:opacity-80"
      >
        <span className="text-[0.9rem] font-bold text-ink">{n.ticker}</span>
        <span className="text-[0.82rem] font-bold tabular-nums" style={{ color: plColor(n.r1d) }}>
          {fmtSignedPct(n.r1d)}
        </span>
      </Link>
    </div>
  )
}

/**
 * Personal Pulse — the market through the lens of the user's own watchlist:
 * equal-weight 1-day return vs SPY (last close), plus the top contributor and
 * the biggest drag. Owner-scoped (`/market/pulse`); a quiet prompt when the
 * watchlist is empty. Descriptive, not advice.
 */
export function PersonalPulse() {
  const { data } = useQuery({
    queryKey: ['market', 'pulse'],
    queryFn: getMarketPulse,
    staleTime: 5 * 60 * 1000,
  })
  if (!data) return null

  if (data.count === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-3 text-[0.82rem] text-muted">
        Your watchlist is empty.{' '}
        <Link to="/" className="font-semibold text-accent hover:text-accent">
          Add your first ticker →
        </Link>{' '}
        to see how your names moved vs the market each session.
      </div>
    )
  }

  const { avg_r1d: avg, spy_r1d: spy, top, drag } = data
  const rel = avg != null && spy != null ? avg - spy : null

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
      <div>
        <div className="text-[0.6rem] font-bold uppercase tracking-[0.08em] text-subtle">
          Your watchlist · last close
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
          <span className="text-[1.3rem] font-bold tabular-nums" style={{ color: plColor(avg) }}>
            {fmtSignedPct(avg)}
          </span>
          <span className="text-[0.76rem] text-subtle">
            vs SPY{' '}
            <span className="font-semibold" style={{ color: plColor(spy) }}>{fmtSignedPct(spy)}</span>
            {rel != null && (
              <span className={rel >= 0 ? 'text-pos' : 'text-neg'}>
                {' · '}
                {rel >= 0 ? 'ahead' : 'behind'} {pp(rel)}
              </span>
            )}
          </span>
        </div>
        <div className="text-[0.6rem] text-subtle">
          equal-weight
          {data.scored < data.count ? ` · ${data.scored} of ${data.count} priced` : ''}
        </div>
      </div>
      {top?.r1d != null && <PulseName label="Top" n={top} />}
      {drag?.r1d != null && drag.ticker !== top?.ticker && <PulseName label="Drag" n={drag} />}
    </div>
  )
}
