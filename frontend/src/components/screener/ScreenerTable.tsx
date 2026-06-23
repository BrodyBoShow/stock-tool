import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MouseEvent } from 'react'

import { ScoreCell } from '@/components/screener/ScoreCell'
import { SectorPill } from '@/components/screener/SectorPill'
import {
  FACTOR_ORDER,
  FACTOR_TABLE,
  PREVIEW_N,
  SCREENER_GRID,
  type FactorKey,
} from '@/lib/constants'
import { DASH, fmtPrice } from '@/lib/format'
import type { QuoteRow, ScreenerRow } from '@/types/api'

type SortKey =
  | 'rank'
  | 'ticker'
  | 'sector'
  | 'composite'
  | 'growth_pctl'
  | 'value_pctl'
  | 'quality_pctl'
  | 'momentum_pctl'
  | 'last_price'

const FACTOR_SORT: Record<FactorKey, SortKey> = {
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

const ROW_H = 44

const TH =
  'flex items-center px-3 py-[9px] text-[0.68rem] font-bold uppercase tracking-[0.06em] whitespace-nowrap select-none'

function compareRows(a: ScreenerRow, b: ScreenerRow, key: SortKey, dir: 1 | -1): number {
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
      <span className="text-[0.85rem] font-semibold text-gray-900">
        {fmtPrice(last)}
      </span>
      {delta}
    </div>
  )
}

export function ScreenerTable({
  rows,
  scoreDate,
  rowAccessory,
  onRowClick,
  liveByTicker,
}: {
  rows: ScreenerRow[]
  scoreDate: string | null
  /** Optional trailing per-row control (e.g. add-to-watchlist star). */
  rowAccessory?: (ticker: string) => React.ReactNode
  /** When provided, clicking the row body calls this instead of navigating. Ticker link still navigates. */
  onRowClick?: (row: ScreenerRow) => void
  /** Live-adjusted scores by ticker (display overlay; rank/sort stay nightly). */
  liveByTicker?: Record<string, QuoteRow>
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: 'composite',
    dir: -1,
  })
  const [expanded, setExpanded] = useState(false)

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareRows(a, b, sort.key, sort.dir)),
    [rows, sort],
  )
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW_N)

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: key === 'ticker' || key === 'sector' ? 1 : -1 },
    )

  const arrow = (key: SortKey) =>
    sort.key === key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''

  // append a 44px control column when an accessory is provided
  const gridCols = rowAccessory ? `${SCREENER_GRID} 44px` : SCREENER_GRID
  const minW = rowAccessory ? 'min-w-[864px]' : 'min-w-[820px]'

  const hasLive = liveByTicker
    ? Object.values(liveByTicker).some((q) => q.composite_live != null)
    : false

  return (
    <section className="min-w-0 flex-1 overflow-hidden rounded-card border border-gray-200 bg-white shadow-card">
      {/* card header */}
      <div className="px-4 pb-2.5 pt-3.5">
        <div className="text-base font-bold text-gray-900">US-listed companies</div>
        <div className="mt-0.5 text-[0.78rem] text-gray-500">
          {rows.length} companies · ranked by composite factor score · scores as of{' '}
          {scoreDate ?? 'n/a'} (nightly)
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-gray-100 bg-gray-50 px-4 py-2">
        <div className="flex flex-wrap gap-3.5">
          {FACTOR_ORDER.map((k) => (
            <span key={k} className="flex items-center text-[0.73rem] text-gray-600">
              <span
                className="mr-[5px] inline-block h-[9px] w-[9px] rounded-full"
                style={{ background: FACTOR_TABLE[k].bar }}
              />
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </span>
          ))}
        </div>
        <span className="whitespace-nowrap text-[0.7rem] italic text-gray-400">
          {hasLive && (
            <span className="not-italic text-sky-700">
              <span className="align-super text-[0.7em] text-sky-400">●</span> live-adjusted ·{' '}
            </span>
          )}
          Bars are percentile ranks (0–100) · click row = preview · click ticker = deep dive
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
          <button type="button" onClick={() => toggleSort('last_price')} className={`${TH} justify-end text-gray-500`}>
            Price{arrow('last_price')}
          </button>
          {rowAccessory && <div className={TH} aria-hidden="true" />}
        </div>

        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-500">
            No companies match the current filters.
          </div>
        ) : (
          <div
            className={`relative ${minW}`}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const r = visible[vi.index]
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
                  <div className="flex h-full items-center justify-end pr-2 text-[0.74rem] font-semibold tabular-nums text-slate-500">
                    {r.rank}
                  </div>
                  <div className="flex h-full min-w-0 flex-col justify-center px-3 py-1.5">
                    {onRowClick ? (
                      <>
                        <Link
                          to={`/securities/${r.ticker}`}
                          className="text-[0.88rem] font-bold leading-[1.15] text-gray-900 hover:text-indigo-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.ticker}
                        </Link>
                        <span className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[0.72rem] text-gray-400">
                          {r.name ?? DASH}
                        </span>
                      </>
                    ) : (
                      <Link
                        to={`/securities/${r.ticker}`}
                        className="contents text-inherit no-underline"
                      >
                        <span className="text-[0.88rem] font-bold leading-[1.15] text-gray-900">
                          {r.ticker}
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
                  />
                  <ScoreCell factor="growth" value={r.growth_pctl} />
                  <ScoreCell
                    factor="value"
                    value={r.value_pctl}
                    live={liveByTicker?.[r.ticker]?.value_live}
                  />
                  <ScoreCell factor="quality" value={r.quality_pctl} />
                  <ScoreCell
                    factor="momentum"
                    value={r.momentum_pctl}
                    live={liveByTicker?.[r.ticker]?.momentum_live}
                  />
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

      {/* expand toggle */}
      {rows.length > PREVIEW_N && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5 text-center">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[0.78rem] font-bold text-slate-800 hover:underline"
          >
            {expanded
              ? `Show top ${PREVIEW_N}`
              : `Show all ${rows.length} companies`}
          </button>
        </div>
      )}
    </section>
  )
}
