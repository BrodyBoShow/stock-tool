/** Zone A of the redesigned Watchlist ("radar"): a calm summary of how many
 *  names are watched and how many moved, plus the single most-notable change —
 *  the one thing worth looking at first. Presentational only; the page computes
 *  the view model from the watchlist rows + the what's-changed digest. */
export interface WatchlistHeroView {
  total: number
  /** Names with a material change in the digest (rank/score move, 8-K, insider
   *  buy, news spike, or a thesis review due). */
  attention: number
  /** The what's-changed digest hasn't resolved yet — don't assert "all quiet". */
  loading: boolean
  /** The single most-active name + a plain-English one-liner, or null when quiet. */
  top: { ticker: string; line: string } | null
}

export function WatchlistHero({ view }: { view: WatchlistHeroView }) {
  const { total, attention, top } = view
  return (
    <section
      aria-label="Watchlist summary"
      className="rounded-[var(--r-xl)] border border-line bg-surface p-5 shadow-[var(--sh-sm)]"
    >
      <h1 className="sr-only">Watchlist</h1>
      <div className="text-micro font-semibold uppercase tracking-wide text-muted">Your radar</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="numeric text-h1 font-bold leading-none text-ink sm:text-display">{total}</span>
        <span className="text-body font-semibold text-muted">
          name{total === 1 ? '' : 's'} watched
        </span>
        {view.loading ? (
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-small font-medium text-muted">
            checking for updates…
          </span>
        ) : attention > 0 ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-small font-semibold text-warn">
            {attention} with updates
          </span>
        ) : (
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-small font-semibold text-muted">
            all quiet
          </span>
        )}
      </div>
      {top && (
        <div className="mt-2 text-small text-muted">
          Most notable: <span className="font-semibold text-ink">{top.ticker}</span> — {top.line}
        </div>
      )}
    </section>
  )
}
