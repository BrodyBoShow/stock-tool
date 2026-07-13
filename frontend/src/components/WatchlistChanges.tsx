import { ArrowUpRight, BellOff, Clock, Newspaper } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { SectorPill } from '@/components/screener/SectorPill'
import { Delta } from '@/components/ui/Delta'
import { Icon } from '@/components/ui/Icon'
import { fmtDate, fmtMoney } from '@/lib/format'
import { snoozedUntil, snoozeTicker } from '@/lib/watchlistSnooze'
import { WhatsChangedButton } from '@/components/watchlist/WhatsChangedButton'
import type { WatchlistChange } from '@/types/api'

const SNOOZE_DAYS = 30

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
    rank: 'border-line bg-surface-2 text-ink',
    live: 'border-info bg-info-soft text-info',
    event: 'border-warn bg-warn-soft text-warn',
    insider: 'border-pos-border bg-pos-soft text-pos',
    review: 'border-warn bg-warn-soft text-warn',
    quiet: 'border-[var(--divider)] bg-[var(--surface-2)] text-subtle',
    news: 'border-line bg-info-soft text-info',
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
      <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-wide text-warn">
        Needs a look
      </span>
    )
  }
  if (tier === 'fyi') {
    return (
      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-wide text-muted">
        FYI
      </span>
    )
  }
  return null
}

function ChangeCard({
  c,
  snoozedTs,
  onSnooze,
}: {
  c: WatchlistChange
  snoozedTs: number | null
  onSnooze: (ticker: string, days: number) => void
}) {
  // Snoozed: a compact muted card that only offers "unsnooze" — no chips nagging.
  if (snoozedTs != null) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-card border border-[var(--divider)] bg-[var(--surface-2)] px-4 py-3 shadow-card">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={`/securities/${c.ticker}`}
            className="text-[0.9rem] font-bold text-muted hover:text-accent hover:underline"
          >
            {c.ticker}
          </Link>
          <span className="text-[0.7rem] text-subtle">
            Snoozed · resumes{' '}
            {new Date(snoozedTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onSnooze(c.ticker, 0)}
          className="flex-none text-[0.72rem] font-semibold text-accent hover:underline"
        >
          Unsnooze
        </button>
      </div>
    )
  }

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
        'rounded-card border bg-surface p-4 shadow-card ' +
        (tier === 'act'
          ? 'border-l-4 border-l-[var(--warn-strong)] border-warn'
          : tier === 'quiet'
            ? 'border-[var(--divider)]'
            : 'border-line')
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/securities/${c.ticker}`}
              className="text-[0.95rem] font-bold text-ink hover:text-accent hover:underline"
            >
              {c.ticker}
            </Link>
            {c.sector && <SectorPill sector={c.sector} />}
            <TierTag tier={tier} />
          </div>
          {c.name && (
            <div className="mt-0.5 truncate text-[0.75rem] text-subtle">{c.name}</div>
          )}
        </div>
        <div className="flex-none text-right">
          <div className="text-[1.15rem] font-bold tabular-nums text-ink">
            {c.composite != null ? c.composite.toFixed(1) : '—'}
          </div>
          <div className="text-[0.62rem] font-semibold uppercase tracking-wide text-subtle">
            Composite
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {/* ── ACT: developments that warrant a decision ─────────────────── */}
        {c.review_due && (
          <Link to={`/securities/${c.ticker}`}>
            <Chip tone="review"><Icon icon={Clock} size={12} /> Thesis review due</Chip>
          </Link>
        )}
        {c.new_events > 0 &&
          (() => {
            const chip = (
              <Chip tone="event">
                ▾ {c.new_events} new 8-K
                {c.latest_event_label ? ` · ${c.latest_event_label}` : ''}
                {c.latest_event_date ? (
                  <span className="text-warn"> ({fmtDate(c.latest_event_date)})</span>
                ) : null}
                {c.latest_event_url ? <Icon icon={ArrowUpRight} size={12} className="ml-0.5" /> : null}
              </Chip>
            )
            // Link straight to the most recent 8-K's primary document on SEC
            // EDGAR when we have it. With >1 new filing the chip names the latest
            // one, so the link opens that; the deep dive lists them all.
            return c.latest_event_url ? (
              <a
                href={c.latest_event_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-lg hover:brightness-95"
                title={
                  c.new_events > 1
                    ? `Open the most recent 8-K on SEC EDGAR — ${c.new_events} recent filings; see the deep dive for all`
                    : 'Open this 8-K filing on SEC EDGAR'
                }
              >
                {chip}
              </a>
            ) : (
              chip
            )
          })()}
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
                <span className="text-subtle">
                  {c.baseline_date ? ` vs ${fmtDate(c.baseline_date)}` : ''}
                </span>
              </>
            ) : compMove != null && compMove !== 0 ? (
              <>
                {' '}
                <Delta value={compMove} />
              </>
            ) : (
              <span className="text-subtle"> · trend builds nightly</span>
            )}
          </Chip>
        )}
        {liveShown && (
          <Chip tone="live">
            <span className="h-1.5 w-1.5 rounded-full bg-info" />
            Live {c.composite_live!.toFixed(1)} <Delta value={liveMove!} />
          </Chip>
        )}
        {c.news_spike && (
          <Chip tone="news">
            <span
              title="Recent news coverage jumped above this name's own recent baseline (GDELT article volume, matched by company name — may catch unrelated same-name coverage). Context only, not a signal — open the name to see the headlines."
              className="inline-flex cursor-help items-center gap-1"
            >
              <Icon icon={Newspaper} size={12} /> News spike
              {c.news_ratio ? ` · ${c.news_ratio.toFixed(1)}× vs usual` : ''}
              {c.news_count != null ? ` (${c.news_count} art.)` : ''}
            </span>
          </Chip>
        )}

        {tier === 'quiet' ? (
          <Chip tone="quiet">No material changes</Chip>
        ) : (
          <button
            type="button"
            onClick={() => onSnooze(c.ticker, SNOOZE_DAYS)}
            className="ml-auto inline-flex items-center gap-1 text-[0.7rem] font-medium text-subtle hover:text-muted"
            title={`Quiet ${c.ticker}'s updates for ${SNOOZE_DAYS} days`}
          >
            <Icon icon={BellOff} size={12} /> Snooze {SNOOZE_DAYS}d
          </button>
        )}
      </div>

      {tier !== 'quiet' && (
        <WhatsChangedButton
          ticker={c.ticker}
          filingUrl={c.latest_event_url}
          filingLabel={c.latest_event_label}
          filingForm={c.latest_event_form}
        />
      )}
    </div>
  )
}

