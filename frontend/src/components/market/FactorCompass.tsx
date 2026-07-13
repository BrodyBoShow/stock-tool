import { InfoTip } from '@/components/ui/InfoTip'
import { fmtSignedPct } from '@/lib/format'
import type { MarketFactorDay } from '@/types/api'

import { FACTOR_LABEL, heat } from './utils'

// The three horizons, in scan order. Each spread lives on a different field of
// MarketFactorDay; `scale` sets the tint saturation ceiling for that horizon
// (longer windows swing wider, so they need a looser scale to stay legible).
const HORIZONS: { key: 'spread' | 'spread_1w' | 'spread_1m'; label: string; scale: number }[] = [
  { key: 'spread', label: '1D', scale: 0.03 },
  { key: 'spread_1w', label: '1W', scale: 0.06 },
  { key: 'spread_1m', label: '1M', scale: 0.1 },
]

/** Read a horizon's spread off a factor row; `spread` is always present, the
 *  wider windows are optional and may be null. */
function spreadOf(f: MarketFactorDay, key: 'spread' | 'spread_1w' | 'spread_1m'): number | null {
  if (key === 'spread') return f.spread
  return f[key] ?? null
}

/** One honest, data-derived insight line comparing the 1D leader to the month.
 *  Descriptive, never predictive — leadership persistence vs possible rotation. */
function insight(rows: MarketFactorDay[]): string | null {
  const withMonth = rows.filter((r) => spreadOf(r, 'spread_1m') != null)
  if (withMonth.length < 2) return null // not enough month data to compare honestly

  const dayLeader = rows[0] // already sorted by 1D spread desc
  const byMonth = [...withMonth].sort(
    (a, b) => (spreadOf(b, 'spread_1m') ?? 0) - (spreadOf(a, 'spread_1m') ?? 0),
  )
  const monthLeader = byMonth[0]
  const monthLaggard = byMonth[byMonth.length - 1]
  const leaderLabel = FACTOR_LABEL[dayLeader.factor] ?? dayLeader.factor

  if (dayLeader.factor === monthLeader.factor) {
    return `${leaderLabel} leads today and over the month — persistent leadership.`
  }
  if (dayLeader.factor === monthLaggard.factor) {
    return `${leaderLabel} leads today but lags over the month — possible rotation.`
  }
  return `${leaderLabel} leads today; ${FACTOR_LABEL[monthLeader.factor] ?? monthLeader.factor} leads over the month.`
}

/**
 * Factor rotation compass — a factor × horizon heat grid (deliberately NOT a
 * radar: factor spreads are signed and a polar plot renders negatives
 * dishonestly). Rows are the four styles sorted by today's spread; columns are
 * three lookback horizons. Each cell tints green/red by the sign and magnitude
 * of the top-quintile-minus-bottom-quintile return over that horizon.
 */
export function FactorCompass({ factors }: { factors: MarketFactorDay[] }) {
  if (!factors.length) return null
  const rows = [...factors].sort((a, b) => b.spread - a.spread)
  const line = insight(rows)

  return (
    <div>
      <div className="mb-2 flex items-center text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-subtle">
        Style leadership by horizon
        <InfoTip text="Each style's top-quintile-minus-bottom-quintile return at three lookbacks (1 day / 1 week / 1 month). Positive = that style is outperforming; a sign flip across horizons hints at rotation. Descriptive, not predictive." />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[0.82rem]">
          <thead>
            <tr>
              <th className="py-1.5 pr-3 text-left text-[0.66rem] font-semibold uppercase tracking-[0.07em] text-subtle">
                Factor
              </th>
              {HORIZONS.map((h) => (
                <th
                  key={h.key}
                  className="px-2 py-1.5 text-right text-[0.66rem] font-semibold uppercase tracking-[0.07em] text-subtle"
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.factor} className="border-t border-divider">
                <td className="py-2 pr-3 font-semibold text-muted">{FACTOR_LABEL[f.factor] ?? f.factor}</td>
                {HORIZONS.map((h) => {
                  const v = spreadOf(f, h.key)
                  return (
                    <td
                      key={h.key}
                      className="rounded-sm px-2 py-2 text-right font-bold tabular-nums"
                      style={v == null ? { color: 'var(--subtle)' } : heat(v, h.scale)}
                    >
                      {v == null ? '—' : fmtSignedPct(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {line && <p className="mt-2.5 text-[0.78rem] leading-snug text-muted">{line}</p>}
      <p className="mt-1 text-[0.72rem] text-subtle">
        Top fifth minus bottom fifth by return, at three horizons — which styles are leading, not a forecast.
      </p>
    </div>
  )
}
