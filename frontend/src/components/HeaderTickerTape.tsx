import { useQuery } from '@tanstack/react-query'

import { getTickerTape } from '@/lib/api'
import type { TickerTapeItem } from '@/types/api'

/** Ambient market strip under the top nav (spec row 2). A pure-CSS marquee of
 *  index / rate / commodity / FX / crypto proxies, refreshed on the screener's
 *  ~90s cadence. Delayed ~15m and display-only — labeled as such. The scroll +
 *  pulse both stop under prefers-reduced-motion (keyframes in index.css). */

function fmtTapePrice(symbol: string, p: number): string {
  if (symbol.endsWith('-USD')) return '$' + Math.round(p).toLocaleString('en-US') // crypto
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return p.toFixed(2)
}

function TapeItem({ it }: { it: TickerTapeItem }) {
  const up = (it.change_pct ?? 0) >= 0
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-4 text-[0.72rem]">
      <span className="font-bold text-muted">{it.label}</span>
      {it.price != null && (
        <span className="numeric font-semibold text-ink">{fmtTapePrice(it.symbol, it.price)}</span>
      )}
      {it.change_pct != null && (
        <span className={`numeric font-semibold ${up ? 'text-pos' : 'text-neg'}`}>
          {up ? '▲' : '▼'} {Math.abs(it.change_pct).toFixed(2)}%
        </span>
      )}
    </span>
  )
}

export function HeaderTickerTape() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ticker-tape'],
    queryFn: getTickerTape,
    staleTime: 60 * 1000,
    refetchInterval: 90 * 1000,
    refetchOnWindowFocus: true,
  })
  const items = data?.items ?? []
  const doubled = [...items, ...items] // duplicate for a seamless loop

  // The row is ALWAYS rendered (it fills the header's second line); its contents
  // depend on the fetch. Empty state stays quiet — a short status, not a gap.
  return (
    <div className="relative flex h-7 items-center overflow-hidden border-b border-[var(--border)] bg-[var(--surface-2)]">
      {items.length === 0 ? (
        <span className="px-4 text-[0.66rem] font-medium text-subtle">
          {isLoading
            ? 'Loading market data…'
            : isError
              ? 'Market data unavailable'
              : 'Markets quiet'}
        </span>
      ) : (
        <>
          <div className="group min-w-0 flex-1 overflow-hidden" aria-hidden="true">
            <div
              className="tk-row tk-l group-hover:[animation-play-state:paused]"
              style={{ animationDuration: '90s' }}
            >
              {doubled.map((it, i) => (
                <span key={`${it.symbol}-${i}`} className="flex items-center">
                  <TapeItem it={it} />
                  <span className="h-3 w-px bg-[var(--divider)]" />
                </span>
              ))}
            </div>
          </div>
          {/* Live-ish marker on a fade — honest about the ~15m delay. */}
          <div
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1.5 pl-10 pr-4 text-[0.58rem] font-bold uppercase tracking-[0.06em] text-subtle"
            style={{ background: 'linear-gradient(to left, var(--surface-2) 62%, transparent)' }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-pos motion-safe:animate-[ckpulse_2.4s_ease-in-out_infinite]" />
            Delayed ~15m
          </div>
        </>
      )}
    </div>
  )
}
