import { scoreHeat } from '@/lib/colors'

/**
 * Bracketed monospace factor stamp — a signature StockBud element that
 * compresses the four factor percentiles into one scannable terminal line:
 *
 *   [ G 78 · V 42 · Q 91 · M 73 ]
 *
 * Letter codes + brackets are subtle; each number is heat-colored by its own
 * percentile (green strong → red weak, same ramp as the score cells). No other
 * screener ships this, and it only works because the whole app commits to a
 * tabular mono for numbers — which makes it hard to fake without adopting the
 * type system. Purely presentational; every number is a real percentile.
 *
 * scoreHeat() returns CSS-var token strings, so the color is theme-aware and
 * safe in an HTML `style` (never fed to an SVG presentation attribute).
 */
export function FactorStamp({
  growth,
  value,
  quality,
  momentum,
  composite,
  className,
}: {
  growth: number | null
  value: number | null
  quality: number | null
  momentum: number | null
  /** Optional leading composite (C) — omit on surfaces that show it elsewhere. */
  composite?: number | null
  className?: string
}) {
  const parts: Array<[string, number | null]> = [
    ['G', growth],
    ['V', value],
    ['Q', quality],
    ['M', momentum],
  ]
  if (composite != null) parts.unshift(['C', composite])

  const srText = parts
    .map(([k, v]) => `${k} ${v == null ? 'not available' : Math.round(v)}`)
    .join(', ')

  return (
    <span
      className={`inline-flex items-center font-mono text-[0.75rem] tabular-nums leading-none text-subtle ${className ?? ''}`}
      title="Factor percentiles vs the US-listed universe — Composite / Growth / Value / Quality / Momentum (100 = top)"
      aria-label={`Factor percentiles: ${srText}`}
    >
      <span aria-hidden="true" className="opacity-70">
        [
      </span>
      {parts.map(([code, v], i) => (
        <span key={code} aria-hidden="true" className="inline-flex items-center">
          {i > 0 && <span className="px-[4px] opacity-50">·</span>}
          <span className="opacity-80">{code}</span>
          <span
            className="ml-[3px] font-semibold"
            style={{ color: v == null ? 'var(--subtle)' : scoreHeat(v).bar }}
          >
            {v == null ? '—' : Math.round(v)}
          </span>
        </span>
      ))}
      <span aria-hidden="true" className="opacity-70">
        ]
      </span>
    </span>
  )
}
