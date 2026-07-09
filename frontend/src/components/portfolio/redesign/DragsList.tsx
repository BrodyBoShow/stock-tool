import { fmtSignedMoney, fmtSignedPct } from '@/lib/format'
import { SentimentValue } from './Sentiment'

export interface DragItem {
  ticker: string
  name: string
  pctOfBook: number // 0..1
  lossPct: number // fraction, negative
  lossUsd: number // dollars, negative
}

/** Zone B (Overview) — the biggest drags on the book, each with an INLINE
 *  Review action (spec: DragsList — every row is actionable, sorted by $ loss,
 *  max 3 on Overview). Renders a calm "no drags" state when nothing is at a
 *  loss (never fabricated drama). Descriptive, not a call to sell. */
export function DragsList({
  items,
  onReview,
}: {
  items: DragItem[]
  onReview: (ticker: string) => void
}) {
  const top = [...items]
    .filter((d) => d.lossUsd < 0)
    .sort((a, b) => a.lossUsd - b.lossUsd)
    .slice(0, 3)

  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4 shadow-[var(--sh-sm)]">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-h3 font-bold text-ink">Biggest drags</h3>
        <span className="text-micro font-semibold uppercase tracking-wide text-muted">
          Top 3 by loss
        </span>
      </div>

      {top.length === 0 ? (
        <p className="py-6 text-center text-[0.8rem] text-muted">
          No holdings are at a loss right now. Nothing dragging the book.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {top.map((d) => (
            <li key={d.ticker} className="flex items-center gap-3 py-2.5">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-red-50 text-[0.72rem] font-bold text-neg"
              >
                {d.ticker.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[0.82rem] font-semibold text-ink">{d.ticker}</div>
                <div className="truncate text-[0.68rem] text-muted">{d.name}</div>
              </div>
              <div className="text-right">
                <SentimentValue s="neg" className="numeric justify-end text-[0.82rem] font-bold"
                  srLabel={`${d.ticker} unrealized`}>
                  {fmtSignedPct(d.lossPct)}
                </SentimentValue>
                <div className="numeric text-[0.68rem] text-muted">{fmtSignedMoney(d.lossUsd)}</div>
              </div>
              <button
                type="button"
                onClick={() => onReview(d.ticker)}
                className="ml-1 inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-[var(--r-md)] px-2.5 text-[0.75rem] font-semibold text-primary transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] focus-visible:ring-offset-2"
              >
                Review <span aria-hidden="true">→</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
