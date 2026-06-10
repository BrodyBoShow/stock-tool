import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

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
import type { ScreenerRow } from '@/types/api'

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

const ROW_H = 52

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
        <span className="text-[0.7rem] font-semibold text-[#16a34a]">
          ▲ {(chg * 100).toFixed(2)}%
        </span>
      ) : (
        <span className="text-[0.7rem] font-semibold text-[#dc2626]">
          ▼ {(Math.abs(chg) * 100).toFixed(2)}%
        </span>
      )
  }
  return (
    <div className="flex h-full flex-col items-end justify-center px-3 py-2">
      <span className="text-[0.85rem] font-semibold text-[#111827]">
        {fmtPrice(last)}
      </span>
      {delta}
    </div>
  )
}

export function ScreenerTable({
  rows,
  scoreDate,
}: {
  rows: ScreenerRow[]
  scoreDate: string | null
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

  return (
    <section className="min-w-0 flex-1 overflow-hidden rounded-card border border-[#e5e7eb] bg-white shadow-card">
      {/* card header */}
      <div className="px-4 pb-2.5 pt-3.5">
        <div className="text-base font-bold text-[#111827]">S&amp;P 500 companies</div>
        <div className="mt-0.5 text-[0.78rem] text-[#6b7280]">
          {rows.length} companies · ranked by composite factor score · scores as of{' '}
          {scoreDate ?? 'n/a'} (nightly)
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-[#f3f4f6] bg-[#f9fafb] px-4 py-2">
        <div className="flex flex-wrap gap-3.5">
          {FACTOR_ORDER.map((k) => (
            <span key={k} className="flex items-center text-[0.73rem] text-[#4b5563]">
              <span
                className="mr-[5px] inline-block h-[9px] w-[9px] rounded-full"
                style={{ background: FACTOR_TABLE[k].bar }}
              />
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </span>
          ))}
        </div>
        <span className="whitespace-nowrap text-[0.7rem] italic text-[#9ca3af]">
          Bars are percentile ranks (0–100) within the universe · click a row for the
          deep dive
        </span>
      </div>

      {/* virtualized grid */}
      <div ref={parentRef} className="overflow-auto" style={{ maxHeight: 640 }}>
        <div
          className="sticky top-0 z-10 grid min-w-[820px] border-b border-[#e5e7eb] bg-[#f9fafb]"
          style={{ gridTemplateColumns: SCREENER_GRID }}
        >
          <button type="button" onClick={() => toggleSort('rank')} className={`${TH} justify-end pr-2 text-[#6b7280]`}>
            #{arrow('rank')}
          </button>
          <button type="button" onClick={() => toggleSort('ticker')} className={`${TH} text-[#6b7280]`}>
            Company{arrow('ticker')}
          </button>
          <button type="button" onClick={() => toggleSort('sector')} className={`${TH} text-[#6b7280]`}>
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
          <button type="button" onClick={() => toggleSort('last_price')} className={`${TH} justify-end text-[#6b7280]`}>
            Price{arrow('last_price')}
          </button>
        </div>

        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[#6b7280]">
            No companies match the current filters.
          </div>
        ) : (
          <div
            className="relative min-w-[820px]"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const r = visible[vi.index]
              return (
                <Link
                  key={r.security_id}
                  to={`/securities/${r.ticker}`}
                  className="absolute left-0 grid w-full cursor-pointer border-b border-[#f3f4f6] text-inherit no-underline transition-[box-shadow,background] duration-100 hover:bg-[#f8fafc] hover:shadow-[inset_3px_0_0_#1e293b]"
                  style={{
                    gridTemplateColumns: SCREENER_GRID,
                    height: vi.size,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <div className="flex h-full items-center justify-end pr-2 text-[0.7rem] text-[#cbd5e1]">
                    {r.rank}
                  </div>
                  <div className="flex h-full min-w-0 flex-col justify-center px-3 py-2">
                    <span className="text-[0.88rem] font-bold leading-[1.15] text-[#111827]">
                      {r.ticker}
                    </span>
                    <span className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[0.72rem] text-[#9ca3af]">
                      {r.name ?? DASH}
                    </span>
                  </div>
                  <div className="flex h-full min-w-0 items-center px-3 py-2">
                    <SectorPill sector={r.sector} />
                  </div>
                  <ScoreCell factor="composite" value={r.composite} />
                  <ScoreCell factor="growth" value={r.growth_pctl} />
                  <ScoreCell factor="value" value={r.value_pctl} />
                  <ScoreCell factor="quality" value={r.quality_pctl} />
                  <ScoreCell factor="momentum" value={r.momentum_pctl} />
                  <PriceCell row={r} />
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* expand toggle */}
      {rows.length > PREVIEW_N && (
        <div className="border-t border-[#f3f4f6] bg-[#f9fafb] px-4 py-2.5 text-center">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[0.78rem] font-bold text-[#1e293b] hover:underline"
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
