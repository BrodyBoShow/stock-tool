import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Area,
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { WyckoffChart } from '@/components/deepdive/WyckoffChart'
import { getCompareSeries, getEvents, getInsiders, getMacroSeries, getPeers } from '@/lib/api'
import { useChartTheme } from '@/lib/chartTheme'
import { MACRO_DISPLAY } from '@/lib/constants'
import { fmtVol, tickLabel } from '@/lib/format'
import { analyzeWyckoff } from '@/lib/wyckoff'
import type { FilingRow, PricePoint } from '@/types/api'

import { OverlayToggle, VolumeTooltip } from './priceChartParts'
import {
  ChartReadout,
  CompareBar,
  DayEventsCard,
  MeasureBar,
  PriceProTooltip,
  type Measurement,
} from './priceChartPro'
import {
  asOfMerge,
  buildRanges,
  compareColor,
  MA200_COLOR,
  MA50_COLOR,
  MARKER_META,
  MARKER_ORDER,
  MAX_COMPARE,
  mergeCompareSeries,
  OVERLAY_COLOR,
  rollingMean,
  toPercentMode,
  windowStats,
  withAvgVol,
  type MarkerCat,
  type MarkerItem,
  type ProChartRow,
} from './priceChartUtils'
import { WyckoffReadPanel } from './WyckoffReadPanel'

const MARKER_CAP = 60 // per category, most-recent kept — keeps a wide window legible

// Recharts mouse-event state (loosely typed upstream).
interface ChartMouseState {
  activeLabel?: string | number
  activeTooltipIndex?: number
}

