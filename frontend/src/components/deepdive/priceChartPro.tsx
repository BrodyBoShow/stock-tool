/**
 * Pro-interactivity pieces for the deep-dive price chart: the live hover
 * readout strip (TradingView-style), the enriched tooltip, the drag-measure
 * summary bar, the compare-overlay picker, and the pinned day-events card.
 * All presentational — every number traces to a real row value; nothing here
 * fabricates or forecasts.
 */
import { useState, type ReactNode } from 'react'

import { fmtDate, fmtVol } from '@/lib/format'

import {
  compareColor,
  MA200_COLOR,
  MA50_COLOR,
  MARKER_META,
  MAX_COMPARE,
  OVERLAY_COLOR,
  type MarkerItem,
  type ProChartRow,
  type WindowStats,
} from './priceChartUtils'

// ── tiny shared formatters ────────────────────────────────────────────────────

const sPct = (x: number, dec = 2) => `${x >= 0 ? '+' : ''}${x.toFixed(dec)}%`
const money = (x: number) => `$${x >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : x.toFixed(2)}`
const posNeg = (x: number) => ({ color: x >= 0 ? 'var(--pos)' : 'var(--neg)' })

// ── Readout strip ─────────────────────────────────────────────────────────────

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.58rem] font-semibold uppercase tracking-wide text-subtle">{label}</div>
      <div className="whitespace-nowrap text-[0.78rem] font-bold tabular-nums text-ink">{children}</div>
    </div>
  )
}

/** Always-visible stat strip that live-updates as the cursor moves across the
 * chart (idle = the latest bar). The single most "pro tool" affordance: you
 * read values here instead of chasing a floating box. */
export function ChartReadout({
  rows,
  hoverIdx,
  stats,
  showMA50,
  showMA200,
  overlayMeta,
  compare,
  eventsAt,
}: {
  rows: ProChartRow[]
  hoverIdx: number | null
  stats: WindowStats | null
  showMA50: boolean
  showMA200: boolean
  overlayMeta: { label: string; unit: string; dec: number } | null
  compare: { ticker: string; color: string; since?: string | null }[]
  eventsAt: (date: string) => MarkerItem[]
}) {
  if (rows.length === 0 || !stats) return null
  const idx = hoverIdx != null && hoverIdx >= 0 && hoverIdx < rows.length ? hoverIdx : rows.length - 1
  const cur = rows[idx]
  const prev = idx > 0 ? rows[idx - 1] : null
  const close = cur.vRaw ?? cur.v
  const prevClose = prev ? (prev.vRaw ?? prev.v) : null
  const dayPct = prevClose && prevClose > 0 ? ((close / prevClose) - 1) * 100 : null
  const dayAbs = prevClose !== null ? close - prevClose : null
  const fromStart = stats.first > 0 ? ((close / stats.first) - 1) * 100 : null
  const offHigh = stats.high > 0 ? ((close / stats.high) - 1) * 100 : null
  const relVol = cur.vol != null && cur.avgVol20 ? cur.vol / cur.avgVol20 : null
  const events = eventsAt(cur.date)

  return (
    <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1.5 rounded-lg border border-line bg-surface-2 px-3 py-2">
      <Block label={hoverIdx != null ? 'Hovered' : 'Latest'}>{fmtDate(cur.date)}</Block>
      <Block label="Close">
        {money(close)}{' '}
        {dayPct != null && (
          <span style={posNeg(dayPct)}>
            {dayAbs != null && `${dayAbs >= 0 ? '+' : '−'}$${Math.abs(dayAbs).toFixed(2)} `}({sPct(dayPct)}
            <span className="font-semibold text-subtle"> 1d</span>)
          </span>
        )}
      </Block>
      {fromStart != null && (
        <Block label="Window">
          <span style={posNeg(fromStart)}>{sPct(fromStart)}</span>
        </Block>
      )}
      {cur.vol != null && (
        <Block label="Volume">
          {fmtVol(cur.vol)}
          {relVol != null && <span className="font-semibold text-muted"> · {relVol.toFixed(1)}× avg</span>}
        </Block>
      )}
      {showMA50 && typeof (cur.ma50Raw ?? cur.ma50) === 'number' && (
        <Block label="50d MA">
          <span style={{ color: MA50_COLOR }}>
            {money((cur.ma50Raw ?? cur.ma50) as number)}
            {close > 0 && ` (${sPct(((close / ((cur.ma50Raw ?? cur.ma50) as number)) - 1) * 100, 1)})`}
          </span>
        </Block>
      )}
      {showMA200 && typeof (cur.ma200Raw ?? cur.ma200) === 'number' && (
        <Block label="200d MA">
          <span style={{ color: MA200_COLOR }}>
            {money((cur.ma200Raw ?? cur.ma200) as number)}
            {close > 0 && ` (${sPct(((close / ((cur.ma200Raw ?? cur.ma200) as number)) - 1) * 100, 1)})`}
          </span>
        </Block>
      )}
      {overlayMeta && typeof cur.macro === 'number' && (
        <Block label={overlayMeta.label}>
          <span style={{ color: OVERLAY_COLOR }}>
            {cur.macro.toFixed(overlayMeta.dec)}{overlayMeta.unit}
          </span>
        </Block>
      )}
      {compare.map((c) => {
        const v = cur[`cmp_${c.ticker}`]
        return (
          <Block key={c.ticker} label={c.since ? `${c.ticker} · since ${fmtDate(c.since).replace(/, \d{4}$/, '')}` : c.ticker}>
            <span style={{ color: c.color }}>
              {typeof v === 'number' ? sPct(v, 1) : '—'}
            </span>
          </Block>
        )
      })}
      <Block label="Window hi / lo">
        {money(stats.high)} / {money(stats.low)}
        {offHigh != null && offHigh < 0 && (
          <span className="font-semibold text-muted"> · {sPct(offHigh, 1)} off high</span>
        )}
      </Block>
      {events.length > 0 && (
        <Block label="This day">
          <span className="text-warn">
            {events.length} event{events.length > 1 ? 's' : ''} · click bar
          </span>
        </Block>
      )}
    </div>
  )
}

