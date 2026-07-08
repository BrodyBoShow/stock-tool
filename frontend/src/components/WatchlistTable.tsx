import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ScoreCell } from '@/components/screener/ScoreCell'
import { SectorPill } from '@/components/screener/SectorPill'
import { Sparkline } from '@/components/screener/Sparkline'
import { RiskBandChip } from '@/components/ui/RiskBandChip'
import { WatchlistButton } from '@/components/WatchlistButton'
import { WatchlistPlanDialog } from '@/components/watchlist/WatchlistPlanDialog'
import { FACTOR_ORDER, FACTOR_TABLE, type FactorKey } from '@/lib/constants'
import { DASH, fmtPrice, fmtSignedPct } from '@/lib/format'
import type { WatchlistRow } from '@/types/api'

/**
 * Mirrors the screener table's look (same ScoreCell / SectorPill cells, same
 * column rhythm) but for the small saved-names set: no virtualization, plus a
 * trailing Remove action. Rows use a stretched <Link> so the whole row opens
 * the deep dive while the Remove button keeps its own click.
 *
 * P1 row upgrades (watchlist redesign): a historical risk-band chip, a 30-session
 * price sparkline, and a close-to-close day-change under the price — the price
 * context the screener already shows but this table never did.
 */

// company · sector · risk · 5 factors · trend · entry · price · remove
const GRID =
  'minmax(146px,1.4fr) minmax(112px,1.1fr) minmax(72px,0.8fr) repeat(5,minmax(66px,1fr)) minmax(54px,0.6fr) minmax(92px,0.95fr) minmax(96px,1fr) 72px'

type SortKey =
  | 'ticker'
  | 'sector'
  | 'risk_band'
  | 'day_change'
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

/** Close-to-close day change (latest EOD close vs the prior close). Null when
 *  either close is missing — never fabricated. */
function dayChange(r: WatchlistRow): number | null {
  if (r.last_price == null || r.prev_close == null || r.prev_close === 0) return null
  return (r.last_price - r.prev_close) / r.prev_close
}

function sortValue(r: WatchlistRow, key: SortKey): number | string | null {
  if (key === 'day_change') return dayChange(r)
  return r[key] as number | string | null
}

