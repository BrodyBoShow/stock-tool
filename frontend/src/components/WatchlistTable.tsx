import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ScoreCell } from '@/components/screener/ScoreCell'
import { SectorPill } from '@/components/screener/SectorPill'
import { WatchlistButton } from '@/components/WatchlistButton'
import { FACTOR_ORDER, FACTOR_TABLE, type FactorKey } from '@/lib/constants'
import { DASH, fmtPrice } from '@/lib/format'
import type { WatchlistRow } from '@/types/api'

/**
 * Mirrors the screener table's look (same ScoreCell / SectorPill cells, same
 * column rhythm) but for the small saved-names set: no virtualization, plus a
 * trailing Remove action. Rows use a stretched <Link> so the whole row opens
 * the deep dive while the Remove button keeps its own click.
 */

// company · sector · 5 factors · price · remove (screener grid minus rank, plus action)
const GRID =
  'minmax(150px,1.6fr) minmax(130px,1.3fr) repeat(5,minmax(78px,1fr)) minmax(90px,0.9fr) 84px'

type SortKey =
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

const TH =
  'flex items-center px-3 py-[9px] text-[0.68rem] font-bold uppercase tracking-[0.06em] whitespace-nowrap select-none'

function compareRows(a: WatchlistRow, b: WatchlistRow, key: SortKey, dir: 1 | -1): number {
  const av = a[key]
  const bv = b[key]
  if (av === null && bv === null) return 0
  if (av === null) return 1
  if (bv === null) return -1
  if (typeof av === 'string' && typeof bv === 'string') {
    return av.localeCompare(bv) * dir
  }
  return ((av as number) - (bv as number)) * dir
}

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: 'composite',
    dir: -1,
  })

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareRows(a, b, sort.key, sort.dir)),
    [rows, sort],
  )

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: key === 'ticker' || key === 'sector' ? 1 : -1 },
    )

  const arrow = (key: SortKey) =>
    sort.key === key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''

  const cell = 'pointer-events-none relative z-[1]'

  return (
    <section className="overflow-hidden rounded-card border border-gray-200 bg-white shadow-card">
      <div className="overflow-x-auto">
        {/* header */}
        <div
          className="grid min-w-[820px] border-b border-gray-200 bg-gray-50"
          style={{ gridTemplateColumns: GRID }}
        >
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
          <div className={`${TH} justify-center`} />
        </div>

        {/* rows */}
        <div className="min-w-[820px]">
          {sorted.map((r) => (
            <div
              key={r.security_id}
              className="group relative grid border-b border-gray-100 transition-[box-shadow,background] duration-100 last:border-b-0 hover:bg-slate-50 hover:shadow-[inset_3px_0_0_#1e293b]"
              style={{ gridTemplateColumns: GRID, height: 52 }}
            >
              <Link
                to={`/securities/${r.ticker}`}
                aria-label={`Open ${r.ticker} deep dive`}
                className="absolute inset-0 z-0"
              />
              <div className={`${cell} flex h-full min-w-0 flex-col justify-center px-3 py-2`}>
                <span className="text-[0.88rem] font-bold leading-[1.15] text-gray-900">
                  {r.ticker}
                </span>
                <span className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[0.72rem] text-gray-400">
                  {r.name ?? DASH}
                </span>
              </div>
              <div className={`${cell} flex h-full min-w-0 items-center px-3 py-2`}>
                <SectorPill sector={r.sector} />
              </div>
              <div className={`${cell} h-full`}>
                <ScoreCell factor="composite" value={r.composite} />
              </div>
              <div className={`${cell} h-full`}>
                <ScoreCell factor="growth" value={r.growth_pctl} />
              </div>
              <div className={`${cell} h-full`}>
                <ScoreCell factor="value" value={r.value_pctl} />
              </div>
              <div className={`${cell} h-full`}>
                <ScoreCell factor="quality" value={r.quality_pctl} />
              </div>
              <div className={`${cell} h-full`}>
                <ScoreCell factor="momentum" value={r.momentum_pctl} />
              </div>
              <div className={`${cell} flex h-full flex-col items-end justify-center px-3 py-2`}>
                <span className="text-[0.85rem] font-semibold text-gray-900">
                  {fmtPrice(r.last_price)}
                </span>
              </div>
              <div className="relative z-10 flex h-full items-center justify-center">
                <WatchlistButton ticker={r.ticker} variant="remove" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
