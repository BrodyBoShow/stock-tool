import { useState } from 'react'
import { createPortal } from 'react-dom'

/** Historical risk band chip (1-5) — shared by the screener and portfolio.
 *
 * Honesty contract: the band is a backward-looking MEASUREMENT (realized
 * volatility, beta and drawdown over the past year), never a prediction or a
 * recommendation, and the tooltip says so. A null band renders as "—" with an
 * "under 1 year of history" tooltip — missing history is disclosed, never
 * estimated. Colors read as intensity (cool → warm), not good/bad.
 */

// Intensity, not good/bad — each band is one hue (--band-1..5, cool→warm), and
// the chip derives its bg/border via color-mix so it reads in both themes.
const BAND_META: Record<number, { label: string; vol: string }> = {
  1: { label: 'Very Low', vol: '< 18%' },
  2: { label: 'Low', vol: '18–28%' },
  3: { label: 'Moderate', vol: '28–40%' },
  4: { label: 'High', vol: '40–60%' },
  5: { label: 'Speculative', vol: '≥ 60%' },
}

const METHODOLOGY =
  'Historical risk band from realized volatility, market beta and drawdown over ' +
  'the past year. A backward-looking measurement, not a prediction — risk can ' +
  'change abruptly (e.g. around corporate events). Not investment advice.'

/** The tooltip is portaled to <body> with fixed positioning (mirrors
 *  ScoreCell's FactorTooltip) so the screener/holdings tables' overflow:auto
 *  container can't clip it — that clipping is why the top rows' descriptions
 *  were cut off. It flips above the chip when near the bottom of the viewport. */
function ChipTooltip({ text, rect }: { text: string; rect: DOMRect }) {
  const W = 260
  const flipUp = rect.bottom > window.innerHeight - 170
  const style: React.CSSProperties = {
    position: 'fixed',
    width: W,
    left: Math.max(8, Math.min(rect.left + rect.width / 2 - W / 2, window.innerWidth - W - 8)),
    top: flipUp ? undefined : rect.bottom + 6,
    bottom: flipUp ? window.innerHeight - rect.top + 6 : undefined,
    zIndex: 80,
  }
  return createPortal(
    <div
      role="tooltip"
      style={style}
      className="pointer-events-none rounded-lg bg-slate-900 px-2.5 py-1.5 text-left text-[0.68rem] font-normal normal-case leading-snug tracking-normal text-white shadow-lg"
    >
      {text}
    </div>,
    document.body,
  )
}

export function RiskBandChip({
  band,
  compact = false,
}: {
  band: number | null
  compact?: boolean
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const meta = band != null ? BAND_META[band] : undefined
  // Honesty: the vol range is the BAND's anchor, not this name's measurement —
  // a lower-volatility name can sit one band higher via the size/balance-sheet
  // modifiers, so never assert the range as the name's realized vol.
  const tip = meta
    ? `Risk band ${band} · ${meta.label} — volatility anchor ${meta.vol}/yr; micro-cap size or a weak balance sheet can place a lower-volatility name one band higher. ${METHODOLOGY}`
    : 'No risk band — funds/ETFs aren’t banded, or the name has under 1 year of trading history / no recent price data (never estimated).'
  return (
    <span
      className="inline-flex cursor-help"
      onMouseEnter={(e) => setRect(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setRect(null)}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-semibold tabular-nums ${
          compact ? 'text-[0.6rem]' : 'text-[0.66rem]'
        } ${meta ? '' : 'border-line bg-surface-2 text-subtle'}`}
        style={
          meta
            ? {
                color: `var(--band-${band})`,
                background: `color-mix(in srgb, var(--band-${band}) 15%, transparent)`,
                borderColor: `color-mix(in srgb, var(--band-${band}) 40%, transparent)`,
              }
            : undefined
        }
      >
        {band != null ? band : '—'}
        {!compact && <span className="font-medium">{meta ? meta.label : 'No band'}</span>}
      </span>
      {rect && <ChipTooltip text={tip} rect={rect} />}
    </span>
  )
}
