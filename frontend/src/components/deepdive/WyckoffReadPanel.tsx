import { useMemo, useState } from 'react'

import { fmtSignedPct } from '@/lib/format'
import { buildEvidence, walkForwardGrade } from '@/lib/wyckoff'
import type { WyckoffAnalysis, WyckoffBacktest } from '@/lib/wyckoff'
import type { PricePoint } from '@/types/api'

import { Stat } from './priceChartParts'

/**
 * Wyckoff "read" — evidence-row narration (explain, don't predict) plus an
 * on-demand walk-forward signal grader (no look-ahead). Both client-side, free.
 */
export function WyckoffReadPanel({
  analysis,
  prices,
}: {
  analysis: WyckoffAnalysis
  prices: PricePoint[]
}) {
  const narration = useMemo(() => buildEvidence(analysis), [analysis])
  const [grade, setGrade] = useState<WyckoffBacktest | null>(null)
  const [grading, setGrading] = useState(false)

  // Reset the grade when the ticker/series changes (avoids showing stale stats).
  const seriesKey = prices.length ? `${prices[0]?.date}:${prices[prices.length - 1]?.date}:${prices.length}` : ''
  const [lastKey, setLastKey] = useState(seriesKey)
  if (lastKey !== seriesKey) {
    setLastKey(seriesKey)
    if (grade) setGrade(null)
  }

  const runGrade = () => {
    setGrading(true)
    // Defer the synchronous compute one tick so the button can show "Grading…".
    window.setTimeout(() => {
      try {
        setGrade(walkForwardGrade(prices))
      } finally {
        setGrading(false)
      }
    }, 20)
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {/* evidence rows */}
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-muted">
          Wyckoff read · evidence
        </div>
        {narration.rows.length === 0 ? (
          <p className="mt-2 text-[0.8rem] text-muted">{analysis.summary}</p>
        ) : (
          <table className="mt-2 w-full text-[0.78rem]">
            <tbody>
              {narration.rows.map((r, i) => (
                <tr key={i} className="border-b border-[#eef1f6] last:border-0">
                  <td className="whitespace-nowrap py-1 pr-3 align-top font-semibold text-ink">{r.term}</td>
                  <td className="py-1 pr-3 align-top text-muted">{r.meaning}</td>
                  <td className="whitespace-nowrap py-1 text-right align-top font-medium tabular-nums text-ink">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[0.7rem] text-subtle">{narration.caveat}</p>
        <p className="mt-1 text-[0.72rem] text-muted">
          <span className="font-semibold">Watch:</span> {narration.watch}
        </p>
      </div>

      {/* walk-forward grader */}
      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[0.72rem] font-bold uppercase tracking-[0.06em] text-muted">
            Signal track record · walk-forward
          </div>
          <button
            type="button"
            onClick={runGrade}
            disabled={grading}
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[0.72rem] font-semibold text-accent transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            {grading ? 'Grading…' : grade ? 'Re-run' : 'Grade signals'}
          </button>
        </div>
        {!grade ? (
          <p className="mt-2 text-[0.78rem] text-muted">
            Replays each bar using only prior data, fires the Wyckoff signals point-in-time, then
            grades them on what happened next — no look-ahead. This name only, small sample.
          </p>
        ) : grade.overall.signals === 0 ? (
          <p className="mt-2 text-[0.78rem] text-muted">
            No gradeable signals fired across this history.
          </p>
        ) : (
          <div className="mt-2">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Signals" value={String(grade.overall.signals)} />
              <Stat
                label="Fwd hit rate"
                value={`${Math.round(grade.overall.fwdRate * 100)}%`}
                sub={`≥${Math.round(grade.threshold * 100)}% in ${grade.forwardDays}d`}
              />
              <Stat label="Avg fwd return" value={fmtSignedPct(grade.overall.avgFwdReturn)} />
            </div>
            <div className="mt-2 text-[0.72rem] text-muted">
              Target-before-stop:{' '}
              {grade.overall.tbsResolved
                ? `${Math.round(grade.overall.tbsRate * 100)}% of ${grade.overall.tbsResolved} resolved`
                : 'none resolved'}
            </div>
            <table className="mt-2 w-full text-[0.74rem]">
              <thead>
                <tr className="text-left text-[0.6rem] uppercase tracking-wide text-subtle">
                  <th className="py-1">Signal</th>
                  <th className="py-1">N</th>
                  <th className="py-1">Hit</th>
                  <th className="py-1">Avg</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(grade.byType).map(([t, s]) => (
                  <tr key={t} className="border-t border-divider">
                    <td className="py-1 font-semibold text-ink">{t}</td>
                    <td className="py-1 tabular-nums">{s.signals}</td>
                    <td className="py-1 tabular-nums">{Math.round(s.fwdRate * 100)}%</td>
                    <td className="py-1 tabular-nums">{fmtSignedPct(s.avgFwdReturn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[0.68rem] text-subtle">
              Walk-forward, no look-ahead · one ticker, small sample — directional, not proof.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
