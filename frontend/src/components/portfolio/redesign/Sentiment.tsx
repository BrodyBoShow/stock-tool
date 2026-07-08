import type { ReactNode } from 'react'
import {
  SENTIMENT_GLYPH,
  SENTIMENT_WORD,
  sentimentColorClass,
  type Sentiment,
} from './sentimentUtils'

export type { Sentiment } from './sentimentUtils'

/**
 * A value that encodes direction with BOTH color AND a ▲/▼ glyph, plus an
 * sr-only "…, positive/negative" suffix — so meaning survives color-blindness
 * and screen readers (spec: "Color is never the only signal"). `neutral` renders
 * plain ink with no arrow.
 *
 * `srLabel` is the human name of the value (e.g. "time-weighted return") so the
 * screen reader announces "plus 78.1 percent, time-weighted return, positive"
 * rather than a bare number.
 */
export function SentimentValue({
  s,
  children,
  srLabel,
  className = '',
}: {
  s: Sentiment
  children: ReactNode
  srLabel?: string
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${sentimentColorClass(s)} ${className}`}>
      {s !== 'neutral' && (
        <span aria-hidden="true" className="text-[0.8em] leading-none">
          {SENTIMENT_GLYPH[s]}
        </span>
      )}
      <span>{children}</span>
      <span className="sr-only">
        {srLabel ? `${srLabel}, ` : ''}
        {SENTIMENT_WORD[s]}
      </span>
    </span>
  )
}
