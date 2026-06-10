import { SectorPill } from '@/components/screener/SectorPill'
import { DASH, fmtDate, fmtPrice } from '@/lib/format'
import type { SecurityHeader } from '@/types/api'

const STAT_LABEL = 'text-[0.75rem] text-[#6b7280]'
const STAT_VALUE = 'text-[1.35rem] font-extrabold text-[#111827]'
const STAT_SUB = 'text-[0.72rem] text-[#9ca3af]'

export function HeaderCard({ header }: { header: SecurityHeader }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-[18px] rounded-card border border-[#e5e7eb] bg-white px-[22px] py-5 shadow-card">
      <div className="flex items-center gap-3.5">
        <div
          className="flex h-[54px] w-[54px] flex-none items-center justify-center rounded-[13px] text-[1.15rem] font-extrabold text-white"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #4f46e5)' }}
        >
          {header.ticker.slice(0, 2)}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[1.45rem] font-extrabold text-[#111827]">
              {header.ticker}
            </span>
            {header.exchange && (
              <span className="rounded-full bg-[#f3f4f6] px-2.5 py-[3px] text-[0.72rem] font-semibold text-[#374151]">
                {header.exchange}
              </span>
            )}
            <SectorPill sector={header.sector} />
          </div>
          <div className="mt-px text-[0.95rem] text-[#374151]">
            {header.name ?? DASH}
          </div>
          {header.industry && (
            <div className="mt-0.5 text-[0.78rem] text-[#9ca3af]">
              {header.industry}
            </div>
          )}
        </div>
      </div>

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
    </div>
  )
}
