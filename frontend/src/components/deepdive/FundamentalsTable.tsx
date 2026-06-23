import { useMemo } from 'react'

import { heatBg } from '@/lib/colors'
import {
  FINANCIAL_NULL_METRICS,
  FINANCIAL_SECTORS,
  HIGHER_IS_BETTER,
  METRIC_DISPLAY_ORDER,
  METRIC_LABELS,
} from '@/lib/constants'
import { DASH, fmtDate, fmtMetric } from '@/lib/format'
import type { FundamentalPoint } from '@/types/api'

export function FundamentalsTable({
  fundamentals,
  sector,
  ticker,
  roicIsProxy,
}: {
  fundamentals: FundamentalPoint[]
  sector: string | null
  ticker: string
  roicIsProxy: boolean
}) {
  const isFinancial = sector !== null && FINANCIAL_SECTORS.has(sector)

  // Pivot the flat rows: 8 most recent as_of_dates as columns (newest left).
  const { dates, byMetric } = useMemo(() => {
    const allDates = [...new Set(fundamentals.map((f) => f.as_of_date))]
      .sort()
      .reverse()
      .slice(0, 8)
    const dateSet = new Set(allDates)
    const m = new Map<string, Map<string, number | null>>()
    for (const f of fundamentals) {
      if (!dateSet.has(f.as_of_date)) continue
      let row = m.get(f.metric)
      if (!row) {
        row = new Map()
        m.set(f.metric, row)
      }
      row.set(f.as_of_date, f.value)
    }
    return { dates: allDates, byMetric: m }
  }, [fundamentals])

  // per-metric min/max over the shown periods, for the heatmap shading
  const ranges = useMemo(() => {
    const r = new Map<string, { min: number; max: number }>()
    for (const [metric, row] of byMetric) {
      const vals = [...row.values()].filter((x): x is number => x !== null)
      if (vals.length >= 2) {
        r.set(metric, { min: Math.min(...vals), max: Math.max(...vals) })
      }
    }
    return r
  }, [byMetric])

  const showFinancialNa =
    isFinancial &&
    METRIC_DISPLAY_ORDER.some(
      (metric) =>
        byMetric.has(metric) &&
        FINANCIAL_NULL_METRICS.has(metric) &&
        dates.some((d) => (byMetric.get(metric)?.get(d) ?? null) === null),
    )

  if (fundamentals.length === 0) {
    return (
      <div className="rounded-card border border-blue-200 bg-blue-50 p-5 shadow-card">
        <div className="text-sm font-bold text-blue-700">
          No fundamental data available for {ticker}
        </div>
        <p className="mt-1 text-[0.82rem] text-blue-800">
          This security has no XBRL filings yet (likely a recent spinoff or IPO).
          Metrics will populate automatically once filings are ingested by the
          weekly pipeline.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="text-base font-bold text-gray-900">
        Fundamental metrics — point-in-time history
      </div>
      <div className="mt-0.5 text-[0.78rem] text-gray-500">
        Values as known at each filing date (point-in-time correct — restatements
        apply forward only, never backward). TTM = trailing twelve months. Showing
        the eight most recent filing dates.
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="whitespace-nowrap px-3 py-2 text-left text-[0.68rem] font-bold uppercase tracking-[0.06em] text-gray-500">
                Metric
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  className="whitespace-nowrap px-3 py-2 text-right text-[0.68rem] font-bold uppercase tracking-[0.06em] text-gray-500"
                >
                  {fmtDate(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRIC_DISPLAY_ORDER.filter((metric) => byMetric.has(metric)).map(
              (metric) => (
                <tr key={metric} className="border-b border-gray-100">
                  <td className="whitespace-nowrap px-3 py-2 text-[0.82rem] font-semibold text-gray-700">
                    {METRIC_LABELS[metric] ?? metric}
                  </td>
                  {dates.map((d) => {
                    const v = byMetric.get(metric)?.get(d) ?? null
                    let cell: string
                    if (
                      v === null &&
                      isFinancial &&
                      FINANCIAL_NULL_METRICS.has(metric)
                    ) {
                      cell = 'n/a*'
                    } else if (v === null) {
                      cell = DASH
                    } else {
                      cell = fmtMetric(metric, v, metric === 'roic' && roicIsProxy)
                    }
                    const range = ranges.get(metric)
                    const tint =
                      v !== null && range
                        ? heatBg(v, range.min, range.max, HIGHER_IS_BETTER[metric] ?? true)
                        : undefined
                    return (
                      <td
                        key={d}
                        className="whitespace-nowrap px-3 py-2 text-right text-[0.82rem] text-gray-900 tabular-nums"
                        style={tint ? { background: tint } : undefined}
                      >
                        {cell}
                      </td>
                    )
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.68rem] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgba(16,185,129,0.5)' }} />
          stronger
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgba(239,68,68,0.45)' }} />
          weaker
        </span>
        <span className="text-gray-400">
          — each cell shaded against that metric’s own range over these periods
          (green = the better direction for the metric); a quick read of each
          metric’s trajectory, not a cross-company score.
        </span>
      </div>

      <div className="mt-3 space-y-1 text-[0.72rem] text-gray-400">
        {showFinancialNa && (
          <p>
            * Not meaningful for banks / insurers / REITs — these metrics assume a
            non-financial operating model.
          </p>
        )}
        {roicIsProxy && (
          <p>* ROIC value is ROA (net income ÷ total assets); see scores note.</p>
        )}
      </div>
    </div>
  )
}
