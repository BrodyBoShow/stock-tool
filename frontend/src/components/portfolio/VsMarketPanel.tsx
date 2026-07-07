import { useMemo } from 'react'
import type { PortfolioPerformance, PortfolioSummary } from '@/types/api'
import { plColor } from '@/lib/colors'
import { DASH, fmtPct, fmtRatio, fmtSignedPct } from '@/lib/format'
import { TABLE_HEAD_ROW } from '@/lib/constants'
import { bestWorstDay, computeBenchStats } from '@/components/portfolio/portfolioUi'
import { InfoTip } from '@/components/ui/InfoTip'
import { glossary } from '@/lib/glossary'

interface WhatIfSide {
  vol: number | null
  beta: number | null
  maxDD: number | null
}

export interface VsMarketPanelProps {
  summary: PortfolioSummary
  performance: PortfolioPerformance
  /** Current-weights vs after-fixes stats, BOTH from the same trailing-1Y
   *  matrix — mixing the full-history summary stats with 1Y what-if stats
   *  would attribute the window difference to the fixes. Null when no fixes. */
  whatIf: { before: WhatIfSide; after: WhatIfSide } | null
  /** open the Rebalance Simulator pre-filled with all suggested fixes */
  onApplyFixes: () => void
}

const GREEN = '#16a34a'

function fmtPp(delta: number): string {
  return `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)} pp`
}

function riskLabel(vol: number): string {
  if (vol < 0.15) return 'conservative'
  if (vol < 0.25) return 'moderate'
  if (vol < 0.4) return 'aggressive'
  return '"very aggressive" on the risk spectrum'
}

function spectrumLeft(vol: number): string {
  return `${Math.min(Math.max(vol / 0.6, 0.02), 0.98) * 100}%`
}

interface MarkerProps {
  left: string
  label: string
  value: string
  dotClass: string
  bold?: boolean
}

function Marker({ left, label, value, dotClass, bold }: MarkerProps) {
  return (
    <div className="absolute top-0 h-3 -translate-x-1/2" style={{ left }}>
      <div className={dotClass} />
      <div className="absolute top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-[0.62rem] leading-tight">
        <div className={bold ? 'font-bold text-slate-700' : 'font-medium text-slate-500'}>{label}</div>
        <div className="text-slate-400 tabular-nums">{value}</div>
      </div>
    </div>
  )
}

