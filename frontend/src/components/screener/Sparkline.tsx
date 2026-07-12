import { useEffect, useRef, useState } from 'react'

/**
 * Tiny inline-SVG sparkline — no chart library, one <svg> per cell. Lazy: shows
 * a blank placeholder until scrolled into view (IntersectionObserver), then
 * draws the path once. Virtualization already caps the live count to the
 * visible window; the observer just defers work for rows sitting in the
 * overscan buffer. Line is green when the series ends up, red when down —
 * pure shape, no axes.
 *
 * Hover: moving the pointer across the sparkline marks the nearest point and
 * shows its value in a tiny bubble (plus the caller's per-point label — a date
 * where the caller has one, otherwise "k/n"). Costs one local state per
 * hovered cell only.
 */
export function Sparkline({
  data,
  width = 56,
  height = 16,
  color,
  title,
  fluid = false,
  fmt,
  labels,
}: {
  data: number[] | null
  width?: number
  height?: number
  /** Override the auto green-up / red-down stroke (e.g. better-direction color). */
  color?: string
  /** Override the default hover title. */
  title?: string
  /** Fill the container width (svg width=100%) instead of a fixed px width — for
   *  cards/tiles that can be narrower than `width` on small viewports. `width`
   *  still defines the internal coordinate space; the stroke stays crisp. */
  fluid?: boolean
  /** Format a hovered value (default: trimmed 2-decimal number). */
  fmt?: (v: number) => string
  /** Per-point hover labels aligned with `data` (e.g. dates). Falls back to "k/n". */
  labels?: (string | null)[]
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(false)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (seen || !el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: '120px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  // Nothing to draw (no history yet) or not yet visible → reserve the space.
  if (!data || data.length < 2 || !seen) {
    return (
      <span
        ref={ref}
        aria-hidden
        className="mt-1 block"
        style={{ width: fluid ? '100%' : width, height }}
      />
    )
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const n = data.length
  const xFor = (i: number) => (i / (n - 1)) * (width - 2) + 1
  const yFor = (v: number) => height - 1 - ((v - min) / span) * (height - 2)
  const pts = data.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`)
  const line = pts.join(' ')
  const up = data[n - 1] >= data[0]
  const stroke = color ?? (up ? 'var(--pos-strong)' : 'var(--neg-strong)')

  const onMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const frac = (e.clientX - rect.left) / rect.width
    const idx = Math.round(frac * (n - 1))
    setHoverIdx(idx >= 0 && idx < n ? idx : null)
  }

  const hv = hoverIdx != null ? data[hoverIdx] : null
  const fmtVal = fmt ?? ((v: number) => Number(v.toFixed(2)).toString())
  const hoverLabel =
    hoverIdx != null ? labels?.[hoverIdx] ?? `${hoverIdx + 1}/${n}` : null
  const bubbleLeftPct = hoverIdx != null ? (hoverIdx / (n - 1)) * 100 : 0

  return (
    <span
      ref={ref}
      className="relative mt-1 block"
      // Non-fluid: pin the span to the svg's px width so the pointer→index math
      // (frac of the span) and the bubble's %-left anchor both match the fixed
      // svg. Without this the span stretches to its td and the hover dot drifts
      // away from the cursor.
      style={fluid ? { width: '100%' } : { width }}
      // The browser title would double up with the hover bubble — only offer it
      // while the pointer isn't producing the richer readout.
      title={hoverIdx == null ? title ?? `Trend over the last ${n} points` : undefined}
      onPointerMove={onMove}
      onPointerLeave={() => setHoverIdx(null)}
    >
      <svg
        width={fluid ? '100%' : width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={fluid ? 'none' : undefined}
        className="block"
      >
        {/* Color is applied via `style` (not the stroke=/fill= presentation
            attribute) so the var()/color-mix() token resolves in every browser
            — Safari/older WebKit don't substitute vars in SVG attributes. */}
        <polygon
          points={`1,${height - 1} ${line} ${width - 1},${height - 1}`}
          style={{ fill: stroke }}
          opacity={0.1}
        />
        <polyline
          points={line}
          fill="none"
          style={{ stroke }}
          strokeWidth={1}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {hoverIdx != null && hv != null && (
          <circle
            cx={xFor(hoverIdx)}
            cy={yFor(hv)}
            r={Math.min(2.5, height / 6)}
            style={{ fill: stroke, stroke: 'var(--surface)' }}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {hoverIdx != null && hv != null && (
        <span
          className="pointer-events-none absolute z-20 whitespace-nowrap rounded border border-line bg-surface px-1.5 py-0.5 text-[0.62rem] font-semibold leading-none text-ink shadow-[var(--sh-md)]"
          style={{
            bottom: height + 3,
            left: `${bubbleLeftPct}%`,
            transform: bubbleLeftPct > 60 ? 'translateX(-100%)' : undefined,
          }}
        >
          {fmtVal(hv)}
          <span className="ml-1 font-normal text-subtle">{hoverLabel}</span>
        </span>
      )}
    </span>
  )
}
