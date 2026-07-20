import { useVirtualizer } from '@tanstack/react-virtual'
import { Fuel, Settings2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MouseEvent } from 'react'

import { ScoreCell } from '@/components/screener/ScoreCell'
import { SectorPill } from '@/components/screener/SectorPill'
import { Icon } from '@/components/ui/Icon'
import { InfoTip } from '@/components/ui/InfoTip'
import { RiskBandChip } from '@/components/ui/RiskBandChip'
import { scoreHeat } from '@/lib/colors'
import {
  FACTOR_ORDER,
  FACTOR_TABLE,
  PREVIEW_N,
  VIRT_TABLE_HEAD_CELL,
  type FactorKey,
} from '@/lib/constants'
import { isValueTrap } from '@/lib/factorReading'
import {
  DEFAULT_SORT,
  type ScreenerSort,
  type ScreenerSortKey,
} from '@/lib/filters'
import { DASH, fmtMoney, fmtPrice } from '@/lib/format'
import { setScreenerOrder } from '@/lib/screenerOrder'
import type { CommodityBackdrop, QuoteRow, ScreenerRow } from '@/types/api'

const FACTOR_SORT: Record<FactorKey, ScreenerSortKey> = {
  composite: 'composite',
  growth: 'growth_pctl',
  value: 'value_pctl',
  quality: 'quality_pctl',
  momentum: 'momentum_pctl',
}

const FACTOR_HEAD: Record<FactorKey, string> = {
  composite: 'Comp',
  growth: 'Growth',
  value: 'Value',
  quality: 'Quality',
  momentum: 'Mom',
}

const FACTOR_TIP: Record<FactorKey, string> = {
  composite:
    'Overall standing — a weighted blend of the four factor percentiles. Higher = better-ranked across the whole universe.',
  growth: 'Revenue & EPS growth, percentile-ranked vs the universe.',
  value: 'Valuation — cheaper on P/E, P/S, EV/EBITDA and FCF yield ranks higher.',
  quality:
    'Profitability & balance-sheet strength — ROIC, margins, low leverage, clean accruals, low share issuance.',
  momentum: 'Price trend — 3/6/12-month returns (12-minus-1).',
}

// Terminal density: 36px rows (was 44). Single source of truth — feeds both the
// virtualizer's estimateSize and each row's rendered height (vi.size), so they
// can't desync. Companion cell padding/sparkline are tightened to fit. The row
// clips horizontal bleed only (overflow-x-clip) — vertical overflow stays visible
// so the composite Sparkline's hover value bubble (not portaled) isn't clipped.
const ROW_H = 36

/** Columns the user can hide via the ⚙ menu (#14). Rank/Company/Composite/Price
 *  are always shown. */
const OPTIONAL_COLS: { key: string; label: string }[] = [
  { key: 'sector', label: 'Sector' },
  { key: 'growth', label: 'Growth' },
  { key: 'value', label: 'Value' },
  { key: 'quality', label: 'Quality' },
  { key: 'momentum', label: 'Momentum' },
  { key: 'garp', label: 'GARP (cheap & rising)' },
  { key: 'market_cap', label: 'Market cap' },
  { key: 'risk', label: 'Risk band' },
]

const TH = VIRT_TABLE_HEAD_CELL

// GARP ("worst-of Value & Momentum") is display/discovery only and is computed
// live-aware inside the component (see liveGarp) so it tracks the live-adjusted
// Value/Momentum shown in those columns; the 'garp' sort is handled there too.

function compareRows(
  a: ScreenerRow,
  b: ScreenerRow,
  key: ScreenerSortKey,
  dir: 1 | -1,
): number {
  if (key === 'garp') return 0 // handled live-aware in the sort memo; never reached here
  // Risk sorts by the DISPLAYED band first (so the digit column reads
  // monotone), with the finer risk_score only breaking ties within a band —
  // never reordering across bands the user can't see the reason for.
  if (key === 'risk_score') {
    const ab = a.risk_band
    const bb = b.risk_band
    if (ab === null && bb === null) return 0
    if (ab === null) return 1 // no-band rows always sink
    if (bb === null) return -1
    if (ab !== bb) return (ab - bb) * dir
  }
  const av = a[key]
  const bv = b[key]
  // nulls always sink to the bottom, regardless of direction
  if (av === null && bv === null) return 0
  if (av === null) return 1
  if (bv === null) return -1
  if (typeof av === 'string' && typeof bv === 'string') {
    return av.localeCompare(bv) * dir
  }
  return ((av as number) - (bv as number)) * dir
}

