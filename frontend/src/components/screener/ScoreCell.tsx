import { useState } from 'react'
import { createPortal } from 'react-dom'

import { Sparkline } from '@/components/screener/Sparkline'
import { Delta } from '@/components/ui/Delta'
import { scoreHeat } from '@/lib/colors'
import { FACTOR_DEFS, INPUT_LABELS, type FactorKey } from '@/lib/constants'
import { DASH } from '@/lib/format'

function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

interface SubRow {
  label: string
  pctl: number
}

/** Single shared-style breakdown tooltip, portaled to <body> so the table's
 *  overflow:auto never clips it. Only the hovered cell mounts one, and
 *  virtualization caps rendered cells to ~the visible window, so this stays
 *  cheap despite the 4k-row universe. */
function FactorTooltip({
  factor,
  value,
  subPctls,
  rect,
}: {
  factor: Exclude<FactorKey, 'composite'>
  value: number
  subPctls: Record<string, number | null>
  rect: DOMRect
}) {
  const rows: SubRow[] = FACTOR_DEFS[factor]
    .filter(([k]) => k in subPctls && subPctls[k] != null)
    .map(([k]) => ({ label: INPUT_LABELS[k] ?? k, pctl: subPctls[k] as number }))
  const weak = rows.filter((r) => r.pctl < 45).sort((a, b) => a.pctl - b.pctl).slice(0, 3)
  const strong = rows.filter((r) => r.pctl >= 55).sort((a, b) => b.pctl - a.pctl).slice(0, 3)

  const W = 256
  const flipUp = rect.bottom > window.innerHeight - 190
  const style: React.CSSProperties = {
    position: 'fixed',
    width: W,
    left: Math.max(8, Math.min(rect.left + rect.width / 2 - W / 2, window.innerWidth - W - 8)),
    top: flipUp ? undefined : rect.bottom + 6,
    bottom: flipUp ? window.innerHeight - rect.top + 6 : undefined,
    zIndex: 80,
  }

  const Item = ({ r }: { r: SubRow }) => (
    <div className="flex items-center justify-between py-[3px]">
      <span className="text-[0.72rem] text-muted">{r.label}</span>
      <span
        className={
          'numeric rounded px-1.5 py-px text-[0.66rem] font-bold ' +
          (r.pctl >= 50 ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg')
        }
      >
        {ordinal(Math.round(r.pctl))}
      </span>
    </div>
  )

  return createPortal(
    <div
      style={style}
      className="pointer-events-none rounded-lg border border-line bg-surface p-3 text-ink shadow-[0_8px_24px_rgba(15,23,42,0.14)]"
    >
      <div className="mb-2 border-b border-line pb-1.5 text-[0.74rem] font-bold capitalize">
        {factor}: <span className="numeric">{value.toFixed(1)}</span>{' '}
        <span className="font-medium text-subtle">· {ordinal(Math.round(value))} pctl</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[0.7rem] text-subtle">No sub-metric data for this factor.</div>
      ) : (
        <>
          {weak.length > 0 && (
            <div className="mb-1.5">
              <div className="mb-0.5 text-[0.6rem] font-bold uppercase tracking-[0.05em] text-subtle">
                Dragged down by
              </div>
              {weak.map((r) => (
                <Item key={r.label} r={r} />
              ))}
            </div>
          )}
          {strong.length > 0 && (
            <div>
              <div className="mb-0.5 text-[0.6rem] font-bold uppercase tracking-[0.05em] text-subtle">
                Strengths
              </div>
              {strong.map((r) => (
                <Item key={r.label} r={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  )
}

/** Factor score cell: numeric value + heat-colored percentile bar + tinted bg.
 *
 * `live` is an optional live-adjusted percentile (price-driven factors only).
 * `delta` (composite only) renders a movement chip vs the prior nightly run.
 * `subPctls` (the four factor cells) drives a hover breakdown tooltip. */
export function ScoreCell({
  factor,
  value,
  live,
  delta,
  subPctls,
  sparkline,
  dense = false,
}: {
  factor: FactorKey
  value: number | null
  live?: number | null
  delta?: number | null
  subPctls?: Record<string, number | null> | null
  /** Composite history (composite only): drawn in place of the bar when present. */
  sparkline?: number[] | null
  /** Screener density mode — tighter padding + shorter sparkline so the cell
   *  fits a ~36px row. Default off keeps the shared Watchlist look unchanged. */
  dense?: boolean
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  const moved = live != null && value != null && Math.abs(live - value) >= 0.1
  const shown = moved ? (live as number) : value

  // Heat is applied to EVERY column's bar + tint (consistent scannability); the
  // live-adjusted signal is carried by the blue value text + ● marker, not by
  // recoloring the bar — so the heatmap stays uniform across all five columns.
  const heat = scoreHeat(shown)
  const bg = heat.tint
  const barColor = heat.bar

  // Tooltip only for the four factor cells that have sub-metric data.
  const canTip =
    factor !== 'composite' && subPctls != null && shown !== null &&
    FACTOR_DEFS[factor].some(([k]) => k in subPctls && subPctls[k] != null)

  const showChip = delta != null && Math.abs(delta) >= 0.3

  return (
    <div
      data-factor={factor}
      className={
        'flex h-full flex-col items-center justify-center ' +
        (dense ? 'px-2 py-1 ' : 'px-3 py-2 ') +
        (canTip ? 'cursor-help' : '')
      }
      style={bg ? { background: bg } : undefined}
      onMouseEnter={
        canTip ? (e) => setRect(e.currentTarget.getBoundingClientRect()) : undefined
      }
      onMouseLeave={canTip ? () => setRect(null) : undefined}
      title={
        moved
          ? `Live ${(live as number).toFixed(1)} · ${value!.toFixed(1)} nightly ` +
            `(${live! > value! ? '+' : '−'}${Math.abs(live! - value!).toFixed(1)})`
          : undefined
      }
    >
      {shown === null ? (
        <span className="text-[0.82rem] text-subtle">{DASH}</span>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            <span
              className={
                'numeric text-[0.82rem] font-bold ' +
                (dense ? 'leading-none ' : '') +
                (moved ? 'text-info' : 'text-ink')
              }
            >
              {shown.toFixed(1)}
              {moved && <span className="align-super text-[0.6em] text-info">●</span>}
            </span>
            {showChip && (
              <span className="numeric text-[0.66rem] font-bold">
                <Delta value={delta as number} />
              </span>
            )}
          </span>
          {sparkline && sparkline.length >= 2 ? (
            <Sparkline data={sparkline} height={dense ? 12 : 16} />
          ) : (
            <span
              className={`relative block h-1 w-12 overflow-hidden rounded-full bg-surface-3 ${dense ? 'mt-0.5' : 'mt-1'}`}
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, shown))}%`,
                  background: barColor,
                }}
              />
              {/* 50th-percentile (median) reference line */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-500/45"
              />
            </span>
          )}
        </>
      )}
      {canTip && rect && shown !== null && (
        <FactorTooltip
          factor={factor as Exclude<FactorKey, 'composite'>}
          value={shown}
          subPctls={subPctls as Record<string, number | null>}
          rect={rect}
        />
      )}
    </div>
  )
}
