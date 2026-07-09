import { useMemo, useRef, useState } from 'react'

import { fmtDate, fmtVol, tickLabel } from '@/lib/format'
import type { VsaBar, WyckoffAnalysis, WyckoffEventType } from '@/lib/wyckoff'

const UP = 'var(--pos-strong)'
const DOWN = 'var(--neg)'
const CLIMAX = 'var(--warn)'
const WIDE = 'var(--muted)'
const CHURN = 'var(--subtle)'
const RANGE = '#378ADD'
const EV_BULL = 'var(--pos)'
const EV_BEAR = 'var(--neg)'

const VB_W = 1000
const VB_H = 400
const PLOT_L = 46
const PLOT_R = 952
const PRICE_TOP = 8
const PRICE_BOT = 300
const VOL_TOP = 322
const VOL_BOT = 382

// Events drawn above the bar's high vs below its low.
const TOP_EVENTS = new Set<WyckoffEventType>(['AR', 'SOS', 'LPS', 'BC', 'UT', 'UTAD', 'STd', 'LPSY'])

function borderFor(cls: VsaBar['cls']): string | null {
  if (cls === 'climax') return CLIMAX
  if (cls === 'wide') return WIDE
  if (cls === 'churn') return CHURN
  return null
}

const CLS_LABEL: Record<VsaBar['cls'], string> = {
  climax: 'Climax volume',
  wide: 'Wide spread',
  churn: 'Churn / no-demand',
  normal: 'Normal bar',
}

const PHASE_TINT = 'rgba(100,116,139,0.05)'
const PHASE_TINT_ALT = 'rgba(100,116,139,0.10)'