function PriceCell({ row }: { row: ScreenerRow }) {
  const { last_price: last, prev_close: prev } = row
  let delta: React.ReactNode = null
  if (last !== null && prev !== null && prev !== 0) {
    const chg = (last - prev) / prev
    delta =
      chg >= 0 ? (
        <span className="numeric text-[0.62rem] font-semibold text-pos">
          ▲ {(chg * 100).toFixed(2)}%
        </span>
      ) : (
        <span className="numeric text-[0.62rem] font-semibold text-neg">
          ▼ {(Math.abs(chg) * 100).toFixed(2)}%
        </span>
      )
  }
  return (
    <div className="flex h-full flex-col items-end justify-center px-3 py-1 leading-tight">
      <span className="numeric text-[0.8rem] font-semibold text-ink">
        {fmtPrice(last)}
      </span>
      {delta}
    </div>
  )
}

/** Value-trap caveat marker (Phase 1, 1e): cheap on Value but weak on Quality
 *  AND Momentum — surfaced inline so triage doesn't reward "cheap for a reason".
 *  Descriptive, suppressed when Quality/Momentum are absent. */
function ValueTrapMark({ row }: { row: ScreenerRow }) {
  const trap = isValueTrap({
    composite: row.composite,
    growth: row.growth_pctl,
    value: row.value_pctl,
    quality: row.quality_pctl,
    momentum: row.momentum_pctl,
  })
  if (!trap) return null
  return (
    <span
      className="flex-none cursor-help text-[0.62rem] leading-none text-warn"
      title={
        `Cheap (Value ${row.value_pctl?.toFixed(0)}) but weak on Quality ` +
        `(${row.quality_pctl?.toFixed(0)}) and Momentum (${row.momentum_pctl?.toFixed(0)}) — ` +
        `often cheap for a reason. A caveat to investigate, not a sell signal.`
      }
      aria-label="Value-trap caveat"
    >
      <Icon icon={TriangleAlert} size={12} />
    </span>
  )
}

/** Neutral ⛽ marker on upstream oil & gas producers: their trailing valuation
 *  depends on the forward commodity curve the score can't see. Direction is
 *  NOT encoded per-name (a producer's oil/gas weighting isn't knowable from its
 *  industry) — the tooltip carries both real forecast directions, and the user
 *  opens the Value pane for detail. Hidden when both commodities are flat. */
