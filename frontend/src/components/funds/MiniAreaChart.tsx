/**
 * Lightweight multi-series line chart for the Funds drawer + compare overlay.
 * No chart library — one <svg>, fluid width. Every series is normalized to 100
 * at its first point so funds of very different prices are directly comparable
 * (relative performance), which is what the drawer's benchmark overlay and the
 * compare panel both want. Honest about the window: we only have ~90 daily
 * closes, so callers label it "90-day" rather than pretending to a 1Y/5Y range.
 */

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

  return (
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
          stroke="#e2e8f0" strokeWidth={1} strokeDasharray="3,3"
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
            <circle cx={W} cy={lastY} r={3.5} fill={s.color} stroke="#ffffff" strokeWidth={1.5} />
          </g>
        )
      })}
    </svg>
  )
}
