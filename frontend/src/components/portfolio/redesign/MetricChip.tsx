import { InfoTip } from '@/components/ui/InfoTip'
import { SentimentValue, type Sentiment } from './Sentiment'

export interface MetricChipProps {
  label: string
  value: string
  /** Optional second line (e.g. "$10.73 realized · $25.46 divs"). */
  sub?: string
  sentiment?: Sentiment
  /** MANDATORY one-line plain-English explanation shown on hover/focus of the
   *  label's ? icon (spec principle: Plain-spoken by default — tooltips are not
   *  optional). Prop is required so a chip can't ship without a gloss. */
  gloss: string
}

/**
 * Compact secondary metric for the hero metric strip. The label carries a
 * mandatory `?` gloss tooltip; the value encodes direction with ▲/▼ + color, not
 * color alone. Deliberately recessive (spec: Calm hierarchy — secondary metrics
 * recede beneath the hero number).
 */
export function MetricChip({ label, value, sub, sentiment = 'neutral', gloss }: MetricChipProps) {
  return (
    <div className="rounded-[var(--r-lg)] border border-slate-200/70 bg-surface p-3 shadow-[var(--sh-sm)]">
      <div className="flex items-center text-micro font-semibold uppercase tracking-wide text-muted">
        <span>{label}</span>
        <InfoTip text={gloss} />
      </div>
      {/* Deliberately ~14px so the hero (44px display) stays ≥3× larger — the
          locked calm-hierarchy ratio. */}
      <div className="numeric mt-1 text-body font-bold leading-none">
        <SentimentValue s={sentiment} srLabel={label}>
          {value}
        </SentimentValue>
      </div>
      {sub && <div className="mt-1 text-[0.7rem] leading-snug text-muted">{sub}</div>}
    </div>
  )
}