const COMMODITY_VERB: Record<string, string> = {
  declining: 'forecast to fall',
  rising: 'forecast to rise',
  flat: 'forecast flat',
  unknown: 'forecast',
}
const COMMODITY_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** 'YYYY-MM-DD' -> 'Mon YYYY' (matches the deep-dive card's provenance line). */
function fmtVintage(iso: string): string {
  const [y, m] = iso.split('-')
  return `${COMMODITY_MONTHS[Number(m) - 1] ?? m} ${y}`
}

function CommodityMark({
  row,
  backdrops,
}: {
  row: ScreenerRow
  backdrops: CommodityBackdrop[] | null | undefined
}) {
  if (!row.commodity_producer || !backdrops || backdrops.length === 0) return null
  const material = backdrops.filter(
    (b) => b.direction === 'declining' || b.direction === 'rising',
  )
  if (material.length === 0) return null
  // "forecast to fall" verb (not a bare "declining") keeps the forward framing
  // unambiguous next to every direction, matching the deep-dive card.
  const summary = backdrops
    .map(
      (b) =>
        `${b.label} ${b.slope_pct != null ? (b.slope_pct > 0 ? '+' : '') + b.slope_pct + '%' : ''} (${COMMODITY_VERB[b.direction] ?? 'forecast'})`,
    )
    .join(', ')
  return (
    <span
      className="flex-none cursor-help text-[0.62rem] leading-none text-subtle"
      title={
        `Oil & gas producer — trailing valuation depends on the forward commodity ` +
        `curve. EIA STEO (retrieved ${fmtVintage(backdrops[0].vintage)}): ${summary}. ` +
        `Open the Value pane for detail.`
      }
      aria-label="Forward commodity backdrop caveat"
    >
      <Icon icon={Fuel} size={12} />
    </span>
  )
}

/** 7-day composite move → left-edge signal color (null = no meaningful move). */
function signalColor(d: number | null): string | null {
  if (d == null) return null
  if (d >= 3) return '#22c55e'
  if (d >= 1) return '#86efac'
  if (d <= -3) return '#ef4444'
  if (d <= -1) return '#fca5a5'
  return null
}

/** Inline "what changed" badge — only for names that moved ≥3 pts in ~a week. */
function WhatChanged({ d }: { d: number | null }) {
  if (d == null || Math.abs(d) < 3) return null
  const up = d > 0
  return (
    <span
      className={
        'numeric inline-flex flex-none items-center rounded px-1 py-px text-[0.56rem] font-bold leading-none ' +
        (up ? 'bg-pos-soft text-pos' : 'bg-neg-soft text-neg')
      }
      title={`Composite ${up ? '+' : ''}${d.toFixed(1)} over ~7 days`}
    >
      {up ? '▲' : '▼'}
      {Math.abs(d).toFixed(1)}
    </span>
  )
}

export function ScreenerTable({
  rows,
  scoreDate,
  rowAccessory,
  onRowClick,
  liveByTicker,
  liveRankByTicker,
  commodityBackdrops,
  sort: controlledSort,
  onSortChange,
  emptyHint,
}: {
  rows: ScreenerRow[]
  scoreDate: string | null
  /** Optional trailing per-row control (e.g. add-to-watchlist star). */
  rowAccessory?: (ticker: string) => React.ReactNode
  /** When provided, clicking the row body calls this instead of navigating. Ticker link still navigates. */
  onRowClick?: (row: ScreenerRow) => void
  /** Live-adjusted scores by ticker (display overlay; rank/sort stay nightly). */
  liveByTicker?: Record<string, QuoteRow>
  /**
   * Live-adjusted # by ticker, computed by the page over the FULL universe
   * (before any search/sector/filter narrows `rows`) — so a stock's rank
   * badge reflects true universe standing and doesn't renumber 1..N just
   * because a filter shrank the visible set. Falls back to the nightly
   * `r.rank` for tickers outside this map (e.g. complete-only mismatch).
   */
  liveRankByTicker?: Record<string, number> | null
  /** Oil + gas forward paths (EIA STEO), shared by every producer row's ⛽
   *  marker. Same object for all rows; the marker only shows on producers. */
  commodityBackdrops?: CommodityBackdrop[] | null
  /** Controlled sort (for URL state). Falls back to internal state when omitted. */
  sort?: ScreenerSort
  onSortChange?: (s: ScreenerSort) => void
  /** Hint shown under the empty state naming the binding filter. */
  emptyHint?: string
}) {
  const [internalSort, setInternalSort] = useState<ScreenerSort>(DEFAULT_SORT)
  const sort = controlledSort ?? internalSort
  const applySort = (s: ScreenerSort) =>
    onSortChange ? onSortChange(s) : setInternalSort(s)
  const [expanded, setExpanded] = useState(false)

  // #14 column customization — hide/show the optional data columns (persisted).
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('stockbud.hiddenCols') ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const [colMenu, setColMenu] = useState(false)
  const show = (k: string) => !hidden.has(k)
  const toggleCol = (k: string) =>
    setHidden((h) => {
      const n = new Set(h)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      localStorage.setItem('stockbud.hiddenCols', JSON.stringify([...n]))
      return n
    })

  // #15 comparison mode — pick up to 4, compare side by side.
  const [compareMode, setCompareMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showCompare, setShowCompare] = useState(false)
  const toggleSelect = (t: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(t)) n.delete(t)
      else if (n.size < 4) n.add(t)
      return n
    })

  // Live-adjusted composite (price-driven value/momentum move intraday); falls
  // back to the nightly composite when no live quote exists. When the user sorts
  // by COMP we rank on THIS, so the blue live numbers actually run in order —
  // the board re-ranks live while the market breathes. Sorting any other column
  // keeps the nightly basis. Cheap: a client-side sort of already-computed
  // numbers, not a server re-score.
  const hasLive = liveByTicker
    ? Object.values(liveByTicker).some((q) => q.composite_live != null)
    : false
  const liveComposite = (r: ScreenerRow): number | null =>
    liveByTicker?.[r.ticker]?.composite_live ?? r.composite
  // GARP mirrors the DISPLAYED Value/Momentum cells: prefer each factor's
  // live-adjusted percentile (falling back to nightly) so "worst-of" stays
  // consistent with the live numbers shown in those columns — otherwise GARP
  // reads the nightly basis and can sit above a factor's live value.
  const garpParts = (r: ScreenerRow): [number | null, number | null] => {
    const q = liveByTicker?.[r.ticker]
    return [q?.value_live ?? r.value_pctl, q?.momentum_live ?? r.momentum_pctl]
  }
  const liveGarp = (r: ScreenerRow): number | null => {
    const [v, m] = garpParts(r)
    return v != null && m != null ? Math.min(v, m) : null
  }
  const garpIsLive = (r: ScreenerRow): boolean => {
    const q = liveByTicker?.[r.ticker]
    return q?.value_live != null || q?.momentum_live != null
  }
  const liveRanked = sort.key === 'composite' && hasLive
  // The # is always a stock's composite rank. Sorting by a factor column
  // (GARP/Growth/…) reorders the rows but leaves each # unchanged — so when the
  // rows aren't in composite order, dim the # and spell it out in the tooltip,
  // to make clear the sort didn't renumber the composite ranking.
  const rankInOrder = sort.key === 'composite' || sort.key === 'rank'
  // Movers sorts by the weekly rank change; that needs a prior score under the
  // current model. Right after a model update the history is empty, so no row
  // has a rank_delta — disable the toggle (with an explanation) rather than let
  // it silently no-op.
  const hasRankMoves = useMemo(() => rows.some((r) => r.rank_delta != null), [rows])

  const sorted = useMemo(() => {
    if (sort.key === 'composite') {
      return [...rows].sort((a, b) => {
        const av = liveComposite(a)
        const bv = liveComposite(b)
        if (av === null && bv === null) return 0
        if (av === null) return 1
        if (bv === null) return -1
        return (av - bv) * sort.dir
      })
    }
    if (sort.key === 'garp') {
      return [...rows].sort((a, b) => {
        const av = liveGarp(a)
        const bv = liveGarp(b)
        if (av === null && bv === null) return 0
        if (av === null) return 1
        if (bv === null) return -1
        return (av - bv) * sort.dir
      })
    }
    return [...rows].sort((a, b) => compareRows(a, b, sort.key, sort.dir))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, liveByTicker])
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_N)

  // Persist the visible result order so the deep dive can offer a J/K
  // prev/next pager ("Screener result 12 of 240"). Pure side effect.
  useEffect(() => {
    setScreenerOrder(sorted.map((r) => r.ticker.toUpperCase()))
  }, [sorted])

  // Export the FULL filtered + sorted set (not just the visible page).
  const exportCsv = () => {
    const head = [
      'rank', 'ticker', 'name', 'sector', 'composite', 'growth', 'value',
      'quality', 'momentum', 'garp', 'market_cap', 'risk_band', 'price', 'rank_delta',
    ]
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [head.join(',')]
    for (const r of sorted) {
      lines.push(
        [
          r.rank, r.ticker, r.name, r.sector, r.composite, r.growth_pctl,
          r.value_pctl, r.quality_pctl, r.momentum_pctl, liveGarp(r),
          r.market_cap, r.risk_band, r.last_price, r.rank_delta,
        ]
          .map(esc)
          .join(','),
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stockbud-screener-${scoreDate ?? 'export'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })

  const toggleSort = (key: ScreenerSortKey) =>
    applySort(
      sort.key === key
        ? { key, dir: (sort.dir === 1 ? -1 : 1) as 1 | -1 }
        : { key, dir: (key === 'ticker' || key === 'sector' ? 1 : -1) as 1 | -1 },
    )

  const arrow = (key: ScreenerSortKey) =>
    sort.key === key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''

  // dynamic grid: optional columns can be hidden (#14), a checkbox column
  // prepends in compare mode (#15), the accessory column appends when provided.
  const SUB = ['growth', 'value', 'quality', 'momentum'] as const
  const tracks: string[] = []
  if (compareMode) tracks.push('34px')
  tracks.push('38px', 'minmax(150px,1.6fr)')
  if (show('sector')) tracks.push('minmax(130px,1.3fr)')
  tracks.push('minmax(78px,1fr)') // composite — always shown
  for (const f of SUB) if (show(f)) tracks.push('minmax(78px,1fr)')
  if (show('garp')) tracks.push('minmax(70px,0.7fr)')
  if (show('market_cap')) tracks.push('minmax(82px,0.8fr)')
  if (show('risk')) tracks.push('minmax(64px,0.6fr)')
  tracks.push('minmax(90px,0.9fr)') // price — always shown
  if (rowAccessory) tracks.push('44px')
  const gridCols = tracks.join(' ')
  let mw = (compareMode ? 34 : 0) + 38 + 150 + 78 + 90 + (rowAccessory ? 44 : 0)
  if (show('sector')) mw += 130
  for (const f of SUB) if (show(f)) mw += 78
  if (show('garp')) mw += 70
  if (show('market_cap')) mw += 82
  if (show('risk')) mw += 64

  const compareRowsData = rows.filter((r) => selected.has(r.ticker))

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {/* card header */}
      <div className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-3.5">
        <div>
          <div className="text-base font-bold text-ink">US-listed companies</div>
          <div className="mt-0.5 text-[0.78rem] text-muted">
            {rows.length} companies · ranked by composite factor score · scores as of{' '}
            {scoreDate ?? 'n/a'} (nightly)
          </div>
        </div>
        {rows.length > 0 && (
          <div className="flex flex-none items-center gap-2">
            {/* #14 column customization */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setColMenu((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[0.74rem] font-semibold text-muted transition hover:border-line hover:bg-surface-2"
              >
                <Icon icon={Settings2} size={14} /> Columns
              </button>
              {colMenu && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setColMenu(false)} />
                  <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-line bg-surface p-1.5 shadow-lg">
                    {OPTIONAL_COLS.map((c) => (
                      <label
                        key={c.key}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[0.8rem] hover:bg-surface-2"
                      >
                        <input
                          type="checkbox"
                          checked={show(c.key)}
                          onChange={() => toggleCol(c.key)}
                          className="h-3.5 w-3.5 accent-accent"
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* #15 comparison mode */}
            <button
              type="button"
              onClick={() => {
                setCompareMode((m) => !m)
                setSelected(new Set())
              }}
              className={
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[0.74rem] font-semibold transition ' +
                (compareMode
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-muted hover:border-line hover:bg-surface-2')
              }
            >
              ⊟ Compare
            </button>
            <button
              type="button"
              onClick={exportCsv}
              title="Download the current filtered + sorted list as CSV"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[0.74rem] font-semibold text-muted transition hover:border-line hover:bg-surface-2 hover:text-ink"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Export CSV
            </button>
          </div>
        )}
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-line bg-surface-2 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3.5">
          {FACTOR_ORDER.map((k) => (
            <span key={k} className="flex items-center text-[0.73rem] text-muted">
              <span
                className="mr-[5px] inline-block h-[9px] w-[9px] rounded-full"
                style={{ background: FACTOR_TABLE[k].bar }}
              />
              {k.charAt(0).toUpperCase() + k.slice(1)}
              <InfoTip text={FACTOR_TIP[k]} />
            </span>
          ))}
          <button
            type="button"
            disabled={!hasRankMoves}
            onClick={() =>
              applySort(
                sort.key === 'rank_delta'
                  ? DEFAULT_SORT
                  : { key: 'rank_delta', dir: -1 },
              )
            }
            title={
              hasRankMoves
                ? 'Sort by biggest rank gains vs ~last week'
                : 'Rank moves are still building — the scoring model was updated recently and needs at least one prior day to compare against. Check back after the next nightly run.'
            }
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[0.7rem] font-bold transition ${
              !hasRankMoves
                ? 'cursor-not-allowed bg-surface text-subtle ring-1 ring-inset ring-line opacity-60'
                : sort.key === 'rank_delta'
                  ? 'bg-pos-soft text-pos'
                  : 'bg-surface text-muted ring-1 ring-inset ring-line hover:text-ink'
            }`}
          >
            ▲ Movers{!hasRankMoves && <span className="font-medium"> · building</span>}
          </button>
        </div>
        <span className="whitespace-nowrap text-[0.7rem] italic text-subtle">
          {hasLive && (
            <span className="not-italic text-info">
              <span className="align-super text-[0.7em] text-info">●</span>{' '}
              {liveRanked ? 'ranked on live-adjusted composite' : 'live-adjusted'} ·{' '}
            </span>
          )}
          Bars are percentile ranks (0–100, line = median) · click row = preview · click ticker = deep dive
        </span>
      </div>

      {/* virtualized grid — flex-fills the card so the table matches the sidebar
          height (kills the void beside/below it). Mobile keeps a viewport cap
          since there's no stretched row to fill against there. */}
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto max-h-[calc(100dvh-13rem)] lg:max-h-none"
      >
        <div
          className="sticky top-0 z-10 grid border-b border-line bg-surface-2"
          style={{ gridTemplateColumns: gridCols, minWidth: mw }}
        >
          {compareMode && <div className={TH} aria-hidden="true" />}
          <button
            type="button"
            onClick={() => toggleSort('rank')}
            title="Composite rank in the full universe. Sorting by another column reorders the rows but never changes this rank."
            className={`${TH} justify-end pr-2 ${rankInOrder ? 'text-muted' : 'text-subtle'}`}
          >
            #{arrow('rank')}
          </button>
          <button type="button" onClick={() => toggleSort('ticker')} className={`${TH} text-muted`}>
            Company{arrow('ticker')}
          </button>
          {show('sector') && (
            <button type="button" onClick={() => toggleSort('sector')} className={`${TH} text-muted`}>
              Sector{arrow('sector')}
            </button>
          )}
          {FACTOR_ORDER.filter((k) => k === 'composite' || show(k)).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleSort(FACTOR_SORT[k])}
              className={`${TH} justify-center`}
              style={{ color: FACTOR_TABLE[k].header }}
            >
              {FACTOR_HEAD[k]}
              {arrow(FACTOR_SORT[k])}
            </button>
          ))}
          {show('garp') && (
            <button type="button" onClick={() => toggleSort('garp')} className={`${TH} justify-center text-pos`}>
              GARP{arrow('garp')}
              <InfoTip text="Cheap & Rising: the worst-of your Value and Momentum percentiles, so a high GARP means a stock is strong on BOTH — reasonably priced AND trending. It uses the same live-adjusted Value & Momentum shown in those columns (a * means a live price was applied), so it always stays consistent with them. A discovery lens over existing scores; it does not change any factor score or the composite rank." />
            </button>
          )}
          {show('market_cap') && (
            <button type="button" onClick={() => toggleSort('market_cap')} className={`${TH} justify-end text-muted`}>
              Mkt cap{arrow('market_cap')}
            </button>
          )}
          {show('risk') && (
            <button type="button" onClick={() => toggleSort('risk_score')} className={`${TH} justify-center text-muted`}>
              Risk{arrow('risk_score')}
              <InfoTip text="Historical risk band 1-5 from realized volatility, beta and drawdown over the past year — a backward-looking measurement, not a prediction. Sorts by band, finer risk detail breaking ties." />
            </button>
          )}
          <button type="button" onClick={() => toggleSort('last_price')} className={`${TH} justify-end text-muted`}>
            Price{arrow('last_price')}
          </button>
          {rowAccessory && <div className={TH} aria-hidden="true" />}
        </div>

        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">
            No companies match the current filters.
            {emptyHint && (
              <div className="mx-auto mt-1.5 max-w-md text-[0.8rem] text-subtle">
                {emptyHint}
              </div>
            )}
          </div>
        ) : (
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize(), minWidth: mw }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const r = visible[vi.index]
              const sig = signalColor(r.composite_delta_7d)
              const handleRowClick = onRowClick
                ? (e: MouseEvent) => {
                    // don't intercept clicks on the ticker Link or accessory
                    const target = e.target as HTMLElement
                    if (target.closest('a') || target.closest('button')) return
                    onRowClick(r)
                  }
                : undefined
              return (
                <div
                  key={r.security_id}
                  className="absolute left-0 grid w-full overflow-x-clip border-b border-divider transition-[box-shadow,background] duration-100 hover:bg-surface-2 hover:shadow-[inset_3px_0_0_var(--accent)]"
                  style={{
                    gridTemplateColumns: gridCols,
                    height: vi.size,
                    transform: `translateY(${vi.start}px)`,
                    cursor: onRowClick ? 'pointer' : 'default',
                  }}
                  onClick={handleRowClick}
                >
                  {sig && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-0 z-10 h-full w-1"
                      style={{ background: sig }}
                      title={`Composite ${r.composite_delta_7d! > 0 ? '+' : ''}${r.composite_delta_7d!.toFixed(1)} over ~7 days`}
                    />
                  )}
                  {compareMode && (
                    <div
                      className="flex h-full items-center justify-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(r.ticker)}
                        onChange={() => toggleSelect(r.ticker)}
                        disabled={!selected.has(r.ticker) && selected.size >= 4}
                        className="h-3.5 w-3.5 accent-accent"
                        aria-label={`Select ${r.ticker} to compare`}
                      />
                    </div>
                  )}
                  <div className="flex h-full flex-col items-end justify-center pr-2 leading-tight">
                    <span
                      className={`numeric text-[0.74rem] font-semibold ${rankInOrder ? 'text-muted' : 'text-subtle'}`}
                      title={
                        liveRanked
                          ? 'Live-adjusted universe rank · nightly #' + r.rank
                          : rankInOrder
                            ? undefined
                            : 'Composite rank #' +
                              r.rank +
                              ' — the current sort reorders the rows but never changes this rank'
                      }
                    >
                      {liveRanked ? (liveRankByTicker?.[r.ticker] ?? r.rank) : r.rank}
                    </span>
                    {r.rank_delta != null && r.rank_delta !== 0 && (
                      <span
                        className={`text-[0.58rem] font-bold tabular-nums ${
                          r.rank_delta > 0 ? 'text-pos' : 'text-neg'
                        }`}
                        title={`Rank ${r.rank_delta > 0 ? 'up' : 'down'} ${Math.abs(
                          r.rank_delta,
                        )} vs ~last week (was #${r.rank_prev})`}
                      >
                        {r.rank_delta > 0 ? '▲' : '▼'}
                        {Math.abs(r.rank_delta)}
                      </span>
                    )}
                  </div>
                  <div className="flex h-full min-w-0 flex-col justify-center px-3 py-1">
                    {onRowClick ? (
                      <>
                        <span className="flex items-center gap-1">
                          <Link
                            to={`/securities/${r.ticker}`}
                            className="numeric text-[0.82rem] font-bold leading-[1.1] text-ink hover:text-accent hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.ticker}
                          </Link>
                          <ValueTrapMark row={r} />
                          <CommodityMark row={r} backdrops={commodityBackdrops} />
                          <WhatChanged d={r.composite_delta_7d} />
                        </span>
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.68rem] leading-tight text-subtle">
                          {r.name ?? DASH}
                        </span>
                      </>
                    ) : (
                      <Link
                        to={`/securities/${r.ticker}`}
                        className="contents text-inherit no-underline"
                      >
                        <span className="flex items-center gap-1">
                          <span className="numeric text-[0.82rem] font-bold leading-[1.1] text-ink">
                            {r.ticker}
                          </span>
                          <ValueTrapMark row={r} />
                          <CommodityMark row={r} backdrops={commodityBackdrops} />
                          <WhatChanged d={r.composite_delta_7d} />
                        </span>
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.68rem] leading-tight text-subtle">
                          {r.name ?? DASH}
                        </span>
                      </Link>
                    )}
                  </div>
                  {show('sector') && (
                    <div className="flex h-full min-w-0 items-center px-3 py-1">
                      <SectorPill sector={r.sector} />
                    </div>
                  )}
                  <ScoreCell
                    dense
                    factor="composite"
                    value={r.composite}
                    live={liveByTicker?.[r.ticker]?.composite_live}
                    delta={r.composite_delta}
                    sparkline={r.composite_history}
                  />
                  {show('growth') && (
                    <ScoreCell dense factor="growth" value={r.growth_pctl} subPctls={r.sub_pctls} />
                  )}
                  {show('value') && (
                    <ScoreCell
                      dense
                      factor="value"
                      value={r.value_pctl}
                      live={liveByTicker?.[r.ticker]?.value_live}
                      subPctls={r.sub_pctls}
                    />
                  )}
                  {show('quality') && (
                    <ScoreCell dense factor="quality" value={r.quality_pctl} subPctls={r.sub_pctls} />
                  )}
                  {show('momentum') && (
                    <ScoreCell
                      dense
                      factor="momentum"
                      value={r.momentum_pctl}
                      live={liveByTicker?.[r.ticker]?.momentum_live}
                      subPctls={r.sub_pctls}
                    />
                  )}
                  {show('garp') && (
                    <div className="flex h-full items-center justify-center px-2">
                      {liveGarp(r) != null ? (
                        <span
                          className="numeric rounded px-1.5 py-0.5 text-[0.72rem] font-bold"
                          style={{ background: scoreHeat(liveGarp(r) as number).tint, color: 'var(--ink)' }}
                          title={`Value ${garpParts(r)[0]?.toFixed(0)} · Momentum ${garpParts(r)[1]?.toFixed(0)} → worst-of ${(liveGarp(r) as number).toFixed(0)}${garpIsLive(r) ? ' · live-adjusted' : ''}`}
                        >
                          {(liveGarp(r) as number).toFixed(0)}
                          {garpIsLive(r) && (
                            <span className="align-super text-[0.6rem] font-semibold text-accent">*</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[0.72rem] text-subtle">—</span>
                      )}
                    </div>
                  )}
                  {show('market_cap') && (
                    <div className="numeric flex h-full items-center justify-end px-3 text-[0.8rem] font-semibold text-muted">
                      {fmtMoney(r.market_cap)}
                    </div>
                  )}
                  {show('risk') && (
                    <div className="flex h-full items-center justify-center px-2">
                      <RiskBandChip band={r.risk_band} compact />
                    </div>
                  )}
                  <PriceCell row={r} />
                  {rowAccessory && (
                    <div className="flex h-full items-center justify-center">
                      {rowAccessory(r.ticker)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* count indicator + expand toggle */}
      {visible.length > 0 && (
        <div className="flex items-center justify-between border-t border-line bg-surface-2 px-4 py-2.5">
          <span className="text-[0.72rem] text-muted">
            Showing{' '}
            <span className="numeric font-semibold text-ink">1–{visible.length}</span> of{' '}
            <span className="numeric font-semibold text-ink">{rows.length}</span>
          </span>
          {rows.length > PREVIEW_N && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-[0.76rem] font-bold text-accent hover:underline"
            >
              {expanded ? `Show top ${PREVIEW_N}` : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}

      {/* #15 compare floating bar */}
      {compareMode && selected.size > 0 && (
        <div className="sticky bottom-0 z-20 flex items-center justify-between border-t border-line bg-surface px-4 py-2 backdrop-blur">
          <span className="text-[0.78rem] text-muted">
            <span className="numeric font-bold text-accent">{selected.size}</span> selected
            {selected.size >= 4 ? ' (max 4)' : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg px-3 py-1.5 text-[0.74rem] font-semibold text-muted hover:text-ink"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setShowCompare(true)}
              disabled={selected.size < 2}
              className="rounded-lg bg-accent-solid px-3 py-1.5 text-[0.74rem] font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-40"
            >
              Compare ({selected.size})
            </button>
          </div>
        </div>
      )}

      {/* #15 comparison modal */}
      {showCompare && compareRowsData.length >= 2 && (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-900/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCompare(false)
          }}
        >
          <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <span className="text-base font-bold text-ink">
                Compare {compareRowsData.length} stocks
              </span>
              <button
                type="button"
                onClick={() => setShowCompare(false)}
                className="text-subtle hover:text-ink"
                aria-label="Close"
              >
                <Icon icon={X} size={16} />
              </button>
            </div>
            <div className="overflow-x-auto p-5">
              <table className="w-full text-[0.82rem]">
                <thead>
                  <tr>
                    <th className="px-2 py-1.5 text-left text-[0.64rem] font-bold uppercase tracking-[0.05em] text-subtle">
                      Metric
                    </th>
                    {compareRowsData.map((r) => (
                      <th key={r.ticker} className="px-2 py-1.5 text-center">
                        <Link
                          to={`/securities/${r.ticker}`}
                          className="font-bold text-ink hover:text-accent"
                        >
                          {r.ticker}
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['composite', 'Composite'],
                      ['growth_pctl', 'Growth'],
                      ['value_pctl', 'Value'],
                      ['quality_pctl', 'Quality'],
                      ['momentum_pctl', 'Momentum'],
                    ] as const
                  ).map(([key, label]) => (
                    <tr key={key} className="border-t border-line">
                      <td className="px-2 py-2 font-semibold text-muted">{label}</td>
                      {compareRowsData.map((r) => {
                        const v = r[key] as number | null
                        return (
                          <td key={r.ticker} className="px-2 py-2 text-center">
                            <span
                              className="numeric inline-block min-w-[42px] rounded px-2 py-0.5 font-bold"
                              style={{ background: scoreHeat(v).tint }}
                            >
                              {v == null ? DASH : v.toFixed(1)}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  <tr className="border-t border-line">
                    <td className="px-2 py-2 font-semibold text-muted">Price</td>
                    {compareRowsData.map((r) => (
                      <td key={r.ticker} className="numeric px-2 py-2 text-center font-semibold text-ink">
                        {fmtPrice(r.last_price)}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-2 py-2 font-semibold text-muted">Mkt cap</td>
                    {compareRowsData.map((r) => (
                      <td key={r.ticker} className="numeric px-2 py-2 text-center font-semibold text-ink">
                        {fmtMoney(r.market_cap)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