export function WatchlistChanges({
  rows,
  onSnoozeChange,
}: {
  rows: WatchlistChange[]
  /** Fired when a snooze toggles, so the page's hero can recompute its count. */
  onSnoozeChange?: () => void
}) {
  const [version, setVersion] = useState(0)

  const handleSnooze = (ticker: string, days: number) => {
    snoozeTicker(ticker, days)
    setVersion((v) => v + 1)
    onSnoozeChange?.()
  }

  // Recomputes when rows change or a snooze toggles (version).
  const view = useMemo(() => {
    const withSnooze = rows.map((c) => ({ c, ts: snoozedUntil(c.ticker) }))
    const rank = (x: { c: WatchlistChange; ts: number | null }) =>
      x.ts != null ? 3 : TIER_RANK[tierOf(x.c)]
    withSnooze.sort((a, b) => rank(a) - rank(b) || activity(b.c) - activity(a.c))
    const live = withSnooze.filter((x) => x.ts == null)
    return {
      sorted: withSnooze,
      actCount: live.filter((x) => tierOf(x.c) === 'act').length,
      fyiCount: live.filter((x) => tierOf(x.c) === 'fyi').length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, version])

  if (rows.length === 0) return null

  const { sorted, actCount, fyiCount } = view
  const summary =
    actCount > 0
      ? `${actCount} need${actCount === 1 ? 's' : ''} a look${fyiCount > 0 ? ` · ${fyiCount} FYI` : ''}`
      : fyiCount > 0
        ? `${fyiCount} FYI update${fyiCount === 1 ? '' : 's'}`
        : 'no material updates'

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[0.95rem] font-bold text-ink">What&apos;s changed</h2>
        <span className="text-right text-[0.74rem] text-subtle">
          {summary} · rank/score vs ~1mo ago · 8-Ks &amp; insider buys recent
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {sorted.map(({ c, ts }) => (
          <ChangeCard key={c.security_id} c={c} snoozedTs={ts} onSnooze={handleSnooze} />
        ))}
      </div>
    </section>
  )
}
