import { useEffect, useRef, useState } from 'react'

/**
 * Tiny inline-SVG sparkline of a composite-score series — no chart library, one
 * <svg> per cell. Lazy: shows a blank placeholder until scrolled into view
 * (IntersectionObserver), then draws the path once. Virtualization already caps
 * the live count to the visible window; the observer just defers work for rows
 * sitting in the overscan buffer. Line is green when the series ends up, red
 * when down — pure shape, no axes. */
export function Sparkline({
  data,
  width = 56,
  height = 16,
  color,
  title,
}: {
  data: number[] | null
  width?: number
  height?: number
  /** Override the auto green-up / red-down stroke (e.g. better-direction color). */
  color?: string
  /** Override the default hover title. */
  title?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(false)

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
    return <span ref={ref} aria-hidden className="mt-1 block" style={{ width, height }} />
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const n = data.length
  const pts = data.map((v, i) => {
    const x = (i / (n - 1)) * (width - 2) + 1
    const y = height - 1 - ((v - min) / span) * (height - 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = pts.join(' ')
  const up = data[n - 1] >= data[0]
  const stroke = color ?? (up ? '#16a34a' : '#dc2626')

  return (
    <span
      ref={ref}
      className="mt-1 block"
      title={title ?? `Composite trend over the last ${n} scoring runs`}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
        <polygon points={`1,${height - 1} ${line} ${width - 1},${height - 1}`} fill={stroke} opacity={0.1} />
        <polyline
          points={line}
          fill="none"
          stroke={stroke}
          strokeWidth={1}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}