// ── Enriched floating tooltip ─────────────────────────────────────────────────

interface RTooltipProps {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number | string | null; payload?: ProChartRow }>
  label?: string
}

export function PriceProTooltip({
  active,
  payload,
  label,
  pctMode,
  overlayMeta,
  showMA,
  compare,
  eventsAt,
}: RTooltipProps & {
  pctMode: boolean
  overlayMeta?: { label: string; unit: string; dec: number } | null
  showMA: boolean
  compare: { ticker: string; color: string }[]
  eventsAt: (date: string) => MarkerItem[]
}) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  const close = row.vRaw ?? row.v
  const chgPct = row.chgPct
  const events = label ? eventsAt(String(label)) : []
  const ma50 = row.ma50Raw ?? row.ma50
  const ma200 = row.ma200Raw ?? row.ma200
  return (
    <div className="max-w-[260px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-ink">{fmtDate(label)}</span>
        {typeof chgPct === 'number' && (
          <span className="font-bold tabular-nums" style={posNeg(chgPct)}>
            {sPct(chgPct)} <span className="font-semibold text-subtle">1d</span>
          </span>
        )}
      </div>
      <div className="mt-0.5 font-bold tabular-nums text-ink">
        {money(close)}
        {pctMode && typeof row.v === 'number' && (
          <span className="ml-1.5 font-semibold text-accent">{sPct(row.v, 1)} window</span>
        )}
      </div>
      {row.vol != null && (
        <div className="tabular-nums text-muted">
          Vol {fmtVol(row.vol)}
          {row.avgVol20 ? ` · ${(row.vol / row.avgVol20).toFixed(1)}× 20d avg` : ''}
        </div>
      )}
      {showMA && (
        <div className="mt-0.5 space-y-px tabular-nums">
          {typeof ma50 === 'number' && <div style={{ color: MA50_COLOR }}>MA50 {money(ma50)}</div>}
          {typeof ma200 === 'number' && <div style={{ color: MA200_COLOR }}>MA200 {money(ma200)}</div>}
        </div>
      )}
      {overlayMeta && typeof row.macro === 'number' && (
        <div className="tabular-nums" style={{ color: OVERLAY_COLOR }}>
          {overlayMeta.label}: {row.macro.toFixed(overlayMeta.dec)}{overlayMeta.unit}
        </div>
      )}
      {compare.length > 0 && (
        <div className="mt-0.5 space-y-px tabular-nums">
          {compare.map((c) => {
            const v = row[`cmp_${c.ticker}`]
            return typeof v === 'number' ? (
              <div key={c.ticker} style={{ color: c.color }}>{c.ticker} {sPct(v, 1)}</div>
            ) : null
          })}
        </div>
      )}
      {events.length > 0 && (
        <div className="mt-1 border-t border-line pt-1">
          {events.slice(0, 3).map((e) => (
            <div key={e.key} className="flex items-start gap-1 leading-snug text-muted">
              <span aria-hidden style={{ color: MARKER_META[e.cat].color }}>{MARKER_META[e.cat].glyph}</span>
              <span className="min-w-0 truncate">{e.title}</span>
            </div>
          ))}
          {events.length > 3 && <div className="text-subtle">+{events.length - 3} more</div>}
          <div className="mt-0.5 text-[0.66rem] font-semibold text-subtle">Click bar for details</div>
        </div>
      )}
    </div>
  )
}

