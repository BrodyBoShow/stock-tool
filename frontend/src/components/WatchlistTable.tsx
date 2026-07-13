import { Bell, PencilLine, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ScoreCell } from '@/components/screener/ScoreCell'
import { SectorPill } from '@/components/screener/SectorPill'
import { Sparkline } from '@/components/screener/Sparkline'
import { Icon } from '@/components/ui/Icon'
import { RiskBandChip } from '@/components/ui/RiskBandChip'
import { WatchlistButton } from '@/components/WatchlistButton'
import { WatchlistAlertDialog } from '@/components/watchlist/WatchlistAlertDialog'
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

// company · sector · risk · 5 factors · trend · entry · price · actions
const GRID =
  'minmax(146px,1.4fr) minmax(112px,1.1fr) minmax(72px,0.8fr) repeat(5,minmax(66px,1fr)) minmax(54px,0.6fr) minmax(92px,0.95fr) minmax(96px,1fr) 108px'

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
  'flex items-center px-3 py-[6px] text-[0.66rem] font-bold uppercase tracking-[0.06em] whitespace-nowrap select-none'

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

/** Live-adjusted factor percentiles by ticker (composite/value/momentum only —
 *  growth & quality are filing-driven, never price-adjusted). Sourced from the
 *  "what changed" digest so the table's cells mirror the screener's live * cells. */
export interface WatchlistLive {
  composite_live: number | null
  value_live: number | null
  momentum_live: number | null
}

