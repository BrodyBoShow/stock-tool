import { Link } from 'react-router-dom'

import type { MarketAnomaly } from '@/types/api'

// Tasteful, mostly-monochrome emoji per known anomaly type; ⚡ is the default
// for any type the backend adds later that we don't have a glyph for yet.
const TYPE_ICON: Record<string, string> = {
  breadth_divergence: '📊',
  factor_reversal: '🔀',
  vol_spike: '🌪',
  insider_cluster: '👥',
}

function iconFor(type: string): string {
  return TYPE_ICON[type] ?? '⚡'
}

/**
 * Anomalies feed — auto-detected unusual patterns from this session's data,
 * framed as context and never advice. Each card shows a type glyph, the title,
 * a one-line detail, and any tickers as chips linking to the deep-dive. Renders
 * a quiet empty state when nothing was flagged.
 */
export function AnomaliesFeed({ anomalies }: { anomalies: MarketAnomaly[] }) {
  if (!anomalies || anomalies.length === 0) {
    return (
      <div>
        <p className="rounded-lg border border-line bg-surface-2 px-4 py-6 text-center text-[0.84rem] text-subtle">
          No unusual patterns flagged this session.
        </p>
        <p className="mt-2 text-[0.72rem] text-subtle">
          Auto-detected from this session's data — context, not advice.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {anomalies.map((a) => (
          <div
            key={`${a.type}:${a.title}`}
            className="rounded-xl border border-line bg-surface p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0 text-[1.05rem] leading-none grayscale" aria-hidden>
                {iconFor(a.type)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[0.88rem] font-bold leading-snug text-ink">{a.title}</div>
                <p className="mt-0.5 text-[0.78rem] leading-snug text-muted">{a.detail}</p>
                {a.tickers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.tickers.map((t) => (
                      <Link
                        key={t}
                        to={`/securities/${t}`}
                        className="rounded bg-surface-3 px-1.5 py-0.5 text-[0.64rem] font-bold text-muted hover:bg-accent-soft hover:text-accent"
                      >
                        {t}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[0.72rem] text-subtle">
        Auto-detected from this session's data — context, not advice.
      </p>
    </div>
  )
}