// ── Drag-measure summary bar ──────────────────────────────────────────────────

export interface Measurement {
  startDate: string
  endDate: string
}

export function MeasureBar({
  rows,
  measure,
  onZoom,
  onClear,
}: {
  rows: ProChartRow[]
  measure: Measurement
  onZoom: () => void
  onClear: () => void
}) {
  const i1 = rows.findIndex((r) => r.date === measure.startDate)
  const i2 = rows.findIndex((r) => r.date === measure.endDate)
  if (i1 < 0 || i2 < 0) return null
  const [a, b] = i1 <= i2 ? [i1, i2] : [i2, i1]
  const slice = rows.slice(a, b + 1)
  const v0 = slice[0].vRaw ?? slice[0].v
  const v1 = slice[slice.length - 1].vRaw ?? slice[slice.length - 1].v
  const pct = v0 > 0 ? ((v1 / v0) - 1) * 100 : null
  let hi = -Infinity
  let lo = Infinity
  let vol = 0
  for (const r of slice) {
    const v = r.vRaw ?? r.v
    if (v > hi) hi = v
    if (v < lo) lo = v
    if (r.vol != null) vol += r.vol
  }
  const calDays = Math.max(
    1,
    Math.round(
      (new Date(slice[slice.length - 1].date).getTime() - new Date(slice[0].date).getTime()) / 86_400_000,
    ),
  )
  const annualized =
    pct != null && calDays >= 90 && v0 > 0 ? (Math.pow(v1 / v0, 365 / calDays) - 1) * 100 : null

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-accent bg-accent-soft px-3 py-1.5 text-[0.74rem] font-semibold text-ink">
      <span className="text-accent">Measure</span>
      <span className="tabular-nums">{fmtDate(slice[0].date)} → {fmtDate(slice[slice.length - 1].date)}</span>
      <span className="tabular-nums text-muted">{slice.length} bars · {calDays}d</span>
      {pct != null && (
        <span className="tabular-nums" style={posNeg(pct)}>
          {sPct(pct)} ({`${v1 - v0 >= 0 ? '+' : '−'}$${Math.abs(v1 - v0).toFixed(2)}`})
        </span>
      )}
      {annualized != null && (
        <span
          className="tabular-nums text-muted"
          title="Compound annual rate if this pace continued — an arithmetic extrapolation, not a forecast."
        >
          ann. {sPct(annualized, 1)}/yr
        </span>
      )}
      <span className="tabular-nums text-muted">hi {money(hi)} · lo {money(lo)}</span>
      {vol > 0 && <span className="tabular-nums text-muted">Σvol {fmtVol(vol)}</span>}
      <span className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onZoom}
          className="rounded-md bg-accent-solid px-2 py-0.5 text-[0.7rem] font-bold text-accent-ink hover:bg-accent-hover"
        >
          Zoom to selection
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear measurement"
          className="rounded-md border border-line bg-surface px-2 py-0.5 text-[0.7rem] font-bold text-muted hover:text-ink"
        >
          ✕
        </button>
      </span>
    </div>
  )
}

