import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MouseEvent } from 'react'

import { ScoreCell } from '@/components/screener/ScoreCell'
import { SectorPill } from '@/components/screener/SectorPill'
import { InfoTip } from '@/components/ui/InfoTip'
import {
  FACTOR_ORDER,
  FACTOR_TABLE,
  PREVIEW_N,
  SCREENER_GRID,
  type FactorKey,
} from '@/lib/constants'
import { isValueTrap } from '@/lib/factorReading'
import {
  DEFAULT_SORT,
  type ScreenerSort,
  type ScreenerSortKey,
} from '@/lib/filters'
import { DASH, fmtMoney, fmtPrice } from '@/lib/format'
import type { QuoteRow, ScreenerRow } from '@/types/api'

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

const ROW_H = 44

const TH =
  'flex items-center px-3 py-[9px] text-[0.68rem] font-bold uppercase tracking-[0.06em] whitespace-nowrap select-none'

function compareRows(
  a: ScreenerRow,
  b: ScreenerRow,
  key: ScreenerSortKey,
  dir: 1 | -1,
): number {
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
        <span className="text-[0.7rem] font-semibold text-green-600">
          ▲ {(chg * 100).toFixed(2)}%
        </span>
      ) : (
        <span className="text-[0.7rem] font-semibold text-red-600">
          ▼ {(Math.abs(chg) * 100).toFixed(2)}%
        </span>
      )
  }
  return (
    <div className="flex h-full flex-col items-end justify-center px-3 py-2">
      <span className="numeric text-[0.85rem] font-semibold text-gray-900">
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
      className="flex-none cursor-help text-[0.62rem] leading-none text-amber-500"
      title={
        `Cheap (Value ${row.value_pctl?.toFixed(0)}) but weak on Quality ` +
        `(${row.quality_pctl?.toFixed(0)}) and Momentum (${row.momentum_pctl?.toFixed(0)}) — ` +
        `often cheap for a reason. A caveat to investigate, not a sell signal.`
      }
      aria-label="Value-trap caveat"
    >
      ⚠
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
        (up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')
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
  const liveRanked = sort.key === 'composite' && hasLive

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
    return [...rows].sort((a, b) => compareRows(a, b, sort.key, sort.dir))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, liveByTicker])
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_N)

  // Export the FULL filtered + sorted set (not just the visible page).
  const exportCsv = () => {
    const head = [
      'rank', 'ticker', 'name', 'sector', 'composite', 'growth', 'value',
      'quality', 'momentum', 'market_cap', 'price', 'rank_delta',
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
          r.value_pctl, r.quality_pctl, r.momentum_pctl, r.market_cap,
          r.last_price, r.rank_delta,
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

  // append a 44px control column when an accessory is provided
  const gridCols = rowAccessory ? `${SCREENER_GRID} 44px` : SCREENER_GRID
  const minW = rowAccessory ? 'min-w-[946px]' : 'min-w-[902px]'

  return (
    <section className="min-w-0 flex-1 overflow-hidden rounded-card border border-gray-200 bg-white shadow-card">
      {/* card header */}
      <div className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-3.5">
        <div>
          <div className="text-base font-bold text-gray-900">US-listed companies</div>
          <div className="mt-0.5 text-[0.78rem] text-gray-500">
            {rows.length} companies · ranked by composite factor score · scores as of{' '}
            {scoreDate ?? 'n/a'} (nightly)
          </div>
        </div>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={exportCsv}
            title="Download the current filtered + sorted list as CSV"
            className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[0.74rem] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export CSV
          </button>
        )}
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-gray-100 bg-gray-50 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3.5">
          {FACTOR_ORDER.map((k) => (
            <span key={k} className="flex items-center text-[0.73rem] text-gray-600">
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
            onClick={() =>
              applySort(
                sort.key === 'rank_delta'
                  ? DEFAULT_SORT
                  : { key: 'rank_delta', dir: -1 },
              )
            }
            title="Sort by biggest rank gains vs ~last week"
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[0.7rem] font-bold transition ${
              sort.key === 'rank_delta'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-white text-slate-500 ring-1 ring-inset ring-gray-200 hover:text-slate-700'
            }`}
          >
            ▲ Movers
          </button>
        </div>
        <span className="whitespace-nowrap text-[0.7rem] italic text-gray-400">
          {hasLive && (
            <span className="not-italic text-sky-700">
              <span className="align-super text-[0.7em] text-sky-400">●</span>{' '}
              {liveRanked ? 'ranked on live-adjusted composite' : 'live-adjusted'} ·{' '}
            </span>
          )}
          Bars are percentile ranks (0–100, line = median) · click row = preview · click ticker = deep dive
        </span>
      </div>

      {/* virtualized grid */}
      <div ref={parentRef} className="overflow-auto" style={{ maxHeight: 640 }}>
        <div
          className={`sticky top-0 z-10 grid ${minW} border-b border-gray-200 bg-gray-50`}
          style={{ gridTemplateColumns: gridCols }}
        >
          <button type="button" onClick={() => toggleSort('rank')} className={`${TH} justify-end pr-2 text-gray-500`}>
            #{arrow('rank')}
          </button>
          <button type="button" onClick={() => toggleSort('ticker')} className={`${TH} text-gray-500`}>
            Company{arrow('ticker')}
          </button>
          <button type="button" onClick={() => toggleSort('sector')} className={`${TH} text-gray-500`}>
            Sector{arrow('sector')}
          </button>
          {FACTOR_ORDER.map((k) => (
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
          <button type="button" onClick={() => toggleSort('market_cap')} className={`${TH} justify-end text-gray-500`}>
            Mkt cap{arrow('market_cap')}
          </button>
          <button type="button" onClick={() => toggleSort('last_price')} className={`${TH} justify-end text-gray-500`}>
            Price{arrow('last_price')}
          </button>
          {rowAccessory && <div className={TH} aria-hidden="true" />}
        </div>

        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-500">
            No companies match the current filters.
            {emptyHint && (
              <div className="mx-auto mt-1.5 max-w-md text-[0.8rem] text-gray-400">
                {emptyHint}
              </div>
            )}
          </div>
        ) : (
          <div
            className={`relative ${minW}`}
            style={{ height: virtualizer.getTotalSize() }}
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
                  className="absolute left-0 grid w-full border-b border-gray-100 transition-[box-shadow,background] duration-100 hover:bg-slate-50 hover:shadow-[inset_3px_0_0_#1e293b]"
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
                  <div className="flex h-full flex-col items-end justify-center pr-2 leading-tight">
                    <span
                      className="numeric text-[0.74rem] font-semibold text-slate-600"
                      title={liveRanked ? 'Live-adjusted rank · nightly #' + r.rank : undefined}
                    >
                      {liveRanked ? vi.index + 1 : r.rank}
                    </span>
                    {r.rank_delta != null && r.rank_delta !== 0 && (
                      <span
                        className={`text-[0.58rem] font-bold tabular-nums ${
                          r.rank_delta > 0 ? 'text-emerald-600' : 'text-red-500'
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
                  <div className="flex h-full min-w-0 flex-col justify-center px-3 py-1.5">
                    {onRowClick ? (
                      <>
                        <span className="flex items-center gap-1">
                          <Link
                            to={`/securities/${r.ticker}`}
                            className="text-[0.88rem] font-bold leading-[1.15] text-gray-900 hover:text-indigo-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.ticker}
                          </Link>
                          <ValueTrapMark row={r} />
                          <WhatChanged d={r.composite_delta_7d} />
                        </span>
                        <span className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[0.72rem] text-gray-400">
                          {r.name ?? DASH}
                        </span>
                      </>
                    ) : (
                      <Link
                        to={`/securities/${r.ticker}`}
                        className="contents text-inherit no-underline"
                      >
                        <span className="flex items-center gap-1">
                          <span className="text-[0.88rem] font-bold leading-[1.15] text-gray-900">
                            {r.ticker}
                          </span>
                          <ValueTrapMark row={r} />
                          <WhatChanged d={r.composite_delta_7d} />
                        </span>
                        <span className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[0.72rem] text-gray-400">
                          {r.name ?? DASH}
                        </span>
                      </Link>
                    )}
                  </div>
                  <div className="flex h-full min-w-0 items-center px-3 py-1.5">
                    <SectorPill sector={r.sector} />
                  </div>
                  <ScoreCell
                    factor="composite"
                    value={r.composite}
                    live={liveByTicker?.[r.ticker]?.composite_live}
                    delta={r.composite_delta}
                    sparkline={r.composite_history}
                  />
                  <ScoreCell factor="growth" value={r.growth_pctl} subPctls={r.sub_pctls} />
                  <ScoreCell
                    factor="value"
                    value={r.value_pctl}
                    live={liveByTicker?.[r.ticker]?.value_live}
                    subPctls={r.sub_pctls}
                  />
                  <ScoreCell factor="quality" value={r.quality_pctl} subPctls={r.sub_pctls} />
                  <ScoreCell
                    factor="momentum"
                    value={r.momentum_pctl}
                    live={liveByTicker?.[r.ticker]?.momentum_live}
                    subPctls={r.sub_pctls}
                  />
                  <div className="numeric flex h-full items-center justify-end px-3 text-[0.8rem] font-semibold text-slate-600">
                    {fmtMoney(r.market_cap)}
                  </div>
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
        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-2.5">
          <span className="text-[0.72rem] text-slate-500">
            Showing{' '}
            <span className="numeric font-semibold text-slate-700">1–{visible.length}</span> of{' '}
            <span className="numeric font-semibold text-slate-700">{rows.length}</span>
          </span>
          {rows.length > PREVIEW_N && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-[0.76rem] font-bold text-indigo-600 hover:underline"
            >
              {expanded ? `Show top ${PREVIEW_N}` : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
