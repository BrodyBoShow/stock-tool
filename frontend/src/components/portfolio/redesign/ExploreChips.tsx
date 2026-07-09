import { Link } from 'react-router-dom'

export interface ExploreChip {
  label: string
  /** Internal route to navigate to (Zone C's job is cross-tab movement). */
  to?: string
  /** Or a click handler (e.g. open a drawer / switch tab in-page). */
  onClick?: () => void
}

/**
 * Zone C — the shared "what to explore next" chip row that ends every tab and
 * keeps the user moving to the other tabs (spec IA). 3–4 chips. Each chip is a
 * real Link or button (keyboard-reachable, ≥36px tall touch target).
 */
export function ExploreChips({
  label = 'What to explore next:',
  ariaLabel = 'Explore other portfolio tabs',
  chips,
}: {
  label?: string
  /** a11y label for the nav landmark — override on non-portfolio surfaces. */
  ariaLabel?: string
  chips: ExploreChip[]
}) {
  const cls =
    'inline-flex min-h-[36px] items-center gap-1 rounded-[var(--r-md)] border border-line bg-surface px-3 text-[0.75rem] font-medium text-ink transition-colors duration-[var(--dur-fast)] hover:border-line hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] focus-visible:ring-offset-2'
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      <span className="text-[0.75rem] text-muted">{label}</span>
      {chips.map((c) =>
        c.to ? (
          <Link key={c.label} to={c.to} className={cls}>
            {c.label} <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <button key={c.label} type="button" onClick={c.onClick} className={cls}>
            {c.label} <span aria-hidden="true">→</span>
          </button>
        ),
      )}
    </nav>
  )
}
