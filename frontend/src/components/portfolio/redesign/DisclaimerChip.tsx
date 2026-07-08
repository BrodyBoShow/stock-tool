/** The ONE disclaimer, reused everywhere (spec: Honest about risk — replaces the
 *  5+ scattered "NOT INVESTMENT ADVICE" texts with a single reusable component
 *  that appears exactly once per tab).
 *
 *  variant:
 *    inline → a small muted pill to sit beside a heading
 *    footer → the bottom-strip line under a tab's content (default)
 *    modal  → centered copy for a first-visit acceptance dialog (the dialog gate
 *             itself is wired at the page level; this just renders the text). */
const FULL =
  'Not investment advice — tracking & analytics over your own ledger. StockBud never places orders.'

export function DisclaimerChip({
  variant = 'footer',
}: {
  variant?: 'inline' | 'footer' | 'modal'
}) {
  if (variant === 'inline') {
    return (
      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-muted">
        Not advice
      </span>
    )
  }
  return (
    <p className={`text-small text-muted ${variant === 'modal' ? 'text-center' : ''}`}>{FULL}</p>
  )
}
