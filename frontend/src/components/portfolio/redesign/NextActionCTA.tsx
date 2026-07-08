import type { ReactNode } from 'react'

export interface NextActionCTAProps {
  /** `primary` is the single purple accent banner (max one per tab). `info` is a
   *  calmer, secondary variant for when the tab's best next step is informational. */
  intent?: 'primary' | 'info'
  message: string
  ctaLabel: string
  onCta: () => void
  /** Optional leading glyph/icon node (defaults to a subtle "!" for primary). */
  icon?: ReactNode
}

/**
 * The one next-step banner per tab (spec principle: Always a next step — every
 * screen ends with exactly one purple primary CTA doable in <30s). Uniqueness is
 * enforced by the page layout (render it once), not by this component. Keyboard:
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
      className={`flex flex-col gap-3 rounded-[var(--r-lg)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
        primary
          ? 'bg-accent text-white shadow-[var(--sh-md)]'
          : 'border border-slate-200 bg-surface text-ink'
      }`}
    >
      <div className="flex items-center gap-2 text-[0.9rem] font-semibold">
        <span aria-hidden="true" className={primary ? 'text-white/90' : 'text-accent'}>
          {icon ?? '!'}
        </span>
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={onCta}
        className={`inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1 rounded-[var(--r-md)] px-4 text-[0.85rem] font-semibold transition-colors duration-[var(--dur-fast)] focus:outline-none ${
          primary
            ? 'bg-white text-accent hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white/80'
            : 'bg-accent text-white hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2'
        }`}
      >
        {ctaLabel}
        <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}