export function WatchlistTable({
  rows,
  live,
}: {
  rows: WatchlistRow[]
  live?: Record<string, WatchlistLive>
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: 'composite',
    dir: -1,
  })
  const [planRow, setPlanRow] = useState<WatchlistRow | null>(null)
  const [alertTicker, setAlertTicker] = useState<string | null>(null)

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
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="overflow-x-auto">
        {/* header */}
        <div
          className="grid min-w-[1116px] border-b border-line bg-surface-2"
          style={{ gridTemplateColumns: GRID }}
        >
          <button type="button" onClick={() => toggleSort('ticker')} className={`${TH} text-muted`}>
            Company{arrow('ticker')}
          </button>
          <button type="button" onClick={() => toggleSort('sector')} className={`${TH} text-muted`}>
            Sector{arrow('sector')}
          </button>
          <button
            type="button"
            onClick={() => toggleSort('risk_band')}
            className={`${TH} justify-center text-muted`}
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
          <div className={`${TH} justify-center text-subtle`} title="Price trend over the last ~30 trading sessions (end-of-day closes).">
            1M
          </div>
          <div
            className={`${TH} justify-center text-muted`}
            title="Your entry plan: a target price you'd buy at (drives the buy-zone / %-above readout) plus your buy & drop criteria. Your private notes — StockBud never acts on them."
          >
            Entry
          </div>
          <button
            type="button"
            onClick={() => toggleSort('last_price')}
            className={`${TH} justify-end text-muted`}
            title="Latest end-of-day close. The % below each price is the change from the prior close — end-of-day, not live intraday."
          >
            Price{arrow('last_price')}
          </button>
          <div className={`${TH} justify-center`} />
        </div>

        {/* rows */}
        <div className="min-w-[1116px]">
          {sorted.map((r) => {
            const day = dayChange(r)
            const dayCls =
              day == null || day === 0
                ? 'text-subtle'
                : day > 0
                  ? 'text-pos'
                  : 'text-neg'
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
                className="group relative grid overflow-x-clip border-b border-line transition-[box-shadow,background] duration-100 last:border-b-0 hover:bg-surface-2 hover:shadow-[inset_3px_0_0_var(--accent)]"
                style={{ gridTemplateColumns: GRID, height: 36 }}
              >
                <Link
                  to={`/securities/${r.ticker}`}
                  aria-label={`Open ${r.ticker} deep dive`}
                  className="absolute inset-0 z-0"
                />
                <div className={`${cell} flex h-full min-w-0 flex-col justify-center px-3 py-1`}>
                  <span className="flex items-center gap-1.5 text-[0.82rem] font-bold leading-[1.1] text-ink">
                    <span className="numeric">{r.ticker}</span>
                    {r.thesis_review_due && (
                      <span
                        className="rounded-full bg-warn-soft px-1.5 text-[0.56rem] font-bold uppercase tracking-wide text-warn"
                        title="Your thesis review date has passed — open the plan or the deep dive to review it."
                      >
                        review
                      </span>
                    )}
                  </span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.68rem] leading-tight text-subtle">
                    {r.name ?? DASH}
                  </span>
                </div>
                <div className={`${cell} flex h-full min-w-0 items-center px-3 py-1`}>
                  <SectorPill sector={r.sector} />
                </div>
                <div className="relative z-10 flex h-full items-center justify-center px-2">
                  <RiskBandChip band={r.risk_band} compact />
                </div>
                <div className={`${cell} h-full`}>
                  <ScoreCell dense factor="composite" value={r.composite} live={live?.[r.ticker]?.composite_live} />
                </div>
                <div className={`${cell} h-full`}>
                  <ScoreCell dense factor="growth" value={r.growth_pctl} />
                </div>
                <div className={`${cell} h-full`}>
                  <ScoreCell dense factor="value" value={r.value_pctl} live={live?.[r.ticker]?.value_live} />
                </div>
                <div className={`${cell} h-full`}>
                  <ScoreCell dense factor="quality" value={r.quality_pctl} />
                </div>
                <div className={`${cell} h-full`}>
                  <ScoreCell dense factor="momentum" value={r.momentum_pctl} live={live?.[r.ticker]?.momentum_live} />
                </div>
                {/* z-10 (not the pointer-events-none `cell`) so the sparkline
                    receives hover; the row's absolute-inset Link still covers
                    the rest of the row for click-through. */}
                <div className="relative z-10 flex h-full items-center justify-center px-2">
                  <Sparkline
                    data={r.price_history}
                    height={12}
                    title={`${r.ticker} price over the last ${r.price_history?.length ?? 0} sessions`}
                    fmt={(v) => `$${v.toFixed(2)}`}
                  />
                </div>
                <div className="relative z-10 flex h-full items-center justify-center px-1">
                  {target != null ? (
                    <button
                      type="button"
                      onClick={() => setPlanRow(r)}
                      className="flex flex-col items-center gap-0.5 rounded-md px-1.5 py-0.5 hover:bg-surface-3"
                      title="Edit your entry plan"
                    >
                      <span className="numeric text-[0.78rem] font-semibold leading-none text-ink">
                        {fmtPrice(target)}
                      </span>
                      {buyZone ? (
                        <span
                          className="rounded-full bg-pos-soft px-1.5 text-[0.6rem] font-bold leading-none text-pos"
                          title={`Price has reached your ${fmtPrice(target)} target — your plan, not advice`}
                        >
                          in buy zone
                        </span>
                      ) : pctAbove != null ? (
                        <span
                          className="rounded-full bg-warn-soft px-1.5 text-[0.6rem] font-semibold leading-none text-warn"
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
                      className="inline-flex items-center gap-1 rounded-md border border-dashed border-line px-2 py-1 text-[0.66rem] font-semibold text-subtle hover:border-accent hover:text-accent"
                      title="Set your entry plan (target price, why watching, buy/drop criteria)"
                    >
                      <Icon icon={hasPlan ? PencilLine : Plus} size={12} />
                      Plan
                    </button>
                  )}
                </div>
                <div className={`${cell} flex h-full flex-col items-end justify-center px-3 py-1 leading-tight`}>
                  <span className="numeric text-[0.8rem] font-semibold text-ink">
                    {fmtPrice(r.last_price)}
                  </span>
                  <span className={`numeric text-[0.62rem] font-semibold ${dayCls}`}>
                    {day == null ? DASH : `${day > 0 ? '▲' : day < 0 ? '▼' : ''} ${fmtSignedPct(day)}`}
                  </span>
                </div>
                <div className="relative z-10 flex h-full items-center justify-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAlertTicker(r.ticker)}
                    className="rounded-md p-1 text-subtle hover:bg-surface-3 hover:text-accent"
                    title={`Set event alerts for ${r.ticker}`}
                    aria-label={`Set alerts for ${r.ticker}`}
                  >
                    <Icon icon={Bell} size={14} />
                  </button>
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
      {alertTicker && (
        <WatchlistAlertDialog
          key={alertTicker}
          ticker={alertTicker}
          onClose={() => setAlertTicker(null)}
        />
      )}
    </section>
  )
}
