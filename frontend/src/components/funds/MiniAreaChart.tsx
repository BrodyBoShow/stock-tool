/**
 * Lightweight multi-series line chart for the Funds drawer + compare overlay.
 * No chart library — one <svg>, fluid width. Every series is normalized to 100
 * at its first point so funds of very different prices are directly comparable
 * (relative performance), which is what the drawer's benchmark overlay and the
 * compare panel both want. Honest about the window: we only have ~90 daily
 * closes, so callers label it "90-day" rather than pretending to a 1Y/5Y range.
 *
 * Hover: a crosshair with a per-series readout (each series' % change from its
 * first close). We only have values, not dates, so the position is labeled
 * "day k of n" — honest about what the payload carries.
 */
import { useRef, useState } from 'react'

export interface ChartSeries {
  label: string
  data: number[] // closes, oldest → newest
  color: string
  dashed?: boolean
}

function normalize(data: number[]): number[] {
  const base = data.find((v) => v > 0)
  if (!base) return []
  return data.map((v) => (v / base) * 100)
}

export function MiniAreaChart({
  series,
  height = 180,
  showBaseline = true,
  area = false,
}: {
  series: ChartSeries[]
  height?: number
  showBaseline?: boolean
  /** Fill under the (single) primary series. Skipped for multi-series overlays. */
  area?: boolean
}) {
  const W = 600
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)

  const norm = series
    .map((s) => ({ ...s, values: normalize(s.data) }))
    .filter((s) => s.values.length >= 2)

  if (norm.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-surface-2 text-[0.72rem] text-subtle"
        style={{ height }}
      >
        No price history
      </div>
    )
  }

  let lo = Infinity
  let hi = -Infinity
  for (const s of norm) {
    for (const v of s.values) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (showBaseline) {
    lo = Math.min(lo, 100)
    hi = Math.max(hi, 100)
  }
  const span = hi - lo || 1
  const pad = span * 0.08
  lo -= pad
  hi += pad
  const yFor = (v: number) => height - ((v - lo) / (hi - lo)) * height
  const xFor = (i: number, n: number) => (i / (n - 1)) * W

  const baselineY = yFor(100)
  const maxN = Math.max(...norm.map((s) => s.values.length))

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const frac = (e.clientX - rect.left) / rect.width
    setHoverFrac(frac >= 0 && frac <= 1 ? frac : null)
  }

  // Hovered sample per series — each series maps the shared x-fraction onto its
  // OWN index space (series can have different lengths).
  const hover =
    hoverFrac !== null
      ? {
          x: hoverFrac * W,
          dayIdx: Math.round(hoverFrac * (maxN - 1)),
          rows: norm.map((s) => {
            const i = Math.round(hoverFrac * (s.values.length - 1))
            return { label: s.label, color: s.color, pct: s.values[i] - 100, y: yFor(s.values[i]) }
          }),
        }
      : null

  return (
    <div
      ref={wrapRef}
      className="relative"
      onPointerMove={onMove}
      onPointerLeave={() => setHoverFrac(null)}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="block"
      >
        {showBaseline && baselineY >= 0 && baselineY <= height && (
          <line
            x1={0} y1={baselineY} x2={W} y2={baselineY}
            stroke="var(--border)" strokeWidth={1} strokeDasharray="3,3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {norm.map((s) => {
          const n = s.values.length
          const pts = s.values.map((v, i) => `${xFor(i, n).toFixed(1)},${yFor(v).toFixed(1)}`)
          const line = pts.join(' ')
          const last = s.values[n - 1]
          const lastY = yFor(last)
          return (
            <g key={s.label}>
              {area && !s.dashed && norm.length === 1 && (
                <polygon
                  points={`0,${height} ${line} ${W},${height}`}
                  fill={s.color}
                  opacity={0.08}
                />
              )}
              <polyline
                points={line}
                fill="none"
                stroke={s.color}
                strokeWidth={s.dashed ? 1 : 2}
                strokeDasharray={s.dashed ? '4,3' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={s.dashed ? 0.6 : 1}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={W} cy={lastY} r={3.5} fill={s.color} stroke="var(--surface)" strokeWidth={1.5} />
            </g>
          )
        })}
        {hover && (
          <>
            <line
              x1={hover.x} y1={0} x2={hover.x} y2={height}
              stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="2,2"
              vectorEffect="non-scaling-stroke"
            />
            {hover.rows.map((r) => (
              <circle
                key={r.label}
                cx={hover.x}
                cy={r.y}
                r={3}
                fill={r.color}
                stroke="var(--surface)"
                strokeWidth={1.2}
              />
            ))}
          </>
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[0.7rem] shadow-card"
          style={{
            left: `${(hoverFrac! * 100).toFixed(2)}%`,
            transform: hoverFrac! > 0.6 ? 'translateX(-105%)' : 'translateX(8px)',
          }}
        >
          <div className="font-semibold text-subtle">
            day {hover.dayIdx + 1} of {maxN}
          </div>
          <div className="mt-0.5 space-y-px tabular-nums">
            {hover.rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted">
                  <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} />
                  {r.label}
                </span>
                <span
                  className="font-bold"
                  style={{ color: r.pct >= 0 ? 'var(--pos)' : 'var(--neg)' }}
                >
                  {r.pct >= 0 ? '+' : ''}{r.pct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
