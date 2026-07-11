import { useMemo, useRef, useState } from 'react'

import { fmtDate, fmtVol, tickLabel } from '@/lib/format'
import type { VsaBar, WyckoffAnalysis, WyckoffEventType, WyckoffPhaseId } from '@/lib/wyckoff'

import { MeasureBar, type Measurement } from './priceChartPro'
import type { ProChartRow } from './priceChartUtils'

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

/** Textbook phase descriptions — schematic language, not a forecast. */
const PHASE_NOTE: Record<WyckoffPhaseId, string> = {
  A: 'Phase A — stopping the prior trend: climax, automatic reaction, secondary test.',
  B: 'Phase B — building the cause: price oscillates inside the range while positions accumulate/distribute.',
  C: 'Phase C — the test: a spring (or upthrust) probes beyond the range to check remaining supply/demand.',
  D: 'Phase D — trend emerges inside the range: signs of strength/weakness and last points of support/supply.',
  E: 'Phase E — price leaves the range: markup (or markdown) is under way.',
}

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

export type WyckoffDir = 'all' | 'bull' | 'bear'

export function WyckoffChart({
  analysis,
  isFetching,
  showSignals,
  showPhases,
  showTarget,
  evDir = 'all',
  minConf = 0,
}: {
  analysis: WyckoffAnalysis
  isFetching: boolean
  showSignals: boolean
  showPhases: boolean
  showTarget: boolean
  /** Direction filter for candidate events (all / bullish / bearish). */
  evDir?: WyckoffDir
  /** Minimum event confidence, 0..1. */
  minConf?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{ idx: number; frac: number } | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null)
  const [measure, setMeasure] = useState<Measurement | null>(null)

  const { bars, range, events, phases, target } = analysis

  const shownEvents = useMemo(
    () =>
      events.filter(
        (e) =>
          e.confidence >= minConf &&
          (evDir === 'all' || (evDir === 'bull' ? e.bullish : !e.bullish)),
      ),
    [events, evDir, minConf],
  )

  const eventByIdx = useMemo(() => {
    const m = new Map<number, (typeof events)[number]>()
    if (showSignals) for (const e of shownEvents) m.set(e.idx, e)
    return m
  }, [shownEvents, showSignals])

  const phaseAt = useMemo(() => {
    return (idx: number) => phases.find((p) => idx >= p.startIdx && idx <= p.endIdx) ?? null
  }, [phases])

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

  // VsaBar → ProChartRow so the shared MeasureBar can do the range math.
  const measureRows = useMemo<ProChartRow[]>(
    () =>
      bars.map((b, i) => ({
        date: b.date,
        v: b.c,
        vol: b.vol,
        upDay: i === 0 ? true : b.c >= bars[i - 1].c,
      })),
    [bars],
  )

  if (!layout) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-subtle">
        Not enough price data for this range.
      </div>
    )
  }

  const { candleW, cx, yP, yV } = layout

  const idxFromEvent = (e: React.MouseEvent): number | null => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const vbx = frac * VB_W
    const idx = Math.round((vbx - PLOT_L) / layout.slot - 0.5)
    return idx >= 0 && idx < bars.length ? idx : null
  }

  const onMove = (e: React.MouseEvent) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const idx = idxFromEvent(e)
    if (idx === null) {
      setHover(null)
      return
    }
    setHover({ idx, frac })
    if (drag) setDrag((d) => (d ? { ...d, end: idx } : d))
  }

  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const idx = idxFromEvent(e)
    if (idx !== null) {
      setDrag({ start: idx, end: idx })
      setMeasure(null)
    }
  }

  const onUp = () => {
    if (!drag) return
    const { start, end } = drag
    setDrag(null)
    if (start !== end) {
      const [a, b] = start <= end ? [start, end] : [end, start]
      setMeasure({ startDate: bars[a].date, endDate: bars[b].date })
    } else {
      // Plain click — pin/unpin the tooltip on this bar.
      setPinned((p) => (p === start ? null : start))
    }
  }

  // Pinned bar wins the tooltip so its event note can be read (and copied)
  // without chasing the cursor. Bounds-guarded in case the bar set shrinks.
  const pinnedSafe = pinned !== null && pinned < bars.length ? pinned : null
  const shownIdx = pinnedSafe ?? hover?.idx ?? null
  const hb = shownIdx !== null ? bars[shownIdx] : null
  const hev = shownIdx !== null ? eventByIdx.get(shownIdx) : undefined
  const hPhase = shownIdx !== null && showPhases ? phaseAt(shownIdx) : null
  const inRange = range && shownIdx !== null && shownIdx >= range.startIdx && shownIdx <= range.endIdx
  const tooltipFrac =
    pinnedSafe !== null ? Math.min(Math.max(cx(pinnedSafe) / VB_W, 0.05), 0.95) : hover?.frac ?? 0.5
  const rangeBand = range ? { top: yP(range.resistance), bottom: yP(range.support) } : null
  const targetY = showTarget && target ? yP(target.price) : null
  const dragSel = drag && drag.start !== drag.end
    ? { x0: cx(Math.min(drag.start, drag.end)), x1: cx(Math.max(drag.start, drag.end)) }
    : null
  const measureSel = selectionExtent(measure, bars, cx)

  return (
    <div className="relative select-none" style={{ opacity: isFetching ? 0.55 : 1 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        style={{ display: 'block' }}
        onMouseMove={onMove}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onMouseLeave={() => {
          setHover(null)
          setDrag(null)
        }}
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
                <text x={(Math.max(PLOT_L, x0) + Math.min(PLOT_R, x1)) / 2} y={PRICE_TOP + 11} fontSize={11} fontWeight={700} style={{ fill: 'var(--subtle)' }} textAnchor="middle">
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
            <line x1={PLOT_L} y1={targetY} x2={PLOT_R} y2={targetY} strokeWidth={1} strokeDasharray="2 3" style={{ stroke: target.direction === 'up' ? EV_BULL : EV_BEAR }} />
            <text x={PLOT_L + 2} y={targetY - 3} fontSize={10} fontWeight={600} style={{ fill: target.direction === 'up' ? EV_BULL : EV_BEAR }}>
              Target ≈ ${target.price.toFixed(2)}
            </text>
          </>
        )}

        {/* price grid + y labels */}
        {priceTicks.map((t, i) => (
          <g key={i}>
            <line x1={PLOT_L} y1={t.y} x2={PLOT_R} y2={t.y} style={{ stroke: 'var(--surface-2)' }} strokeWidth={1} />
            <text x={PLOT_L - 4} y={t.y + 3} fontSize={10} style={{ fill: 'var(--subtle)' }} textAnchor="end">
              ${t.p.toFixed(t.p < 10 ? 1 : 0)}
            </text>
          </g>
        ))}

        {/* drag-select / measured region */}
        {(dragSel || measureSel) && (
          <rect
            x={(dragSel ?? measureSel)!.x0}
            y={PRICE_TOP}
            width={Math.max((dragSel ?? measureSel)!.x1 - (dragSel ?? measureSel)!.x0, 1)}
            height={VOL_BOT - PRICE_TOP}
            fill="var(--accent)"
            opacity={0.08}
          />
        )}

        {/* candles */}
        {bars.map((b, i) => {
          const x = cx(i)
          const color = b.up ? UP : DOWN
          const top = yP(Math.max(b.o, b.c))
          const bottom = yP(Math.min(b.o, b.c))
          const border = borderFor(b.cls)
          return (
            <g key={i}>
              <line x1={x} y1={yP(b.h)} x2={x} y2={yP(b.l)} strokeWidth={Math.min(candleW * 0.18, 1.4)} style={{ stroke: color }} />
              <rect
                x={x - candleW / 2}
                y={top}
                width={candleW}
                height={Math.max(bottom - top, 1)}
                strokeWidth={border ? Math.min(candleW * 0.22, 1.6) : 0}
                style={{ fill: color, stroke: border ?? 'none' }}
              />
            </g>
          )
        })}

        {/* Wyckoff event markers */}
        {showSignals &&
          shownEvents.map((e, i) => {
            const b = bars[e.idx]
            const x = cx(e.idx)
            const color = e.bullish ? EV_BULL : EV_BEAR
            const atTop = TOP_EVENTS.has(e.type)
            const y = atTop ? yP(b.h) - 6 : yP(b.l) + 6
            const tri = atTop ? `${x},${y} ${x - 3},${y - 5} ${x + 3},${y - 5}` : `${x},${y} ${x - 3},${y + 5} ${x + 3},${y + 5}`
            return (
              <g key={`e${i}`} opacity={0.55 + 0.45 * e.confidence}>
                <title>{`${e.label} (candidate, ${Math.round(e.confidence * 100)}%) — ${fmtDate(e.date)} — click to pin`}</title>
                <polygon points={tri} style={{ fill: color }} />
                <text x={x} y={atTop ? y - 7 : y + 13} fontSize={9} textAnchor="middle" fontWeight={600} style={{ fill: color }}>
                  {e.label}
                </text>
              </g>
            )
          })}

        {/* volume panel */}
        <line x1={PLOT_L} y1={VOL_BOT} x2={PLOT_R} y2={VOL_BOT} style={{ stroke: 'var(--border)' }} strokeWidth={0.5} />
        {bars.map((b, i) => {
          if (b.vol == null) return null
          const x = cx(i)
          const y = yV(b.vol)
          const fill = b.cls === 'climax' ? CLIMAX : b.up ? UP : DOWN
          return (
            <rect key={`v${i}`} x={x - candleW / 2} y={y} width={candleW} height={Math.max(VOL_BOT - y, 0)} fillOpacity={b.cls === 'climax' ? 1 : 0.5} style={{ fill }} />
          )
        })}
        <text x={PLOT_L - 4} y={VOL_TOP + 8} fontSize={10} style={{ fill: 'var(--subtle)' }} textAnchor="end">Vol</text>

        {/* x month labels */}
        {monthTicks.map((t, i) => (
          <text key={i} x={t.x} y={VB_H - 4} fontSize={10} style={{ fill: 'var(--subtle)' }} textAnchor="middle">
            {t.label}
          </text>
        ))}

        {/* crosshair — pinned bar locked, hover otherwise */}
        {shownIdx !== null && (
          <line
            x1={cx(shownIdx)}
            y1={PRICE_TOP}
            x2={cx(shownIdx)}
            y2={VOL_BOT}
            style={{ stroke: pinnedSafe !== null ? 'var(--accent)' : 'var(--border-strong)' }}
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        )}
      </svg>

      {/* tooltip */}
      {hb && (
        <div
          className={`absolute top-1 z-10 rounded-lg border bg-surface px-3 py-2 text-xs shadow-card ${
            pinnedSafe !== null ? 'border-accent' : 'pointer-events-none border-line'
          }`}
          style={{ left: `${(tooltipFrac * 100).toFixed(2)}%`, transform: tooltipFrac > 0.6 ? 'translateX(-105%)' : 'translateX(8px)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-ink">{fmtDate(hb.date)}</span>
            {pinnedSafe !== null && (
              <button
                type="button"
                onClick={() => setPinned(null)}
                aria-label="Unpin"
                className="rounded px-1 text-[0.7rem] font-bold text-muted hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>
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
              style={{ color: hb.cls === 'climax' ? 'var(--warn)' : 'var(--muted)', background: hb.cls === 'climax' ? 'var(--warn-soft)' : 'var(--surface-2)' }}
            >
              {CLS_LABEL[hb.cls]}
            </div>
          )}
          {inRange && range && (
            <div className="mt-1 text-[0.68rem]" style={{ color: '#378ADD' }}>
              Range ${range.support.toFixed(2)}–${range.resistance.toFixed(2)}
              {range.support > 0 && ` · ${(((range.resistance - range.support) / range.support) * 100).toFixed(1)}% wide`}
            </div>
          )}
          {hPhase && (
            <div className="mt-1 max-w-[230px] text-[0.66rem] leading-snug text-subtle">
              {PHASE_NOTE[hPhase.id]}
            </div>
          )}
          {hev && (
            <div className="mt-1.5 max-w-[230px] border-t border-line pt-1.5">
              <span className="font-semibold" style={{ color: hev.bullish ? EV_BULL : EV_BEAR }}>
                {hev.label} · candidate · {Math.round(hev.confidence * 100)}%
              </span>
              <div className="mt-0.5 text-[0.68rem] leading-snug text-muted">{hev.note}</div>
            </div>
          )}
          {pinned === null && (
            <div className="mt-1 text-[0.62rem] text-subtle">Click to pin · drag to measure</div>
          )}
        </div>
      )}

      {/* drag-measure result */}
      {measure && (
        <MeasureBar rows={measureRows} measure={measure} onClear={() => setMeasure(null)} />
      )}
    </div>
  )
}

/** Selection x-extent for a stored measurement (plain fn — bars/cx are stable per render). */
function selectionExtent(
  measure: Measurement | null,
  bars: VsaBar[],
  cx: (i: number) => number,
): { x0: number; x1: number } | null {
  if (!measure) return null
  const a = bars.findIndex((b) => b.date === measure.startDate)
  const b = bars.findIndex((x) => x.date === measure.endDate)
  if (a < 0 || b < 0) return null
  return { x0: cx(Math.min(a, b)), x1: cx(Math.max(a, b)) }
}
