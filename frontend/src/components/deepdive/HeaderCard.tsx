import { SectorPill } from '@/components/screener/SectorPill'
import { topDriver, type FactorPctls } from '@/lib/factorReading'
import { DASH, fmtDate, fmtPrice } from '@/lib/format'
import type { SecurityHeader } from '@/types/api'

const STAT_LABEL = 'text-[0.75rem] text-gray-500'
const STAT_VALUE = 'text-[1.35rem] font-extrabold text-gray-900'
const STAT_SUB = 'text-[0.72rem] text-gray-400'

export function HeaderCard({
  header,
  action,
}: {
  header: SecurityHeader
  action?: React.ReactNode
}) {
  // "Why ranked here" one-liner (Phase 1, 1f) — built client-side from the
  // percentiles already on the header. Names the factor pulling the composite up
  // most (only when its lead is clear), plus how many sub-metrics were scored.
  const pctls: FactorPctls = {
    composite: header.composite,
    growth: header.growth_pctl,
    value: header.value_pctl,
    quality: header.quality_pctl,
    momentum: header.momentum_pctl,
  }
  const driver = topDriver(pctls)
  const nSub = header.details?.sub_pctls
    ? Object.values(header.details.sub_pctls).filter((v) => v != null).length
    : null
  const whyRanked =
    header.composite == null
      ? null
      : `${driver ? `Strongest factor: ${driver.label}` : 'Balanced across factors'}` +
        `${nSub != null ? ` · ${nSub} sub-metrics scored` : ''}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-[18px] rounded-card border border-gray-200 bg-white px-[22px] py-5 shadow-card">
      <div className="flex items-center gap-3.5">
        <div
          className="flex h-[54px] w-[54px] flex-none items-center justify-center rounded-[13px] text-[1.15rem] font-extrabold text-white"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #4f46e5)' }}
        >
          {header.ticker.slice(0, 2)}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[1.45rem] font-extrabold text-gray-900">
              {header.ticker}
            </span>
            {header.exchange && (
              <span className="rounded-full bg-gray-100 px-2.5 py-[3px] text-[0.72rem] font-semibold text-gray-700">
                {header.exchange}
              </span>
            )}
            <SectorPill sector={header.sector} />
          </div>
          <div className="mt-px text-[0.95rem] text-gray-700">
            {header.name ?? DASH}
          </div>
          {header.industry && (
            <div className="mt-0.5 text-[0.78rem] text-gray-400">
              {header.industry}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-3">
        {action}
        <div className="flex gap-[34px]">
          <div>
            <div className={STAT_LABEL}>Last close</div>
          <div className={STAT_VALUE}>{fmtPrice(header.last_price)}</div>
          <div className={STAT_SUB}>{fmtDate(header.price_date)}</div>
        </div>
        <div>
          <div className={STAT_LABEL}>Composite</div>
          <div className={STAT_VALUE}>
            {header.composite === null ? DASH : header.composite.toFixed(1)}
          </div>
          <div className={STAT_SUB}>percentile rank · 100 = top</div>
        </div>
        <div>
          <div className={STAT_LABEL}>Scores</div>
          <div className={STAT_VALUE}>{fmtDate(header.score_date)}</div>
          <div className={STAT_SUB}>nightly batch</div>
        </div>
        </div>
        {whyRanked && (
          <div
            className="text-[0.72rem] text-gray-400"
            title="The factor pulling this composite up the most, relative to the others. Descriptive — not advice."
          >
            {whyRanked}
          </div>
        )}
      </div>
    </div>
  )
}
