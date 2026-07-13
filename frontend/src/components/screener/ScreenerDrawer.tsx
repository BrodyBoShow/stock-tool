import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import { ScoreWaterfall } from '@/components/deepdive/ScoreWaterfall'
import { SectorPill } from '@/components/screener/SectorPill'
import { FactorStamp } from '@/components/ui/FactorStamp'
import { WatchlistButton } from '@/components/WatchlistButton'
import { getSecurity } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { DASH, fmtDate, fmtPrice } from '@/lib/format'
import type { ScreenerRow } from '@/types/api'

export function ScreenerDrawer({
  row,
  onClose,
}: {
  row: ScreenerRow
  onClose: () => void
}) {
  // close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const { data, isPending } = useQuery({
    queryKey: ['security', row.ticker.toUpperCase(), 30],
    queryFn: () => getSecurity(row.ticker, 30),
    staleTime: 10 * 60 * 1000,
  })

  const header = data?.header

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 flex-none items-center justify-center rounded-[var(--r-md)] font-mono text-[0.9rem] font-bold text-accent-ink"
              style={{ background: 'var(--accent-solid)' }}
            >
              {row.ticker.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[1.1rem] font-bold text-ink">
                  {row.ticker}
                </span>
                <SectorPill sector={row.sector} />
              </div>
              <div className="text-[0.78rem] text-muted">
                {row.name ?? DASH}
              </div>
              <FactorStamp
                className="mt-1"
                growth={row.growth_pctl}
                value={row.value_pctl}
                quality={row.quality_pctl}
                momentum={row.momentum_pctl}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <WatchlistButton ticker={row.ticker} variant="icon" />
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-subtle hover:bg-surface-3 hover:text-ink"
              aria-label="Close"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Price strip */}
        <div className="flex items-center gap-6 border-b border-line px-5 py-3">
          <div>
            <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-subtle">
              Price
            </div>
            <div className="text-[1.05rem] font-bold tabular-nums text-ink">
              {fmtPrice(row.last_price)}
            </div>
            {row.last_price != null && row.prev_close != null && row.prev_close !== 0 && (
              <div
                className="text-[0.72rem] font-semibold tabular-nums"
                style={{ color: plColor(row.last_price - row.prev_close) }}
              >
                {row.last_price >= row.prev_close ? '▲' : '▼'}{' '}
                {(
                  Math.abs((row.last_price - row.prev_close) / row.prev_close) * 100
                ).toFixed(2)}
                %
              </div>
            )}
          </div>
          {header && (
            <div>
              <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-subtle">
                Scores as of
              </div>
              <div className="text-[0.88rem] font-semibold text-ink">
                {fmtDate(header.score_date)}
              </div>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isPending ? (
            <div className="space-y-3">
              {[80, 60, 75, 55].map((w, i) => (
                <div
                  key={i}
                  className="h-4 animate-pulse rounded bg-surface-3"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          ) : header ? (
            <ScoreWaterfall header={header} />
          ) : (
            <p className="text-[0.85rem] text-subtle">
              Could not load score detail.
            </p>
          )}
        </div>

        {/* Footer CTA */}
        <div className="border-t border-line px-5 py-4">
          <Link
            to={`/securities/${row.ticker}`}
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-solid px-4 py-3 text-[0.88rem] font-bold text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Open full deep-dive
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" />
            </svg>
          </Link>
        </div>
      </div>
    </>
  )
}