export function PriceChart({
  prices,
  days,
  onDaysChange,
  isFetching,
  ticker,
  filings = [],
}: {
  prices: PricePoint[]
  days: number
  onDaysChange: (d: number) => void
  isFetching: boolean
  ticker: string
  filings?: FilingRow[]
}) {
  const [mode, setMode] = useState<'price' | 'wyckoff'>('price')
  const [showSignals, setShowSignals] = useState(true)
  const [showPhases, setShowPhases] = useState(true)
  const [showTarget, setShowTarget] = useState(false)
  const [evDir, setEvDir] = useState<'all' | 'bull' | 'bear'>('all')
  const [minConf, setMinConf] = useState(0)
  const [overlayOn, setOverlayOn] = useState(false)
  const [seriesId, setSeriesId] = useState('VIXCLS')
  const [showMA50, setShowMA50] = useState(false)
  const [showMA200, setShowMA200] = useState(false)
  const [showVolume, setShowVolume] = useState(false)
  const [showMarkers, setShowMarkers] = useState(false)
  // Defaults preserve the prior behavior — high-signal 8-Ks + insider buys — and
  // leave the noisier categories opt-in so a multi-year window stays legible.
  const [cats, setCats] = useState<Record<MarkerCat, boolean>>({
    earnings: false, k8_high: true, k8_routine: false, other_filing: false, buy: true, sell: false,
  })
  // Pro interactivity state
  const [pctMode, setPctMode] = useState(false)
  const [logScale, setLogScale] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compare, setCompare] = useState<string[]>([])
  const [zoom, setZoom] = useState<{ start: string; end: string } | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ start: string; end: string } | null>(null)
  const [measure, setMeasure] = useState<Measurement | null>(null)
  const [pinnedDay, setPinnedDay] = useState<string | null>(null)

  const ranges = useMemo(() => buildRanges(), [])
  const ct = useChartTheme()

  const wyckoff = useMemo(() => analyzeWyckoff(prices), [prices])

  const priceRows = useMemo<ProChartRow[]>(() => {
    // > 0 (not just non-null): a zero close would blow up the log scale and % rebase
    const filtered = prices.filter((p) => (p.adj_close ?? 0) > 0)
    const ma50Vals = rollingMean(filtered.map((p) => p.adj_close), 50)
    const ma200Vals = rollingMean(filtered.map((p) => p.adj_close), 200)
    const base: ProChartRow[] = filtered.map((p, i) => {
      const prev = i > 0 ? (filtered[i - 1].adj_close as number) : null
      const cur = p.adj_close as number
      return {
        date: p.date,
        v: cur,
        vol: p.volume ?? null,
        upDay: i === 0 ? true : cur >= (prev ?? cur),
        chgPct: prev && prev > 0 ? ((cur / prev) - 1) * 100 : null,
        ma50: ma50Vals[i],
        ma200: ma200Vals[i],
      }
    })
    return withAvgVol(base)
  }, [prices])

  const hasVolume = priceRows.some((r) => r.vol !== null)
  const dateRange = useMemo(
    () =>
      priceRows.length > 0
        ? { start: priceRows[0].date, end: priceRows[priceRows.length - 1].date }
        : null,
    [priceRows],
  )

  const { data: macroData } = useQuery({
    queryKey: ['macro', 'series', seriesId],
    queryFn: () => getMacroSeries(seriesId),
    enabled: overlayOn,
    staleTime: 6 * 60 * 60 * 1000,
  })

  const { data: eventsData } = useQuery({
    queryKey: ['events', ticker],
    queryFn: () => getEvents(ticker),
    enabled: showMarkers,
    staleTime: 10 * 60 * 1000,
  })

  const { data: insidersData } = useQuery({
    queryKey: ['insiders', ticker],
    queryFn: () => getInsiders(ticker),
    enabled: showMarkers,
    staleTime: 10 * 60 * 1000,
  })

  const { data: compareData, isFetching: compareFetching } = useQuery({
    queryKey: ['compare-series', compare.join(','), days],
    queryFn: () => getCompareSeries(compare, days),
    enabled: compare.length > 0,
    staleTime: 30 * 60 * 1000,
  })

  const { data: peersData } = useQuery({
    queryKey: ['peers', ticker],
    queryFn: () => getPeers(ticker),
    staleTime: 30 * 60 * 1000,
  })

  // Compare is only meaningful on a common % scale — force percent mode on.
  const pctOn = pctMode || compare.length > 0
  const logOn = logScale && !pctOn

  // Visible window: optional client-side zoom slice from drag-select.
  const zoomRows = useMemo<ProChartRow[]>(() => {
    if (!zoom) return priceRows
    const rows = priceRows.filter((r) => r.date >= zoom.start && r.date <= zoom.end)
    return rows.length >= 2 ? rows : priceRows
  }, [priceRows, zoom])

  const data = useMemo<ProChartRow[]>(() => {
    let rows = zoomRows
    if (overlayOn && macroData) rows = asOfMerge(rows, macroData.observations) as ProChartRow[]
    const loaded = compareData?.series.filter((s) => compare.includes(s.ticker)) ?? []
    if (loaded.length > 0) rows = mergeCompareSeries(rows, loaded)
    if (pctOn) rows = toPercentMode(rows, loaded.map((s) => s.ticker))
    return rows
  }, [zoomRows, overlayOn, macroData, compareData, compare, pctOn])

  const stats = useMemo(() => windowStats(data), [data])

  // Compare tickers that came back empty (no price data) — shown honestly.
  const compareMissing = useMemo(() => {
    if (!compareData || compare.length === 0) return []
    const have = new Set(compareData.series.map((s) => s.ticker))
    return compare.filter((t) => !have.has(t))
  }, [compareData, compare])

  const compareSuggestions = useMemo(() => {
    const peers = (peersData?.peers ?? [])
      .map((p) => p.ticker)
      .filter((t) => t !== ticker)
      .slice(0, 3)
    return ['SPY', 'QQQ', 'IWM', ...peers]
  }, [peersData, ticker])

  // Reference lines sit on a categorical X axis, so a marker only renders when
  // its date exactly matches a price-bar date. Snap each marker to the latest
  // trading day on/before it, so a buy/8-K dated on a non-trading day (or a gap
  // in the series) still draws instead of silently vanishing.
  const snapToBar = useMemo(() => {
    const dates = priceRows.map((r) => r.date)
    return (d: string): string | null => {
      if (dates.length === 0) return null
      if (d <= dates[0]) return dates[0]
      if (d >= dates[dates.length - 1]) return dates[dates.length - 1]
      let lo = 0
      let hi = dates.length - 1
      let ans = dates[0]
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (dates[mid] <= d) {
          ans = dates[mid]
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return ans
    }
  }, [priceRows])

  // All filing/event markers, bucketed by category, filtered to the visible
  // range, capped per category (most-recent kept) so a wide window stays legible.
  const markers = useMemo(() => {
    const counts = { earnings: 0, k8_high: 0, k8_routine: 0, other_filing: 0, buy: 0, sell: 0 } as Record<MarkerCat, number>
    if (!showMarkers || !dateRange) return { list: [] as MarkerItem[], counts, capped: [] as MarkerCat[] }
    const inRange = (d: string | null | undefined): d is string =>
      !!d && d >= dateRange.start && d <= dateRange.end
    const buckets: Record<MarkerCat, { date: string; title: string; detail?: string; url?: string | null }[]> = {
      earnings: [], k8_high: [], k8_routine: [], other_filing: [], buy: [], sell: [],
    }
    // 8-K material events — richer plain-English labels than the raw filing row.
    for (const e of eventsData?.events ?? []) {
      const d = e.event_date || e.filed_date
      if (!inRange(d)) continue
      const cat: MarkerCat = e.high_signal ? 'k8_high' : 'k8_routine'
      buckets[cat].push({
        date: d,
        title: e.labels[0] ?? '8-K',
        detail: e.labels.length > 1 ? e.labels.slice(1).join(', ') : undefined,
        url: e.primary_doc_url,
      })
    }
    // SEC filings — 10-K/10-Q and everything else. 8-K comes from events above;
    // Form 3/4/5 are insider filings, shown via the buy/sell categories.
    for (const f of filings) {
      if (!inRange(f.filed_date)) continue
      const form = f.form.toUpperCase()
      if (form.startsWith('8-K') || /^[345](\/A)?$/.test(form)) continue
      const cat: MarkerCat = form.startsWith('10-K') || form.startsWith('10-Q') ? 'earnings' : 'other_filing'
      buckets[cat].push({ date: f.filed_date, title: f.label ?? f.form, url: f.primary_doc_url })
    }
    // Form 4 open-market trades.
    for (const t of insidersData?.transactions ?? []) {
      if (!inRange(t.transaction_date)) continue
      const detail =
        t.shares != null && t.price != null
          ? `${t.shares.toLocaleString('en-US')} sh @ $${t.price.toFixed(2)}${t.value != null ? ` ≈ $${Math.round(t.value).toLocaleString('en-US')}` : ''}`
          : undefined
      if (t.transaction_code === 'P') {
        buckets.buy.push({ date: t.transaction_date, title: `${t.owner_name} bought`, detail })
      } else if (t.transaction_code === 'S') {
        buckets.sell.push({ date: t.transaction_date, title: `${t.owner_name} sold`, detail })
      }
    }
    const list: MarkerItem[] = []
    const capped: MarkerCat[] = []
    for (const cat of MARKER_ORDER) {
      const items = buckets[cat]
      counts[cat] = items.length
      if (!cats[cat]) continue
      // Keep the most-recent MARKER_CAP. Sort desc by date first — the source
      // arrays are newest-first, so a bare slice(-CAP) would keep the OLDEST.
      const kept =
        items.length > MARKER_CAP
          ? [...items].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, MARKER_CAP)
          : items
      if (items.length > MARKER_CAP) capped.push(cat)
      kept.forEach((it, i) =>
        list.push({
          key: `${cat}-${i}-${it.date}`,
          date: it.date,
          snapDate: snapToBar(it.date) ?? it.date,
          cat,
          title: it.title,
          detail: it.detail,
          url: it.url,
        }),
      )
    }
    return { list, counts, capped }
  }, [showMarkers, cats, eventsData, insidersData, filings, dateRange, snapToBar])

  // Markers grouped by the bar they draw on — powers hover/click enumeration.
  const markersByDate = useMemo(() => {
    const m = new Map<string, MarkerItem[]>()
    for (const it of markers.list) {
      const arr = m.get(it.snapDate)
      if (arr) arr.push(it)
      else m.set(it.snapDate, [it])
    }
    return m
  }, [markers])

  const eventsAt = useCallback(
    (date: string): MarkerItem[] => markersByDate.get(date) ?? [],
    [markersByDate],
  )

  // Markers actually drawable in the visible (possibly zoomed) window.
  const visibleMarkers = useMemo(() => {
    if (data.length === 0) return []
    const start = data[0].date
    const end = data[data.length - 1].date
    return markers.list.filter((m) => m.snapDate >= start && m.snapDate <= end)
  }, [markers, data])

  // ── drag-select: measure + zoom ─────────────────────────────────────────────
  const onChartMouseDown = useCallback(
    (state?: ChartMouseState, e?: { button?: number }) => {
      // Primary button only — a right-click must not start (or clear) a selection,
      // and its context menu would swallow the matching mouseup.
      if (e && typeof e.button === 'number' && e.button !== 0) return
      const label = state?.activeLabel
      if (typeof label === 'string') {
        setDrag({ start: label, end: label })
        setMeasure(null)
      }
    },
    [],
  )

  const onChartMouseMove = useCallback((state?: ChartMouseState) => {
    const idx = state?.activeTooltipIndex
    setHoverIdx(typeof idx === 'number' && idx >= 0 ? idx : null)
    const label = state?.activeLabel
    if (typeof label === 'string') {
      setDrag((d) => (d ? { ...d, end: label } : d))
    }
  }, [])

  const onChartMouseUp = useCallback(
    (state?: ChartMouseState) => {
      if (!drag) return
      const label = typeof state?.activeLabel === 'string' ? state.activeLabel : drag.end
      if (label !== drag.start) {
        const [a, b] = drag.start <= label ? [drag.start, label] : [label, drag.start]
        setMeasure({ startDate: a, endDate: b })
      } else {
        // A plain click — pin/unpin that day's events when it has any.
        const day = drag.start
        setPinnedDay((p) => (p === day ? null : eventsAt(day).length > 0 ? day : p))
      }
      setDrag(null)
    },
    [drag, eventsAt],
  )

  const onChartMouseLeave = useCallback(() => {
    setHoverIdx(null)
    setDrag(null)
  }, [])

  const zoomToMeasure = useCallback(() => {
    if (!measure) return
    setZoom({ start: measure.startDate, end: measure.endDate })
    setMeasure(null)
    setHoverIdx(null)
  }, [measure])

  const resetView = useCallback(() => {
    setZoom(null)
    setMeasure(null)
    setDrag(null)
    setPinnedDay(null)
    setHoverIdx(null)
  }, [])

  const changeDays = useCallback(
    (d: number) => {
      resetView()
      onDaysChange(d)
    },
    [onDaysChange, resetView],
  )

  const toggleCompare = useCallback((t: string) => {
    setCompare((c) => {
      if (c.includes(t)) return c.filter((x) => x !== t)
      if (c.length >= MAX_COMPARE) return c
      return [...c, t]
    })
  }, [])

  // Esc: dismiss measure/pinned events first; a second Esc resets the zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return
      if (measure || pinnedDay || drag) {
        setMeasure(null)
        setPinnedDay(null)
        setDrag(null)
      } else if (zoom) {
        setZoom(null)
        setHoverIdx(null) // data length changes — a stale index would mislabel a bar as hovered
      }
    }
    if (mode !== 'price') return undefined
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [measure, pinnedDay, drag, zoom, mode])

  const overlayMeta = MACRO_DISPLAY.find((m) => m.id === seriesId) ?? null
  // Loaded overlays with a color keyed on the STABLE `compare` order, so chip,
  // line, tooltip, and readout colors always agree even when a requested
  // ticker came back with no data. `since` marks a series whose data starts
  // AFTER the visible window opens (e.g. a recent IPO) — its % rebase anchors
  // there, not at the window start, and the readout says so.
  const activeCompare = useMemo(
    () =>
      compare
        .filter((t) => compareData?.series.some((s) => s.ticker === t) ?? false)
        .map((t) => {
          const first = data.find((r) => typeof r[`cmp_${t}`] === 'number')?.date ?? null
          return {
            ticker: t,
            color: compareColor(compare.indexOf(t)),
            since: first && data.length > 0 && first !== data[0].date ? first : null,
          }
        }),
    [compare, compareData, data],
  )
  const pinnedItems = pinnedDay ? eventsAt(pinnedDay) : []

  const yTick = pctOn
    ? (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`
    : (v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      {/* Header + mode toggle + range buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-bold text-ink">
            {mode === 'wyckoff' ? 'Wyckoff · volume-spread' : 'Price history'}
          </div>
          <div className="mt-0.5 text-[0.78rem] text-muted">
            {mode === 'wyckoff'
              ? 'Daily candles · spread + volume · objective measures only'
              : 'Adjusted close (splits & dividends) · nightly data · drag to measure'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-surface-3 p-1">
            {(['price', 'wyckoff'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  'rounded-md px-3 py-1 text-xs font-bold capitalize transition-colors ' +
                  (mode === m
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-muted hover:text-ink')
                }
              >
                {m === 'wyckoff' ? 'Wyckoff' : 'Price'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-surface-3 p-1">
            {ranges.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => changeDays(r.days)}
                className={
                  'rounded-md px-3 py-1 text-xs font-bold transition-colors ' +
                  (days === r.days && !zoom
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-muted hover:text-ink')
                }
              >
                {r.label}
              </button>
            ))}
          </div>
          {mode === 'price' && (
            <>
              {/* $ / % scale */}
              <div className="flex gap-1 rounded-lg bg-surface-3 p-1">
                <button
                  type="button"
                  onClick={() => setPctMode(false)}
                  aria-pressed={!pctOn}
                  disabled={compare.length > 0}
                  title={compare.length > 0 ? 'Comparison uses the % scale — remove overlays to go back to $' : 'Dollar scale'}
                  className={
                    'rounded-md px-2.5 py-1 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
                    (!pctOn ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')
                  }
                >
                  $
                </button>
                <button
                  type="button"
                  onClick={() => setPctMode(true)}
                  aria-pressed={pctOn}
                  title="Percent change from window start"
                  className={
                    'rounded-md px-2.5 py-1 text-xs font-bold transition-colors ' +
                    (pctOn ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')
                  }
                >
                  %
                </button>
              </div>
              {/* lin / log */}
              <button
                type="button"
                onClick={() => setLogScale((x) => !x)}
                aria-pressed={logOn}
                disabled={pctOn}
                title={pctOn ? 'Log scale applies to the $ view' : 'Logarithmic price scale — equal % moves take equal height'}
                className={
                  'rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
                  (logOn
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line bg-surface text-muted hover:bg-surface-2')
                }
              >
                log
              </button>
            </>
          )}
        </div>
      </div>

      {/* Toggle controls — Price mode only (Wyckoff has its own legend) */}
      {mode === 'price' && (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* MA toggles */}
        <OverlayToggle
          on={showMA50}
          onToggle={() => setShowMA50((x) => !x)}
          label="50d MA"
          color={MA50_COLOR}
          bgOn="bg-info-soft"
          textOn="text-info"
          borderOn="border-info"
        />
        <OverlayToggle
          on={showMA200}
          onToggle={() => setShowMA200((x) => !x)}
          label="200d MA"
          color={MA200_COLOR}
          bgOn="bg-warn-soft"
          textOn="text-warn"
          borderOn="border-warn"
        />
        {hasVolume && (
          <OverlayToggle
            on={showVolume}
            onToggle={() => setShowVolume((x) => !x)}
            label="Volume"
            color="#10b981"
            bgOn="bg-pos-soft"
            textOn="text-pos"
            borderOn="border-pos-border"
          />
        )}
        <OverlayToggle
          on={showMarkers}
          onToggle={() => setShowMarkers((x) => !x)}
          label="Events & filings"
          color="#f59e0b"
          bgOn="bg-warn-soft"
          textOn="text-warn"
          borderOn="border-warn"
        />

        {/* Divider */}
        <span className="text-subtle">|</span>

        {/* Compare overlays (picker row renders below while open or active) */}
        <OverlayToggle
          on={compareOpen || compare.length > 0}
          onToggle={() => {
            if (compareOpen || compare.length > 0) {
              setCompareOpen(false)
              setCompare([])
            } else {
              setCompareOpen(true)
            }
          }}
          label={compare.length > 0 ? `Compare (${compare.length})` : 'Compare'}
          color="#db2777"
          bgOn="bg-accent-soft"
          textOn="text-accent"
          borderOn="border-accent"
        />

        {/* Macro overlay */}
        <OverlayToggle
          on={overlayOn}
          onToggle={() => setOverlayOn((x) => !x)}
          label="Macro overlay"
          color={OVERLAY_COLOR}
          bgOn="bg-accent-soft"
          textOn="text-accent"
          borderOn="border-accent"
        />
        {overlayOn && (
          <>
            <select
              value={seriesId}
              onChange={(e) => setSeriesId(e.target.value)}
              aria-label="Macro overlay series"
              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[0.76rem] font-semibold text-ink focus:border-violet-600 focus:outline-none"
            >
              {MACRO_DISPLAY.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <span className="text-[0.7rem] text-subtle">right axis · context only</span>
          </>
        )}

        {zoom && (
          <button
            type="button"
            onClick={() => {
              setZoom(null)
              setHoverIdx(null)
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-accent bg-accent-soft px-2.5 py-1 text-[0.76rem] font-bold text-accent hover:opacity-90"
            title="Back to the full range (Esc)"
          >
            Reset zoom ✕
          </button>
        )}
      </div>
      )}

      {/* Compare overlay picker — only while open or in use, to keep the stack lean */}
      {mode === 'price' && (compareOpen || compare.length > 0) && (
        <CompareBar
          active={compare}
          onToggle={toggleCompare}
          suggestions={compareSuggestions}
          missing={compareMissing}
        />
      )}

      {/* Marker category filters — each chip shows its count and toggles on/off */}
      {mode === 'price' && showMarkers && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-subtle">Show</span>
          {MARKER_ORDER.map((cat) => {
            const meta = MARKER_META[cat]
            const on = cats[cat]
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCats((c) => ({ ...c, [cat]: !c[cat] }))}
                aria-pressed={on}
                title={`${meta.label} — ${markers.counts[cat]} in this range`}
                className={
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[0.7rem] font-semibold transition-colors ' +
                  (on
                    ? 'border-line bg-surface text-ink'
                    : 'border-line bg-surface-2 text-subtle hover:text-muted')
                }
              >
                <span aria-hidden style={{ color: on ? meta.color : 'var(--border-strong)' }}>
                  {meta.glyph}
                </span>
                {meta.label}
                <span className="tabular-nums text-subtle">{markers.counts[cat]}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* VSA legend — Wyckoff mode */}
      {mode === 'wyckoff' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-0.5 text-[0.72rem] font-semibold text-warn">
            <span className="h-2 w-2 rounded-sm bg-[#ef9f27]" />
            Climax volume
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-0.5 text-[0.72rem] font-semibold text-muted">
            <span className="h-2 w-2 rounded-sm border border-slate-500" />
            Wide spread
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-0.5 text-[0.72rem] font-semibold text-muted">
            <span className="h-2 w-2 rounded-sm bg-slate-400" />
            Churn / no-demand
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-info-soft px-2 py-0.5 text-[0.72rem] font-semibold text-info">
            <span className="h-2 w-3 rounded-sm border border-dashed border-[#378ADD] bg-[rgba(55,138,221,0.15)]" />
            Trading range
          </span>
          <span className="mx-0.5 h-3 w-px bg-surface-3" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setShowSignals((x) => !x)}
            aria-pressed={showSignals}
            title="Candidate Wyckoff events (Spring, Upthrust, climaxes, strength/weakness). Heuristic — only drawn inside a detected trading range, and never confirmed."
            className={
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.72rem] font-semibold transition-colors ' +
              (showSignals
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-surface text-muted hover:bg-surface-2')
            }
          >
            <span className="h-2 w-2 rounded-full" style={{ background: showSignals ? '#7c3aed' : 'var(--border-strong)' }} />
            Candidate signals
          </button>
          {showSignals && (
            <>
              <div className="flex gap-0.5 rounded-lg bg-surface-3 p-0.5" role="group" aria-label="Signal direction filter">
                {(['all', 'bull', 'bear'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setEvDir(d)}
                    aria-pressed={evDir === d}
                    title={
                      d === 'all'
                        ? 'Show every candidate event'
                        : d === 'bull'
                          ? 'Only bullish candidates (SC, AR, ST, Spring, Test, SOS, LPS)'
                          : 'Only bearish candidates (BC, AR, ST, UT, UTAD, SOW, LPSY)'
                    }
                    className={
                      'rounded-md px-2 py-0.5 text-[0.7rem] font-bold capitalize transition-colors ' +
                      (evDir === d ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')
                    }
                  >
                    {d === 'all' ? 'All' : d === 'bull' ? 'Bullish' : 'Bearish'}
                  </button>
                ))}
              </div>
              <div className="flex gap-0.5 rounded-lg bg-surface-3 p-0.5" role="group" aria-label="Minimum signal confidence">
                {([0, 0.5, 0.7] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setMinConf(c)}
                    aria-pressed={minConf === c}
                    title={c === 0 ? 'Show candidates at any confidence' : `Hide candidates below ${Math.round(c * 100)}% confidence`}
                    className={
                      'rounded-md px-2 py-0.5 text-[0.7rem] font-bold transition-colors ' +
                      (minConf === c ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')
                    }
                  >
                    {c === 0 ? 'Any %' : `≥${Math.round(c * 100)}%`}
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowPhases((x) => !x)}
            aria-pressed={showPhases}
            title="Shade Wyckoff phases A–E, inferred from the detected event sequence."
            className={
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.72rem] font-semibold transition-colors ' +
              (showPhases
                ? 'border-line bg-surface-3 text-ink'
                : 'border-line bg-surface text-muted hover:bg-surface-2')
            }
          >
            <span className="h-2 w-2 rounded-sm" style={{ background: showPhases ? '#64748b' : 'var(--border-strong)' }} />
            Phases
          </button>
          <button
            type="button"
            onClick={() => setShowTarget((x) => !x)}
            aria-pressed={showTarget}
            title="Wyckoff range-height objective (cause → effect). A method estimate, not a forecast."
            className={
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.72rem] font-semibold transition-colors ' +
              (showTarget
                ? 'border-pos-border bg-pos-soft text-pos'
                : 'border-line bg-surface text-muted hover:bg-surface-2')
            }
          >
            <span className="h-2 w-2 rounded-full" style={{ background: showTarget ? '#15803d' : 'var(--border-strong)' }} />
            Target
          </button>
        </div>
      )}

      {/* Wyckoff context read — renders in ALL Wyckoff cases (context is null when
          there's no valid range, which is the common trending-stock case). */}
      {mode === 'wyckoff' && (
        <div className="mt-2 text-[0.74rem]">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[0.72rem] font-bold uppercase tracking-wide"
              style={
                wyckoff.context?.kind === 'accumulation'
                  ? { background: 'var(--pos-soft)', color: 'var(--pos)' }
                  : wyckoff.context?.kind === 'distribution'
                    ? { background: 'var(--neg-soft)', color: 'var(--neg)' }
                    : { background: 'var(--warn-soft)', color: 'var(--warn)' }
              }
            >
              {wyckoff.context?.kind === 'accumulation'
                ? `Accumulation · ${Math.round(wyckoff.context.confidence * 100)}%`
                : wyckoff.context?.kind === 'distribution'
                  ? `Distribution · ${Math.round(wyckoff.context.confidence * 100)}%`
                  : 'No trading range'}
            </span>
            <span className="text-muted">{wyckoff.summary}</span>
          </div>
          {(!wyckoff.context || wyckoff.context.kind === 'undetermined') && (
            <p className="mt-1.5 rounded-md border border-warn bg-warn-soft px-2.5 py-1.5 leading-snug text-warn">
              <span className="font-semibold">Why the schematic is empty:</span> this stock is trending, not
              basing, so there's no sideways range to anchor Wyckoff events to. The labels (spring, phases,
              target) are deliberately suppressed — drawing them without a range is how false signals creep in.
              The candles and the climax-volume / wide-spread shading are still objective. Try a shorter window
              (3M/6M) to catch a consolidation, or use the Price view.
            </p>
          )}
        </div>
      )}

      {/* Capped-markers disclosure (MA values live in the readout strip below) */}
      {mode === 'price' && showMarkers && markers.capped.length > 0 && (
        <div className="mt-2 text-[0.7rem] text-subtle">
          Showing the most recent {MARKER_CAP} per type —{' '}
          {markers.capped.map((c) => MARKER_META[c].label).join(', ')} capped in this range.
        </div>
      )}

      {/* Live hover readout strip */}
      {mode === 'price' && data.length >= 2 && (
        <ChartReadout
          rows={data}
          hoverIdx={hoverIdx}
          stats={stats}
          showMA50={showMA50}
          showMA200={showMA200}
          overlayMeta={overlayOn ? overlayMeta : null}
          compare={activeCompare}
          eventsAt={eventsAt}
        />
      )}

      {/* Drag-measure result */}
      {mode === 'price' && measure && (
        <MeasureBar rows={data} measure={measure} onZoom={zoomToMeasure} onClear={() => setMeasure(null)} />
      )}

      {/* Charts */}
      {mode === 'wyckoff' ? (
        <div className="mt-4">
          {/* key: remount on window change so a pinned bar / measurement can't
              point at a stale index in a different bar set */}
          <WyckoffChart
            key={`${wyckoff.bars.length}-${wyckoff.bars[0]?.date ?? ''}`}
            analysis={wyckoff}
            isFetching={isFetching}
            showSignals={showSignals}
            showPhases={showPhases}
            showTarget={showTarget}
            evDir={evDir}
            minConf={minConf}
          />
        </div>
      ) : (
      <div
        className="mt-4 select-none transition-opacity"
        style={{ opacity: isFetching || compareFetching ? 0.55 : 1 }}
      >
        {data.length < 2 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-subtle">
            Not enough price data for this range.
          </div>
        ) : (
          <>
            {/* Price + MA + events */}
            <ResponsiveContainer width="100%" height={showVolume && hasVolume ? 260 : 300}>
              <ComposedChart
                data={data}
                margin={{ top: 4, right: overlayOn ? 52 : 4, bottom: 0, left: 0 }}
                syncId="px"
                onMouseDown={onChartMouseDown}
                onMouseMove={onChartMouseMove}
                onMouseUp={onChartMouseUp}
                onMouseLeave={onChartMouseLeave}
              >
                <defs>
                  <linearGradient id="px-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tickFormatter={tickLabel}
                  minTickGap={56}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: ct.axis }}
                />
                <YAxis
                  yAxisId="price"
                  domain={['auto', 'auto']}
                  scale={logOn ? 'log' : 'auto'}
                  allowDataOverflow={logOn}
                  tickFormatter={yTick}
                  width={56}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: ct.axis }}
                />
                {overlayOn && (
                  <YAxis
                    yAxisId="macro"
                    orientation="right"
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `${v.toFixed(overlayMeta?.dec ?? 0)}${overlayMeta?.unit ?? ''}`}
                    width={52}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: OVERLAY_COLOR }}
                  />
                )}
                <Tooltip
                  cursor={{ stroke: ct.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
                  content={
                    <PriceProTooltip
                      pctMode={pctOn}
                      overlayMeta={overlayOn ? overlayMeta : null}
                      showMA={showMA50 || showMA200}
                      compare={activeCompare}
                      eventsAt={eventsAt}
                    />
                  }
                />

                {/* Drag-select / measured region */}
                {(drag || measure) && (
                  <ReferenceArea
                    yAxisId="price"
                    x1={drag ? (drag.start <= drag.end ? drag.start : drag.end) : measure!.startDate}
                    x2={drag ? (drag.start <= drag.end ? drag.end : drag.start) : measure!.endDate}
                    fill={ct.accent}
                    fillOpacity={0.08}
                    stroke={ct.accent}
                    strokeOpacity={0.35}
                    strokeDasharray="3 3"
                  />
                )}

                {/* Filing/event markers — x snapped to the nearest price bar.
                    Filings sit on top, insider trades on the bottom axis. */}
                {visibleMarkers.map((m) => {
                  const meta = MARKER_META[m.cat]
                  const pinned = pinnedDay === m.snapDate
                  return (
                    <ReferenceLine
                      key={m.key}
                      yAxisId="price"
                      x={m.snapDate}
                      stroke={meta.color}
                      strokeWidth={pinned ? 2 : 1.25}
                      strokeOpacity={pinned ? 1 : 0.9}
                      strokeDasharray="3 2"
                      label={{
                        value: meta.glyph,
                        position: meta.pos === 'top' ? 'top' : 'insideBottom',
                        fontSize: 10,
                        fill: meta.color,
                      }}
                    />
                  )
                })}

                <Area
                  yAxisId="price"
                  type="monotone"
                  dataKey="v"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#px-fill)"
                  isAnimationActive={false}
                />
                {showMA50 && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="ma50"
                    stroke={MA50_COLOR}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {showMA200 && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="ma200"
                    stroke={MA200_COLOR}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {activeCompare.map((c) => (
                  <Line
                    key={c.ticker}
                    yAxisId="price"
                    type="monotone"
                    dataKey={`cmp_${c.ticker}`}
                    stroke={c.color}
                    strokeWidth={1.6}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
                {overlayOn && (
                  <Line
                    yAxisId="macro"
                    type="monotone"
                    dataKey="macro"
                    stroke={OVERLAY_COLOR}
                    strokeWidth={1.6}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>

            {/* Volume bars */}
            {showVolume && hasVolume && (
              <div className="mt-0.5">
                <ResponsiveContainer width="100%" height={64}>
                  <BarChart
                    data={data}
                    margin={{ top: 0, right: overlayOn ? 52 : 4, bottom: 0, left: 0 }}
                    syncId="px"
                    onMouseMove={onChartMouseMove}
                    onMouseLeave={onChartMouseLeave}
                  >
                    <XAxis dataKey="date" hide />
                    <YAxis hide domain={[0, 'auto']} />
                    <Tooltip content={<VolumeTooltip />} />
                    <Bar dataKey="vol" maxBarSize={8} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                      {data.map((row, i) => (
                        <Cell
                          key={i}
                          fill={row.upDay ? '#16a34a' : '#dc2626'}
                          fillOpacity={row.avgVol20 && row.vol != null && row.vol > 2 * row.avgVol20 ? 0.95 : 0.55}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="pr-1 text-right text-[0.65rem] text-subtle">
                  Volume · solid bars ≥2× the 20-day average
                  {(() => {
                    const r = hoverIdx != null ? data[hoverIdx] : null
                    return r?.vol != null
                      ? ` · ${fmtVol(r.vol)}${r.avgVol20 ? ` (${(r.vol / r.avgVol20).toFixed(1)}× avg)` : ''}`
                      : ''
                  })()}
                </div>
              </div>
            )}

            {/* Pinned day-events card */}
            {pinnedDay && pinnedItems.length > 0 && (
              <DayEventsCard date={pinnedDay} items={pinnedItems} onClose={() => setPinnedDay(null)} />
            )}
          </>
        )}
      </div>
      )}

      {mode === 'wyckoff' && <WyckoffReadPanel analysis={wyckoff} prices={prices} />}
    </div>
  )
}
