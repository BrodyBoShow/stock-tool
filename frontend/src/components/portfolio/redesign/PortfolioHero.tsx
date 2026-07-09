import { fmtPrice, fmtSignedMoney, fmtSignedPct } from '@/lib/format'
import { SentimentValue } from './Sentiment'
import { sentimentFromNumber } from './sentimentUtils'

export interface PortfolioHeroProps {
  value: number
  /** Today's $ change (signed). */
  dayChange: number
  /** Today's % change as a FRACTION (0.0045 -> +0.45%). */
  dayChangePct: number
  status?: 'live' | 'stale'
  /** Optional benchmark label shown as context (e.g. "vs SPY"). */
  benchmark?: string
}

/**
 * Zone A hero. The portfolio value dominates — 44px display mono, ≥3× the
 * secondary text (spec principle: Calm hierarchy). The daily change is a pill
 * that encodes direction with BOTH ▲/▼ and color (never color alone), and the
 * status dot is amber + "prices delayed" when stale (spec: Stale state).
 */
export function PortfolioHero({
  value,
  dayChange,
  dayChangePct,
  status = 'live',
  benchmark,
}: PortfolioHeroProps) {
  const s = sentimentFromNumber(dayChange)
  const stale = status === 'stale'
  return (
    <div className="rounded-[var(--r-xl)] border border-line bg-surface p-5 shadow-[var(--sh-sm)]">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="numeric text-h1 font-bold leading-none text-ink sm:text-display">
          {fmtPrice(value)}
        </div>
        <div className="flex flex-col gap-0.5 pb-1">
          <span className="text-[0.72rem] text-muted">
            Total portfolio value{benchmark ? ` · vs ${benchmark}` : ''}
          </span>
          <SentimentValue
            s={s}
            className="numeric text-[0.95rem] font-semibold"
            srLabel={`${fmtSignedMoney(dayChange)} ${fmtSignedPct(dayChangePct)} today`}
          >
            {fmtSignedMoney(dayChange)} ({fmtSignedPct(dayChangePct)}) today
          </SentimentValue>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-muted">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${stale ? 'bg-warn' : 'bg-pos'}`}
        />
        {stale ? 'prices delayed' : 'live'} · ~15m delay
      </div>
    </div>
  )
}
