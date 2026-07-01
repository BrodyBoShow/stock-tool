import { useState } from 'react'
import { Link } from 'react-router-dom'

import { fmtSignedPct } from '@/lib/format'
import type { MarketSectorRow } from '@/types/api'

import { SectorTable } from './sections'
import { heat } from './utils'

/** One tile's computed geometry within a row-packed treemap. */
interface Tile {
  s: MarketSectorRow
  weight: number
}

/**
 * Dependency-free treemap layout: area ∝ sqrt(n) so big sectors read bigger but
 * the range stays compressed. We sort descending by weight and greedily pack
 * tiles into a fixed number of rows, balancing each row's total weight so the
 * grid tiles cleanly. Each row is flex; tiles flex-grow by weight; the row's
 * own height is proportional to its weight share of the whole — a squarified feel
 * without d3.
 */
function packRows(sectors: MarketSectorRow[], rowCount: number): Tile[][] {
  const tiles: Tile[] = sectors
    .map((s) => ({ s, weight: Math.sqrt(Math.max(s.n, 1)) }))
    .sort((a, b) => b.weight - a.weight)
  const rows: Tile[][] = Array.from({ length: rowCount }, () => [])
  const rowWeights = new Array<number>(rowCount).fill(0)
  // Greedy: drop each tile (largest first) into the lightest row so far.
  for (const t of tiles) {
    let lightest = 0
    for (let i = 1; i < rowCount; i += 1) {
      if (rowWeights[i] < rowWeights[lightest]) lightest = i
    }
    rows[lightest].push(t)
    rowWeights[lightest] += t.weight
  }
  return rows.filter((r) => r.length > 0)
}

function tileTitle(s: MarketSectorRow): string {
  const parts = [
    `${s.sector} · ${s.n} names`,
    `1D ${fmtSignedPct(s.r1d)}`,
    `1W ${fmtSignedPct(s.r1w)}`,
    `1M ${fmtSignedPct(s.r1m)}`,
    `3M ${fmtSignedPct(s.r3m)}`,
    `YTD ${fmtSignedPct(s.rytd)}`,
  ]
  if (s.adv_pct != null) parts.push(`Breadth ${(s.adv_pct * 100).toFixed(0)}% up`)
  return parts.join('\n')
}

function SectorTiles({ sectors }: { sectors: MarketSectorRow[] }) {
  // Fewer rows for a small set keeps tiles from becoming slivers.
  const rowCount = sectors.length <= 4 ? 1 : sectors.length <= 8 ? 2 : 3
  const rows = packRows(sectors, rowCount)
  const rowWeights = rows.map((r) => r.reduce((sum, t) => sum + t.weight, 0))
  const totalWeight = rowWeights.reduce((a, b) => a + b, 0) || 1

  return (
    <div className="flex h-[340px] flex-col gap-1.5">
      {rows.map((row, ri) => (
        <div
          key={row.map((t) => t.s.sector).join('|')}
          className="flex min-h-0 gap-1.5"
          style={{ flexGrow: rowWeights[ri] / totalWeight, flexBasis: 0 }}
        >
          {row.map((t) => {
            // Null 1-day return → a hatched neutral tile that reads as "no data",
            // not a flat 0% move (the color legend only speaks for real returns).
            const noData = t.s.r1d == null
            const style = noData
              ? { background: 'repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 6px,#e2e8f0 6px,#e2e8f0 12px)' }
              : heat(t.s.r1d, 0.025)
            return (
              <Link
                key={t.s.sector}
                to={`/?sector=${encodeURIComponent(t.s.sector)}`}
                title={tileTitle(t.s)}
                className="group relative flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-white/60 px-2 text-center no-underline transition-shadow hover:shadow-[0_0_0_2px_rgba(79,70,229,0.5)]"
                style={{ flexGrow: t.weight, flexBasis: 0, ...style }}
              >
                <span className="max-w-full truncate text-[0.74rem] font-bold leading-tight text-slate-900">
                  {t.s.sector}
                </span>
                <span className="text-[0.82rem] font-extrabold tabular-nums text-slate-900">
                  {noData ? 'no data' : fmtSignedPct(t.s.r1d)}
                </span>
                {!noData && t.s.adv_pct != null && (
                  <span className="text-[0.62rem] font-semibold tabular-nums text-slate-700/80">
                    {(t.s.adv_pct * 100).toFixed(0)}% up
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </div>
  )
}

const TOGGLE_BTN = 'rounded-md px-2.5 py-1 text-[0.7rem] font-semibold transition-colors'

/** Sector performance as a treemap (area ∝ sqrt name-count, colored by 1D) with
 * a toggle back to the existing sortable table. */
export function SectorTreemap({ sectors }: { sectors: MarketSectorRow[] }) {
  const [view, setView] = useState<'treemap' | 'table'>('treemap')
  if (sectors.length === 0) {
    return <p className="text-sm text-gray-400">No sector data for this session — prices may still be loading.</p>
  }
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[0.68rem] text-slate-400">
          {view === 'treemap' ? 'Tile size ∝ number of names · color = 1-day move · click to screen the sector' : 'Full multi-period table'}
        </span>
        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5">
          <button
            type="button"
            onClick={() => setView('treemap')}
            className={`${TOGGLE_BTN} ${view === 'treemap' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Treemap
          </button>
          <button
            type="button"
            onClick={() => setView('table')}
            className={`${TOGGLE_BTN} ${view === 'table' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Table
          </button>
        </div>
      </div>
      {view === 'treemap' ? <SectorTiles sectors={sectors} /> : <SectorTable sectors={sectors} />}
    </div>
  )
}