// ── Compare picker ────────────────────────────────────────────────────────────

export function CompareBar({
  active,
  onToggle,
  suggestions,
  missing,
}: {
  active: string[]
  onToggle: (t: string) => void
  suggestions: string[] // benchmarks first, then peers
  missing: string[] // requested but no data came back
}) {
  const [draft, setDraft] = useState('')
  const submit = () => {
    const t = draft.trim().toUpperCase()
    if (t) onToggle(t)
    setDraft('')
  }
  // Chips: every active ticker + remaining suggestions (dedup, keep order)
  const chips = [...active, ...suggestions.filter((s) => !active.includes(s))]
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-subtle">Compare</span>
      {chips.map((t) => {
        const on = active.includes(t)
        const idx = active.indexOf(t)
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            aria-pressed={on}
            disabled={!on && active.length >= MAX_COMPARE}
            title={
              !on && active.length >= MAX_COMPARE
                ? `Up to ${MAX_COMPARE} at once — remove one first`
                : on
                  ? `Remove ${t}`
                  : `Overlay ${t} — % change from its first bar in view`
            }
            className={
              'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[0.7rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
              (on ? 'border-line bg-surface text-ink' : 'border-line bg-surface-2 text-subtle hover:text-muted')
            }
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ background: on ? compareColor(idx) : 'var(--border-strong)' }}
            />
            {t}
            {on && <span aria-hidden className="text-subtle">✕</span>}
          </button>
        )
      })}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase().replace(/[^A-Z.-]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="+ ticker"
        maxLength={6}
        aria-label="Add a ticker to compare"
        className="w-[74px] rounded-md border border-line bg-surface px-2 py-0.5 text-[0.7rem] font-semibold text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
      />
      {missing.length > 0 && (
        <span className="text-[0.68rem] text-subtle">no price data: {missing.join(', ')}</span>
      )}
      {active.length > 0 && (
        <span className="text-[0.66rem] text-subtle">
          % scale · each series rebased to its first bar in view
        </span>
      )}
    </div>
  )
}

// ── Pinned day-events card (click a bar with markers) ────────────────────────

export function DayEventsCard({
  date,
  items,
  onClose,
}: {
  date: string
  items: MarkerItem[]
  onClose: () => void
}) {
  return (
    <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[0.74rem] font-bold text-ink">Events on {fmtDate(date)}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close day events"
          className="rounded px-1 text-[0.74rem] font-bold text-muted hover:text-ink"
        >
          ✕
        </button>
      </div>
      <ul className="mt-1 space-y-1">
        {items.map((e) => (
          <li key={e.key} className="flex items-start gap-1.5 text-[0.74rem] leading-snug">
            <span aria-hidden className="mt-px" style={{ color: MARKER_META[e.cat].color }}>
              {MARKER_META[e.cat].glyph}
            </span>
            <span className="min-w-0">
              <span className="font-semibold text-ink">{e.title}</span>
              {e.detail && <span className="text-muted"> — {e.detail}</span>}
              {e.url && (
                <>
                  {' '}
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-accent hover:underline"
                  >
                    open filing ↗
                  </a>
                </>
              )}
              {e.date !== e.snapDate && (
                <span className="text-subtle"> (dated {fmtDate(e.date)}, shown on nearest bar)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
