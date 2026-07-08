import { Link } from 'react-router-dom'

import { SectorPill } from '@/components/screener/SectorPill'
import { Delta } from '@/components/ui/Delta'
import { fmtDate, fmtMoney } from '@/lib/format'
import type { WatchlistChange } from '@/types/api'

/** How "active" a name is, for sort-to-top within a tier: review due > new 8-Ks
 * > insider buys > a meaningful rank move. Quiet names sink to the bottom. */
function activity(c: WatchlistChange): number {
  let s = 0
  if (c.review_due) s += 1000
  s += c.new_events * 100
  if (c.news_spike) s += 75
  if (c.insider_buy_count > 0) s += 50
  if (c.rank != null && c.rank_prior != null) s += Math.abs(c.rank_prior - c.rank)
  return s
}

type Tier = 'act' | 'fyi' | 'quiet'

/** Signal triage (spec: tier act-vs-FYI to fight alert fatigue).
 *  ACT = a development that warrants a decision: a thesis review is due, a new
 *  high-signal 8-K, or insider open-market buying. FYI = ambient context that
 *  rarely needs action on its own: rank/score drift, the live intraday nudge,
 *  or a news-coverage spike (which the app treats as context, not a signal). */
function tierOf(c: WatchlistChange): Tier {
  if (c.review_due || c.new_events > 0 || c.insider_buy_count > 0) return 'act'
  const rankMoved = c.rank != null && c.rank_prior != null && c.rank !== c.rank_prior
  const compMoved =
    c.composite != null && c.composite_prior != null && c.composite !== c.composite_prior
  const liveShown =
    c.composite_live != null && c.composite != null &&
    Math.abs(c.composite_live - c.composite) >= 0.1
  if (c.news_spike || rankMoved || compMoved || liveShown) return 'fyi'
  return 'quiet'
}

const TIER_RANK: Record<Tier, number> = { act: 0, fyi: 1, quiet: 2 }