function compareRows(a: WatchlistRow, b: WatchlistRow, key: SortKey, dir: 1 | -1): number {
  const av = sortValue(a, key)
  const bv = sortValue(b, key)
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
  const [planRow, setPlanRow] = useState<WatchlistRow | null>(null)

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
          className="grid min-w-[1080px] border-b border-gray-200 bg-gray-50"
          style={{ gridTemplateColumns: GRID }}
        >
          <button type="button" onClick={() => toggleSort('ticker')} className={`${TH} text-gray-500`}>
            Company{arrow('ticker')}
          </button>
          <button type="button" onClick={() => toggleSort('sector')} className={`${TH} text-gray-500`}>
            Sector{arrow('sector')}
          </button>
          <button
            type="button"
            onClick={() => toggleSort('risk_band')}
            className={`${TH} justify-center text-gray-500`}
            title="Historical risk band (1-5) from realized volatility, beta and drawdown over the past year. A backward-looking measurement, not a recommendation — hover a chip for the full method."
          >
            Risk{arrow('risk_band')}
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
          <div className={`${TH} justify-center text-gray-400`} title="Price trend over the last ~30 trading sessions (end-of-day closes).">
            1M
          </div>
          <div
            className={`${TH} justify-center text-gray-500`}
            title="Your entry plan: a target price you'd buy at (drives the buy-zone / %-above readout) plus your buy & drop criteria. Your private notes — StockBud never acts on them."
          >
            Entry
          </div>
          <button
            type="button"
            onClick={() => toggleSort('last_price')}
            className={`${TH} justify-end text-gray-500`}
            title="Latest end-of-day close. The % below each price is the change from the prior close — end-of-day, not live intraday."
          >
            Price{arrow('last_price')}
          </button>
          <div className={`${TH} justify-center`} />
        </div>

        {/* rows */}
        <div className="min-w-[1080px]">
          {sorted.map((r) => {
            const day = dayChange(r)
            const dayCls =
              day == null || day === 0
                ? 'text-gray-400'
                : day > 0
                  ? 'text-emerald-600'
                  : 'text-rose-600'
            const target = r.target_price
            const buyZone = target != null && r.last_price != null && r.last_price <= target
            const pctAbove =
              target != null && target > 0 && r.last_price != null && r.last_price > target
                ? (r.last_price - target) / target
                : null
            const hasPlan = !!(r.note || r.entry_trigger || r.kill_criteria)
            return (
              <div
                key={r.security_id}
                className="group relative grid border-b border-gray-100 transition-[box-shadow,background] duration-100 last:border-b-0 hover:bg-slate-50 hover:shadow-[inset_3px_0_0_#1e293b]"
                style={{ gridTemplateColumns: GRID, height: 54 }}
              >
                <Link
                  to={`/securities/${r.ticker}`}
                  aria-label={`Open ${r.ticker} deep dive`}
                  className="absolute inset-0 z-0"
                />
                <div className={`${cell} flex h-full min-w-0 flex-col justify-center px-3 py-2`}>
                  <span className="flex items-center gap-1.5 text-[0.88rem] font-bold leading-[1.15] text-gray-900">
                    {r.ticker}
                    {r.thesis_review_due && (
                      <span
                        className="rounded-full bg-amber-100 px-1.5 text-[0.56rem] font-bold uppercase tracking-wide text-amber-800"
                        title="Your thesis review date has passed — open the plan or the deep dive to review it."
                      >
                        review
                      </span>
                    )}
                  </span>
                  <span className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[0.72rem] text-gray-400">
                    {r.name ?? DASH}
                  </span>
                </div>
                <div className={`${cell} flex h-full min-w-0 items-center px-3 py-2`}>
                  <SectorPill sector={r.sector} />
                </div>
                <div className="relative z-10 flex h-full items-center justify-center px-2">
                  <RiskBandChip band={r.risk_band} compact />
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
                <div className={`${cell} flex h-full items-center justify-center px-2`}>
                  <Sparkline
                    data={r.price_history}
                    title={`${r.ticker} price over the last ${r.price_history?.length ?? 0} sessions`}
                  />
                </div>
                <div className="relative z-10 flex h-full items-center justify-center px-1">
                  {target != null ? (
                    <button
                      type="button"
                      onClick={() => setPlanRow(r)}
                      className="flex flex-col items-center gap-0.5 rounded-md px-1.5 py-1 hover:bg-slate-100"
                      title="Edit your entry plan"
                    >
                      <span className="text-[0.78rem] font-semibold tabular-nums text-slate-700">
                        {fmtPrice(target)}
                      </span>
                      {buyZone ? (
                        <span
                          className="rounded-full bg-emerald-50 px-1.5 text-[0.6rem] font-bold text-emerald-700"
                          title={`Price has reached your ${fmtPrice(target)} target — your plan, not advice`}
                        >
                          in buy zone
                        </span>
                      ) : pctAbove != null ? (
                        <span
                          className="rounded-full bg-amber-50 px-1.5 text-[0.6rem] font-semibold text-amber-700"
                          title={`${(pctAbove * 100).toFixed(0)}% above your ${fmtPrice(target)} target — your plan, not advice`}
                        >
                          {(pctAbove * 100).toFixed(0)}% above
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPlanRow(r)}
                      className="rounded-md border border-dashed border-gray-300 px-2 py-1 text-[0.66rem] font-semibold text-slate-400 hover:border-indigo-300 hover:text-indigo-600"
                      title="Set your entry plan (target price, why watching, buy/drop criteria)"
                    >
                      {hasPlan ? '✎ Plan' : '+ Plan'}
                    </button>
                  )}
                </div>
                <div className={`${cell} flex h-full flex-col items-end justify-center px-3 py-2`}>
                  <span className="text-[0.85rem] font-semibold text-gray-900">
                    {fmtPrice(r.last_price)}
                  </span>
                  <span className={`text-[0.72rem] font-semibold tabular-nums ${dayCls}`}>
                    {day == null ? DASH : `${day > 0 ? '▲' : day < 0 ? '▼' : ''} ${fmtSignedPct(day)}`}
                  </span>
                </div>
                <div className="relative z-10 flex h-full items-center justify-center">
                  <WatchlistButton ticker={r.ticker} variant="remove" />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {planRow && (
        <WatchlistPlanDialog
          key={planRow.ticker}
          row={planRow}
          onClose={() => setPlanRow(null)}
        />
      )}
    </section>
  )
}