export function VsMarketPanel(props: VsMarketPanelProps): JSX.Element {
  const { summary, performance, whatIf, onApplyFixes } = props
  const bench = useMemo(() => computeBenchStats(performance.bench_curve), [performance.bench_curve])
  // Best/worst single DAY, derived from the growth curves (both sides identically).
  const pDay = useMemo(() => bestWorstDay(performance.twr_curve), [performance.twr_curve])
  const bDay = useMemo(() => bestWorstDay(performance.bench_curve), [performance.bench_curve])

  const benchmark = summary.benchmark
  const benchTotal = summary.bench_total

  const retDelta =
    summary.twr_total !== null && benchTotal !== null ? summary.twr_total - benchTotal : null
  const volRatio =
    summary.volatility !== null && bench.vol !== null && bench.vol > 0
      ? summary.volatility / bench.vol
      : null
  const ddDelta =
    summary.max_drawdown !== null && bench.maxDD !== null ? summary.max_drawdown - bench.maxDD : null
  const betaDelta = summary.beta !== null ? summary.beta - 1 : null
  const sharpeDelta =
    summary.sharpe !== null && bench.sharpe !== null ? summary.sharpe - bench.sharpe : null

  const numCell = 'py-1.5 pl-3 text-right tabular-nums'

  return (
    <div className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <h3 className="text-[0.82rem] font-semibold text-slate-800">Portfolio vs the market</h3>

      <table className="mt-3 w-full text-[0.78rem]">
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className="py-1.5 pr-3 font-semibold">Metric</th>
            <th className="py-1.5 pl-3 text-right font-semibold">You</th>
            <th className="py-1.5 pl-3 text-right font-semibold">{benchmark}</th>
            <th className="py-1.5 pl-3 text-right font-semibold">Delta</th>
          </tr>
        </thead>
        <tbody className="text-slate-700">
          <tr className="border-b border-[#f3f5f9]">
            <td className="py-1.5 pr-3 text-slate-500">Total return</td>
            <td className={`${numCell} font-semibold`}>{fmtSignedPct(summary.twr_total)}</td>
            <td className={numCell}>{fmtSignedPct(benchTotal)}</td>
            <td className={numCell}>
              {retDelta !== null ? (
                <span className="font-medium" style={{ color: plColor(retDelta) }}>
                  {fmtPp(retDelta)}
                </span>
              ) : (
                DASH
              )}
            </td>
          </tr>
          <tr className="border-b border-[#f3f5f9]">
            <td className="py-1.5 pr-3 text-slate-500">
              Volatility (annualized)
              <InfoTip text={glossary.Volatility} />
            </td>
            <td className={`${numCell} font-semibold`}>{fmtPct(summary.volatility)}</td>
            <td className={numCell}>{fmtPct(bench.vol)}</td>
            <td className={numCell}>
              {summary.volatility !== null && bench.vol !== null && volRatio !== null ? (
                <span className="text-slate-600">
                  {fmtPp(summary.volatility - bench.vol)} &middot; {volRatio.toFixed(1)}&times; {benchmark}
                </span>
              ) : (
                DASH
              )}
            </td>
          </tr>
          <tr className="border-b border-[#f3f5f9]">
            <td className="py-1.5 pr-3 text-slate-500">
              Worst drawdown
              <InfoTip text={glossary.Drawdown} />
            </td>
            <td className={`${numCell} font-semibold`}>{fmtSignedPct(summary.max_drawdown)}</td>
            <td className={numCell}>{fmtSignedPct(bench.maxDD)}</td>
            <td className={numCell}>
              {ddDelta !== null ? (
                <span className="font-medium" style={{ color: plColor(ddDelta) }}>
                  {fmtPp(ddDelta)}
                </span>
              ) : (
                DASH
              )}
            </td>
          </tr>
          <tr className="border-b border-[#f3f5f9]">
            <td className="py-1.5 pr-3 text-slate-500">
              Beta
              <InfoTip text={glossary.Beta} />
            </td>
            <td className={`${numCell} font-semibold`}>
              {summary.beta !== null ? `β ${fmtRatio(summary.beta)}` : DASH}
            </td>
            <td className={numCell}>&beta; 1.00</td>
            <td className={numCell}>
              {betaDelta !== null ? (
                <span className="text-slate-500">{`${betaDelta > 0 ? '+' : ''}${betaDelta.toFixed(2)}`}</span>
              ) : (
                DASH
              )}
            </td>
          </tr>
          <tr className="border-b border-[#f3f5f9]">
            <td className="py-1.5 pr-3 text-slate-500">
              Sharpe
              <InfoTip text={glossary.Sharpe} />
            </td>
            <td className={`${numCell} font-semibold`}>{fmtRatio(summary.sharpe)}</td>
            <td className={numCell}>{fmtRatio(bench.sharpe)}</td>
            <td className={numCell}>
              {sharpeDelta !== null ? (
                <span className="font-medium" style={{ color: plColor(sharpeDelta) }}>
                  {`${sharpeDelta > 0 ? '+' : ''}${sharpeDelta.toFixed(2)}`}
                </span>
              ) : (
                DASH
              )}
            </td>
          </tr>
          <tr className="border-b border-[#f3f5f9]">
            <td className="py-1.5 pr-3 text-slate-500">Best day</td>
            <td className={`${numCell} font-semibold`}>{fmtSignedPct(pDay.best)}</td>
            <td className={numCell}>{fmtSignedPct(bDay.best)}</td>
            <td className={numCell}>
              {pDay.best !== null && bDay.best !== null ? (
                <span className="text-slate-500">{fmtPp(pDay.best - bDay.best)}</span>
              ) : (
                DASH
              )}
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-3 text-slate-500">Worst day</td>
            <td className={`${numCell} font-semibold`}>{fmtSignedPct(pDay.worst)}</td>
            <td className={numCell}>{fmtSignedPct(bDay.worst)}</td>
            <td className={numCell}>
              {pDay.worst !== null && bDay.worst !== null ? (
                <span className="text-slate-500">{fmtPp(pDay.worst - bDay.worst)}</span>
              ) : (
                DASH
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {summary.volatility !== null && bench.vol !== null && volRatio !== null && (
        <p className="mt-2 text-[0.7rem] text-slate-400">
          Your portfolio swings ~{volRatio.toFixed(1)}&times; as much as {benchmark}
          {summary.beta !== null ? ` (β ${fmtRatio(summary.beta)})` : ''} &mdash;{' '}
          {riskLabel(summary.volatility)}
        </p>
      )}

      <div className="mt-5">
        <div className="text-[0.74rem] font-semibold text-slate-500">
          Risk spectrum &mdash; annualized volatility
          {whatIf && (
            <span className="font-normal">
              {' '}
              &middot; where you&apos;d land after the suggested fixes (both trailing-1Y)
            </span>
          )}
        </div>
        <div className="relative mt-3 h-3 rounded-full bg-gradient-to-r from-green-500 via-amber-400 to-red-600">
          <Marker
            left={spectrumLeft(0.05)}
            label="Bonds"
            value="5%"
            dotClass="h-2.5 w-2.5 translate-y-[1px] rounded-full border border-slate-400 bg-white"
          />
          <Marker
            left={spectrumLeft(0.1)}
            label="60/40"
            value="10%"
            dotClass="h-2.5 w-2.5 translate-y-[1px] rounded-full border border-slate-400 bg-white"
          />
          <Marker
            left={spectrumLeft(bench.vol ?? 0.17)}
            label={benchmark}
            value={fmtPct(bench.vol ?? 0.17)}
            dotClass="h-2.5 w-2.5 translate-y-[1px] rounded-full border border-slate-400 bg-white"
          />
          {/* the "You" dot uses the same 1Y window as "You (after)" when the
              preview is up — full-history vol next to a 1Y what-if would show a
              window artifact as if it were the fixes */}
          {(whatIf?.before.vol ?? summary.volatility) !== null && (
            <Marker
              left={spectrumLeft((whatIf?.before.vol ?? summary.volatility) as number)}
              label="You"
              value={fmtPct(whatIf?.before.vol ?? summary.volatility)}
              dotClass="h-3 w-3 rounded-full border-2 border-white bg-indigo-600 shadow"
              bold
            />
          )}
          {whatIf?.after.vol != null && (
            <Marker
              left={spectrumLeft(whatIf.after.vol)}
              label="You (after)"
              value={fmtPct(whatIf.after.vol)}
              dotClass="h-3 w-3 rounded-full border-2 border-green-600 bg-white shadow"
            />
          )}
        </div>
        <div className="h-11" />
      </div>

      {whatIf && (
        <div className="mt-2 text-[0.74rem] text-slate-500">
          If you applied the suggested fixes: vol {fmtPct(whatIf.before.vol)} &rarr;{' '}
          <span className="font-semibold" style={{ color: GREEN }}>
            {fmtPct(whatIf.after.vol)}
          </span>
          , &beta; {fmtRatio(whatIf.before.beta)} &rarr;{' '}
          <span className="font-semibold" style={{ color: GREEN }}>
            {fmtRatio(whatIf.after.beta)}
          </span>
          , max DD (1Y replay) {fmtSignedPct(whatIf.before.maxDD)} &rarr;{' '}
          <span className="font-semibold" style={{ color: GREEN }}>
            {fmtSignedPct(whatIf.after.maxDD)}
          </span>
          .{' '}
          <span className="text-slate-400">
            before AND after from your holdings&apos; trailing-1Y returns — an
            apples-to-apples estimate
          </span>
          <button
            type="button"
            onClick={onApplyFixes}
            className="ml-2 rounded bg-indigo-600 px-2.5 py-1 text-[0.7rem] font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            Preview in Rebalance Simulator &rarr;
          </button>
        </div>
      )}
    </div>
  )
}
