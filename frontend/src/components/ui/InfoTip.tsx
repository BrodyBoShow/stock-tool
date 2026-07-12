import { useId, useState } from 'react'
import { createPortal } from 'react-dom'

/** Accessible info tooltip — hover OR keyboard-focus reveals the definition.
 * The button carries a short fixed name and points at the description via
 * aria-describedby (not a giant aria-label), so screen readers announce
 * "More information" then read the definition. Shared across Market / Lab /
 * Funds / Portfolio / deep-dive.
 *
 * The bubble is PORTALED to <body> with fixed positioning (mirrors RiskBandChip /
 * the ScoreCell tooltip) so a card's `overflow-hidden` or a table's
 * `overflow:auto` can't clip it — that clipping is why edge tooltips (the hero
 * metric `?`s, the top-right "Positions only" badge) were cut off. It clamps to
 * the viewport horizontally and flips below the trigger when there's no room
 * above (near the top of the page). */
function TipBubble({ text, rect, id }: { text: string; rect: DOMRect; id: string }) {
  const W = 224 // matches the previous w-56
  const flipDown = rect.top < 140 // near the top of the viewport -> show below
  const style: React.CSSProperties = {
    position: 'fixed',
    width: W,
    left: Math.max(
      8,
      Math.min(rect.left + rect.width / 2 - W / 2, window.innerWidth - W - 8),
    ),
    top: flipDown ? rect.bottom + 6 : undefined,
    bottom: flipDown ? undefined : window.innerHeight - rect.top + 6,
    zIndex: 80,
  }
  return createPortal(
    <span
      id={id}
      role="tooltip"
      style={style}
      className="pointer-events-none rounded-lg bg-slate-900 px-2.5 py-1.5 text-left text-[0.7rem] font-normal normal-case leading-snug tracking-normal text-white shadow-lg"
    >
      {text}
    </span>,
    document.body,
  )
}

export function InfoTip({ text, className = '' }: { text: string; className?: string }) {
  const id = useId()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const show = (el: HTMLElement) => setRect(el.getBoundingClientRect())
  return (
    <span className={`ml-1 inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label="More information"
        aria-describedby={rect ? id : undefined}
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={() => setRect(null)}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={() => setRect(null)}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-line text-[0.55rem] font-bold leading-none text-muted transition-colors hover:border-line-strong hover:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span aria-hidden="true">?</span>
      </button>
      {rect && <TipBubble text={text} rect={rect} id={id} />}
    </span>
  )
}
