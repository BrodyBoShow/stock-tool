import type { ReactNode } from 'react'

export interface NextActionCTAProps {
  /** `primary` is the one accent next-step per tab (max one). `info` is a calmer
   *  secondary variant for when the best next step is informational. */
  intent?: 'primary' | 'info'
  message: string
  ctaLabel: string
  onCta: () => void
  /** Optional leading glyph/icon node (defaults to a subtle "!" for primary). */
  icon?: ReactNode
}

/**
 * The one next-step banner per tab (spec principle: every screen ends with
 * exactly one primary CTA doable in <30s). Redesigned away from a saturated
 * full-width fill (the "ugly bar") to a calm tinted surface with an accent left
 * rail + one solid-accent button — reads clean in both light and dark. Keyboard:
 * the CTA is a real <button>, reachable with a single Tab and fired with Enter.
 */
export function NextActionCTA({
  intent = 'primary',
  message,
  ctaLabel,
  onCta,
  icon,
}: NextActionCTAProps) {
  const primary = intent === 'primary'
  return (
    <div
      className={`flex flex-col gap-3 rounded-[var(--r-lg)] border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
        primary
          ? 'border-[var(--border)] border-l-4 border-l-[var(--accent)] bg-[var(--accent-soft)] text-ink shadow-[var(--sh-sm)]'
          : 'border-[var(--border)] bg-surface text-ink'
      }`}
    >
      <div className="flex items-center gap-2 text-[0.9rem] font-semibold">
        <span aria-hidden="true" className="text-[var(--accent)]">
          {icon ?? '!'}
        </span>
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={onCta}
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1 rounded-[var(--r-md)] bg-[var(--accent-solid)] px-4 text-[0.85rem] font-semibold text-[var(--accent-ink)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2"
      >
        {ctaLabel}
        <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}