function Chip({
  tone,
  children,
}: {
  tone: 'rank' | 'live' | 'event' | 'insider' | 'review' | 'quiet' | 'news'
  children: React.ReactNode
}) {
  const styles: Record<string, string> = {
    rank: 'border-gray-200 bg-slate-50 text-slate-700',
    live: 'border-sky-200 bg-sky-50 text-sky-700',
    event: 'border-amber-200 bg-amber-50 text-amber-700',
    insider: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    review: 'border-amber-300 bg-amber-100 text-amber-800',
    quiet: 'border-[#eef1f6] bg-[#fafbfc] text-gray-400',
    news: 'border-violet-200 bg-violet-50 text-violet-700',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[0.74rem] font-medium ${styles[tone]}`}
    >
      {children}
    </span>
  )
}

function TierTag({ tier }: { tier: Tier }) {
  if (tier === 'act') {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-wide text-amber-800">
        Needs a look
      </span>
    )
  }
  if (tier === 'fyi') {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-wide text-slate-500">
        FYI
      </span>
    )
  }
  return null
}

function ChangeCard({ c }: { c: WatchlistChange }) {
  const tier = tierOf(c)
  const rankMove =
    c.rank != null && c.rank_prior != null ? c.rank_prior - c.rank : null // +ve = improved
  const compMove =
    c.composite != null && c.composite_prior != null ? c.composite - c.composite_prior : null
  const liveMove =
    c.composite_live != null && c.composite != null ? c.composite_live - c.composite : null
  const liveShown = liveMove != null && Math.abs(liveMove) >= 0.1

  return (
    <div
      className={
        'rounded-card border bg-white p-4 shadow-card ' +
        (tier === 'act'
          ? 'border-l-4 border-l-amber-400 border-amber-200'
          : tier === 'quiet'
            ? 'border-[#eef1f6]'
            : 'border-gray-200')
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/securities/${c.ticker}`}
              className="text-[0.95rem] font-bold text-gray-900 hover:text-indigo-600 hover:underline"
            >
              {c.ticker}
            </Link>
            {c.sector && <SectorPill sector={c.sector} />}
            <TierTag tier={tier} />
          </div>
          {c.name && (
            <div className="mt-0.5 truncate text-[0.75rem] text-gray-400">{c.name}</div>
          )}
        </div>
        <div className="flex-none text-right">
          <div className="text-[1.15rem] font-extrabold tabular-nums text-gray-900">
            {c.composite != null ? c.composite.toFixed(1) : '—'}
          </div>
          <div className="text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">
            Composite
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {/* ── ACT: developments that warrant a decision ─────────────────── */}
        {c.review_due && (
          <Link to={`/securities/${c.ticker}`}>
            <Chip tone="review">⏰ Thesis review due</Chip>
          </Link>
        )}
        {c.new_events > 0 && (
          <Chip tone="event">
            ▾ {c.new_events} new 8-K
            {c.latest_event_label ? ` · ${c.latest_event_label}` : ''}
            {c.latest_event_date ? (
              <span className="text-amber-500"> ({fmtDate(c.latest_event_date)})</span>
            ) : null}
          </Chip>
        )}
        {c.insider_buy_count > 0 && (
          <Chip tone="insider">
            ▴ Insider {c.insider_buy_count} buy{c.insider_buy_count === 1 ? '' : 's'}
            {c.insider_buy_value ? ` · ${fmtMoney(c.insider_buy_value)}` : ''} (3m)
          </Chip>
        )}

        {/* ── FYI: ambient context, rarely a standalone reason to act ────── */}
        {c.rank != null && (
          <Chip tone="rank">
            Rank #{c.rank}
            {rankMove != null && rankMove !== 0 ? (
              <>
                {' '}
                <Delta value={rankMove} />
                <span className="text-gray-400">
                  {c.baseline_date ? ` vs ${fmtDate(c.baseline_date)}` : ''}
                </span>
              </>
            ) : compMove != null && compMove !== 0 ? (
              <>
                {' '}
                <Delta value={compMove} />
              </>
            ) : (
              <span className="text-slate-300"> · trend builds nightly</span>
            )}
          </Chip>
        )}
        {liveShown && (
          <Chip tone="live">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            Live {c.composite_live!.toFixed(1)} <Delta value={liveMove!} />
          </Chip>
        )}
        {c.news_spike && (
          <Chip tone="news">
            <span
              title="Recent news coverage jumped above this name's own recent baseline (GDELT article volume, matched by company name — may catch unrelated same-name coverage). Context only, not a signal — open the name to see the headlines."
              className="cursor-help"
            >
              📰 News spike
              {c.news_ratio ? ` · ${c.news_ratio.toFixed(1)}× vs usual` : ''}
              {c.news_count != null ? ` (${c.news_count} art.)` : ''}
            </span>
          </Chip>
        )}

        {tier === 'quiet' && <Chip tone="quiet">No material changes</Chip>}
      </div>
    </div>
  )
}

export function WatchlistChanges({ rows }: { rows: WatchlistChange[] }) {
  if (rows.length === 0) return null
  const sorted = [...rows].sort(
    (a, b) => TIER_RANK[tierOf(a)] - TIER_RANK[tierOf(b)] || activity(b) - activity(a),
  )
  const actCount = rows.filter((c) => tierOf(c) === 'act').length
  const fyiCount = rows.filter((c) => tierOf(c) === 'fyi').length

  const summary =
    actCount > 0
      ? `${actCount} need${actCount === 1 ? 's' : ''} a look${fyiCount > 0 ? ` · ${fyiCount} FYI` : ''}`
      : fyiCount > 0
        ? `${fyiCount} FYI update${fyiCount === 1 ? '' : 's'}`
        : 'no material updates'

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[0.95rem] font-bold text-gray-900">What&apos;s changed</h2>
        <span className="text-right text-[0.74rem] text-gray-400">
          {summary} · rank/score vs ~1mo ago · 8-Ks &amp; insider buys recent
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {sorted.map((c) => (
          <ChangeCard key={c.security_id} c={c} />
        ))}
      </div>
    </section>
  )
}