export function WyckoffChart({
  analysis,
  isFetching,
  showSignals,
  showPhases,
  showTarget,
}: {
  analysis: WyckoffAnalysis
  isFetching: boolean
  showSignals: boolean
  showPhases: boolean
  showTarget: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{ idx: number; frac: number } | null>(null)

  const { bars, range, events, phases, target } = analysis
  const eventByIdx = useMemo(() => {
    const m = new Map<number, (typeof events)[number]>()
    if (showSignals) for (const e of events) m.set(e.idx, e)
    return m
  }, [events, showSignals])

  const layout = useMemo(() => {
    const n = bars.length
    if (n < 2) return null
    const slot = (PLOT_R - PLOT_L) / n
    const candleW = Math.min(Math.max(slot * 0.66, 0.6), 16)
    let pmin = Infinity
    let pmax = -Infinity
    let volMax = 0
    for (const b of bars) {
      if (b.l < pmin) pmin = b.l
      if (b.h > pmax) pmax = b.h
      if ((b.vol ?? 0) > volMax) volMax = b.vol ?? 0
    }
    if (showTarget && target) {
      pmin = Math.min(pmin, target.price)
      pmax = Math.max(pmax, target.price)
    }
    const pad = (pmax - pmin) * 0.04 || pmax * 0.04 || 1
    const dMin = pmin - pad
    const dMax = pmax + pad
    const cx = (i: number) => PLOT_L + slot * (i + 0.5)
    const yP = (p: number) => PRICE_TOP + ((dMax - p) / (dMax - dMin)) * (PRICE_BOT - PRICE_TOP)
    const yV = (v: number) => VOL_BOT - (volMax > 0 ? (v / volMax) * (VOL_BOT - VOL_TOP) : 0)
    return { n, slot, candleW, dMin, dMax, cx, yP, yV }
  }, [bars, showTarget, target])

  const priceTicks = useMemo(() => {
    if (!layout) return []
    const { dMin, dMax, yP } = layout
    return [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const p = dMin + (dMax - dMin) * f
      return { p, y: yP(p) }
    })
  }, [layout])

  const monthTicks = useMemo(() => {
    if (!layout) return []
    const out: { x: number; label: string }[] = []
    let prevMonth = ''
    let lastX = -999
    bars.forEach((b, i) => {
      const month = b.date.slice(0, 7)
      if (month !== prevMonth) {
        const x = layout.cx(i)
        if (x - lastX >= 72) {
          out.push({ x, label: tickLabel(b.date) })
          lastX = x
        }
        prevMonth = month
      }
    })
    return out
  }, [bars, layout])

  if (!layout) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-subtle">
        Not enough price data for this range.
      </div>
    )
  }

  const { candleW, cx, yP, yV } = layout

  const onMove = (e: React.MouseEvent) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const vbx = frac * VB_W
    const idx = Math.round((vbx - PLOT_L) / layout.slot - 0.5)
    if (idx < 0 || idx >= bars.length) {
      setHover(null)
      return
    }
    setHover({ idx, frac })
  }

  const hb = hover ? bars[hover.idx] : null
  const hev = hover ? eventByIdx.get(hover.idx) : undefined
  const rangeBand = range ? { top: yP(range.resistance), bottom: yP(range.support) } : null
  const targetY = showTarget && target ? yP(target.price) : null

  return (
    <div className="relative" style={{ opacity: isFetching ? 0.55 : 1 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        style={{ display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Wyckoff volume-spread candlestick chart"
      >
        {/* phase bands */}
        {showPhases &&
          phases.map((ph, i) => {
            const x0 = cx(ph.startIdx) - layout.slot / 2
            const x1 = cx(ph.endIdx) + layout.slot / 2
            return (
              <g key={`ph${i}`}>
                <rect
                  x={Math.max(PLOT_L, x0)}
                  y={PRICE_TOP}
                  width={Math.max(0, Math.min(PLOT_R, x1) - Math.max(PLOT_L, x0))}
                  height={VOL_BOT - PRICE_TOP}
                  fill={i % 2 === 0 ? PHASE_TINT : PHASE_TINT_ALT}
                />
                <text x={(Math.max(PLOT_L, x0) + Math.min(PLOT_R, x1)) / 2} y={PRICE_TOP + 11} fontSize={11} fontWeight={700} fill="var(--subtle)" textAnchor="middle">
                  {ph.id}
                </text>
              </g>
            )
          })}

        {/* trading range band */}
        {rangeBand && (
          <>
            <rect x={PLOT_L} y={rangeBand.top} width={PLOT_R - PLOT_L} height={Math.max(rangeBand.bottom - rangeBand.top, 0)} fill="rgba(55,138,221,0.08)" />
            <line x1={PLOT_L} y1={rangeBand.top} x2={PLOT_R} y2={rangeBand.top} stroke={RANGE} strokeWidth={1} strokeDasharray="4 3" />
            <line x1={PLOT_L} y1={rangeBand.bottom} x2={PLOT_R} y2={rangeBand.bottom} stroke={RANGE} strokeWidth={1} strokeDasharray="4 3" />
            <text x={PLOT_R + 2} y={rangeBand.top + 3} fontSize={10} fill="#185FA5">R</text>
            <text x={PLOT_R + 2} y={rangeBand.bottom + 3} fontSize={10} fill="#185FA5">S</text>
          </>
        )}

        {/* target line */}
        {targetY != null && target && (
          <>
            <line x1={PLOT_L} y1={targetY} x2={PLOT_R} y2={targetY} stroke={target.direction === 'up' ? EV_BULL : EV_BEAR} strokeWidth={1} strokeDasharray="2 3" />
            <text x={PLOT_L + 2} y={targetY - 3} fontSize={10} fontWeight={600} fill={target.direction === 'up' ? EV_BULL : EV_BEAR}>
              Target ≈ ${target.price.toFixed(2)}
            </text>
          </>
        )}

        {/* price grid + y labels */}
        {priceTicks.map((t, i) => (
          <g key={i}>
            <line x1={PLOT_L} y1={t.y} x2={PLOT_R} y2={t.y} stroke="var(--surface-2)" strokeWidth={1} />
            <text x={PLOT_L - 4} y={t.y + 3} fontSize={10} fill="var(--subtle)" textAnchor="end">
              ${t.p.toFixed(t.p < 10 ? 1 : 0)}
            </text>
          </g>
        ))}

        {/* candles */}
        {bars.map((b, i) => {
          const x = cx(i)
          const color = b.up ? UP : DOWN
          const top = yP(Math.max(b.o, b.c))
          const bottom = yP(Math.min(b.o, b.c))
          const border = borderFor(b.cls)
          return (
            <g key={i}>
              <line x1={x} y1={yP(b.h)} x2={x} y2={yP(b.l)} stroke={color} strokeWidth={Math.min(candleW * 0.18, 1.4)} />
              <rect
                x={x - candleW / 2}
                y={top}
                width={candleW}
                height={Math.max(bottom - top, 1)}
                fill={color}
                stroke={border ?? 'none'}
                strokeWidth={border ? Math.min(candleW * 0.22, 1.6) : 0}
              />
            </g>
          )
        })}

        {/* Wyckoff event markers */}
        {showSignals &&
          events.map((e, i) => {
            const b = bars[e.idx]
            const x = cx(e.idx)
            const color = e.bullish ? EV_BULL : EV_BEAR
            const atTop = TOP_EVENTS.has(e.type)
            const y = atTop ? yP(b.h) - 6 : yP(b.l) + 6
            const tri = atTop ? `${x},${y} ${x - 3},${y - 5} ${x + 3},${y - 5}` : `${x},${y} ${x - 3},${y + 5} ${x + 3},${y + 5}`
            return (
              <g key={`e${i}`} opacity={0.55 + 0.45 * e.confidence}>
                <title>{`${e.label} (candidate, ${Math.round(e.confidence * 100)}%) — ${fmtDate(e.date)}`}</title>
                <polygon points={tri} fill={color} />
                <text x={x} y={atTop ? y - 7 : y + 13} fontSize={9} fill={color} textAnchor="middle" fontWeight={600}>
                  {e.label}
                </text>
              </g>
            )
          })}

        {/* volume panel */}
        <line x1={PLOT_L} y1={VOL_BOT} x2={PLOT_R} y2={VOL_BOT} stroke="var(--border)" strokeWidth={0.5} />
        {bars.map((b, i) => {
          if (b.vol == null) return null
          const x = cx(i)
          const y = yV(b.vol)
          const fill = b.cls === 'climax' ? CLIMAX : b.up ? UP : DOWN
          return (
            <rect key={`v${i}`} x={x - candleW / 2} y={y} width={candleW} height={Math.max(VOL_BOT - y, 0)} fill={fill} fillOpacity={b.cls === 'climax' ? 1 : 0.5} />
          )
        })}
        <text x={PLOT_L - 4} y={VOL_TOP + 8} fontSize={10} fill="var(--subtle)" textAnchor="end">Vol</text>

        {/* x month labels */}
        {monthTicks.map((t, i) => (
          <text key={i} x={t.x} y={VB_H - 4} fontSize={10} fill="var(--subtle)" textAnchor="middle">
            {t.label}
          </text>
        ))}

        {/* crosshair */}
        {hb && <line x1={cx(hover!.idx)} y1={PRICE_TOP} x2={cx(hover!.idx)} y2={VOL_BOT} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="2 2" />}
      </svg>

      {/* tooltip */}
      {hb && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card"
          style={{ left: `${(hover!.frac * 100).toFixed(2)}%`, transform: hover!.frac > 0.6 ? 'translateX(-105%)' : 'translateX(8px)' }}
        >
          <div className="font-semibold text-ink">{fmtDate(hb.date)}</div>
          <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-ink">
            <span>O ${hb.o.toFixed(2)}</span>
            <span>H ${hb.h.toFixed(2)}</span>
            <span>L ${hb.l.toFixed(2)}</span>
            <span style={{ color: hb.up ? UP : DOWN }}>C ${hb.c.toFixed(2)}</span>
          </div>
          <div className="mt-1 border-t border-line pt-1 text-muted">
            <div>Vol {fmtVol(hb.vol)}{hb.relVol != null && ` · ${hb.relVol.toFixed(1)}× avg`}</div>
            {hb.spreadRel != null && <div>Spread {hb.spreadRel.toFixed(1)}× avg</div>}
            {hb.closeLoc != null && <div>Close {Math.round(hb.closeLoc * 100)}% up the bar</div>}
          </div>
          {hb.cls !== 'normal' && (
            <div
              className="mt-1 inline-block rounded px-1.5 py-0.5 text-[0.68rem] font-semibold"
              style={{ color: hb.cls === 'climax' ? '#854F0B' : '#334155', background: hb.cls === 'climax' ? '#FAEEDA' : 'var(--surface-2)' }}
            >
              {CLS_LABEL[hb.cls]}
            </div>
          )}
          {hev && (
            <div className="mt-1.5 max-w-[220px] border-t border-line pt-1.5">
              <span className="font-semibold" style={{ color: hev.bullish ? EV_BULL : EV_BEAR }}>
                {hev.label} · candidate · {Math.round(hev.confidence * 100)}%
              </span>
              <div className="mt-0.5 text-[0.68rem] leading-snug text-muted">{hev.note}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
