import { useQuery } from '@tanstack/react-query'

import { Sparkline } from '@/components/screener/Sparkline'
import { getBriefStatus } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { DASH, fmtDate, fmtMoney, fmtPrice, fmtSignedPct } from '@/lib/format'
import type {
  FilingRow,
  FundamentalPoint,
  PricePoint,
  SecurityHeader,
} from '@/types/api'
import type { PaneId } from '@/pages/DeepDivePage'

export interface OverviewPaneProps {
  header: SecurityHeader
  prices: PricePoint[]
  fundamentals: FundamentalPoint[]
  filings: FilingRow[]
  onNavigate: (pane: PaneId) => void
}

/** Chip colors per SEC form family. */
function formChipClass(form: string): string {
  if (form === '8-K') return 'bg-amber-100 text-amber-800'
  if (form === '10-K' || form === '10-Q') return 'bg-blue-100 text-blue-700'
  return 'bg-slate-100 text-slate-500'
}

/** Latest value for a fundamental metric (row with max as_of_date). */
function latestMetric(rows: FundamentalPoint[], metric: string): number | null {
  let bestDate = ''
  let bestValue: number | null = null
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.metric !== metric || r.value == null) continue
    if (r.as_of_date >= bestDate) {
      bestDate = r.as_of_date
      bestValue = r.value
    }
  }
  return bestValue
}

/** First ~maxLen chars of the brief text, cut at a word boundary. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLen).trimEnd()}…`
}

const FACTOR_COLORS: Record<string, string> = {
  Growth: '#3b82f6',
  Value: '#10b981',
  Quality: '#8b5cf6',
  Momentum: '#f59e0b',
}

interface FactorPillProps {
  label: string
  value: number | null
  onClick: () => void
}

function FactorPill({ label, value, onClick }: FactorPillProps) {
  const color = FACTOR_COLORS[label] ?? '#6366f1'
  const width = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-indigo-400"
    >
      <div className="flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.06em] text-slate-400">
        <span
          aria-hidden
          className="h-2 w-2 flex-none rounded-[3px]"
          style={{ backgroundColor: color }}
        />
        {label}
      </div>
      <div className="mt-0.5 text-[1.15rem] font-bold tabular-nums text-gray-900">
        {value == null ? DASH : value.toFixed(0)}
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
    </button>
  )
}

/**
 * Overview pane (spec §5.6) — the executive summary of the deep-dive: a
 * one-viewport "trailer" for the other panes. Brief teaser (shared react-query
 * cache with DecisionBriefPanel, read-only), factor pills, recent filings,
 * 6-month price trend, and key fundamentals — each linking to its full pane.
 */
export function OverviewPane({
  header,
  prices,
  fundamentals,
  filings,
  onNavigate,
}: OverviewPaneProps): JSX.Element {
  // Same queryKey + queryFn as DecisionBriefPanel so the cache is shared.
  // Note the GET itself kicks off background generation when no brief is
  // cached; this pane doesn't poll — the Brief pane owns that lifecycle.
  const { data: briefStatus } = useQuery({
    queryKey: ['brief', header.ticker],
    queryFn: () => getBriefStatus(header.ticker),
    staleTime: 10 * 60 * 1000,
  })
  const brief = briefStatus?.brief?.brief ?? null
  const teaser = brief
    ? truncate(
        brief.score_read
          ? `${brief.one_liner} ${brief.score_read.drivers}`
          : brief.one_liner,
        220,
      )
    : null

  // Last ~126 sessions' closes (adj_close ?? close), nulls skipped. The
  // fetched range follows the Chart pane's day selector, so the card labels
  // the window it actually shows rather than assuming 6 months.
  const closes: number[] = []
  const windowStart = Math.max(0, prices.length - 126)
  for (let i = windowStart; i < prices.length; i++) {
    const v = prices[i].adj_close ?? prices[i].close
    if (v != null && Number.isFinite(v)) closes.push(v)
  }
  const windowFrom = prices.length > 0 ? prices[windowStart].date : null
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : null
  const windowChange =
    closes.length >= 2 && closes[0] !== 0
      ? (closes[closes.length - 1] - closes[0]) / closes[0]
      : null

  const recentFilings = [...filings]
    .sort((a, b) => (a.filed_date < b.filed_date ? 1 : -1))
    .slice(0, 3)

  const fundamentalCells: Array<[string, string]> = [
    ['Revenue TTM', fmtMoney(latestMetric(fundamentals, 'ttm_revenue'))],
    ['FCF', fmtMoney(latestMetric(fundamentals, 'fcf'))],
    [
      'EPS TTM',
      (() => {
        const v = latestMetric(fundamentals, 'ttm_eps')
        return v == null ? DASH : `$${v.toFixed(2)}`
      })(),
    ],
    [
      // Flag the ROA stand-in like every other surface does.
      header.details?.flags?.roic_pool === 'roa_proxy' ? 'ROIC (ROA proxy)' : 'ROIC',
      (() => {
        const v = latestMetric(fundamentals, 'roic')
        return v == null ? DASH : `${(v * 100).toFixed(1)}%`
      })(),
    ],
  ]

  const factorPills: Array<[string, number | null]> = [
    ['Growth', header.growth_pctl],
    ['Value', header.value_pctl],
    ['Quality', header.quality_pctl],
    ['Momentum', header.momentum_pctl],
  ]

  const compositeWidth =
    header.composite == null
      ? 0
      : Math.max(0, Math.min(100, header.composite))

  return (
    <div className="space-y-4">
      {/* 1. Brief teaser */}
      <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-slate-400">
            Decision brief
          </div>
          <span
            title="Synthesized by the LLM from StockBud's own factor data — verify against the Data panes"
            className="cursor-help rounded bg-slate-100 px-1.5 text-[0.6rem] font-semibold text-slate-500"
          >
            AI-generated
          </span>
        </div>
        {teaser ? (
          <p className="mt-2 text-[0.85rem] leading-relaxed text-slate-700">
            {teaser}
          </p>
        ) : (
          <p className="mt-2 text-[0.85rem] text-gray-400">
            {briefStatus?.generating
              ? 'A brief is being prepared — open the Brief pane to watch it arrive.'
              : 'No brief generated yet — open the Brief pane to create one.'}
          </p>
        )}
        <button
          type="button"
          onClick={() => onNavigate('brief')}
          className="mt-3 text-[0.74rem] font-semibold text-indigo-600 hover:text-indigo-800"
        >
          Read the full brief →
        </button>
      </section>

      {/* 2. Factor pills */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <button
          type="button"
          onClick={() => onNavigate('factors')}
          className="rounded-lg border border-indigo-700 bg-indigo-700 p-3 text-left transition-colors hover:border-indigo-400"
        >
          <div className="text-[0.6rem] font-semibold uppercase tracking-[0.06em] text-indigo-200">
            Composite
          </div>
          <div className="mt-0.5 text-[1.15rem] font-bold tabular-nums text-white">
            {header.composite == null ? DASH : header.composite.toFixed(1)}
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-indigo-900/50">
            <div
              className="h-full rounded-full bg-indigo-300"
              style={{ width: `${compositeWidth}%` }}
            />
          </div>
        </button>
        {factorPills.map(([label, value]) => (
          <FactorPill
            key={label}
            label={label}
            value={value}
            onClick={() => onNavigate('factors')}
          />
        ))}
      </div>

      {/* 3. Latest activity + price trend */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
          <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-slate-400">
            Latest activity
          </div>
          {recentFilings.length === 0 ? (
            <p className="mt-2 text-[0.85rem] text-gray-400">
              No filings on file.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {recentFilings.map((fl) => (
                <li
                  key={fl.accession_no}
                  className="flex items-center gap-2 text-[0.8rem]"
                >
                  <span
                    className={`flex-none rounded px-1.5 py-0.5 text-[0.6rem] font-bold ${formChipClass(fl.form)}`}
                  >
                    {fl.form}
                  </span>
                  <span className="flex-none text-[0.72rem] tabular-nums text-slate-400">
                    {fmtDate(fl.filed_date)}
                  </span>
                  <span className="truncate text-slate-700">
                    {fl.label ?? fl.form}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => onNavigate('filings')}
            className="mt-3 text-[0.74rem] font-semibold text-indigo-600 hover:text-indigo-800"
          >
            All filings →
          </button>
        </section>

        <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-slate-400">
              {windowFrom ? `Price since ${fmtDate(windowFrom)}` : 'Price trend'}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[1.05rem] font-bold tabular-nums text-gray-900">
                {fmtPrice(lastClose)}
              </span>
              <span
                className="text-[0.78rem] font-semibold tabular-nums"
                style={{ color: plColor(windowChange) }}
              >
                {fmtSignedPct(windowChange)}
              </span>
            </div>
          </div>
          <div className="mt-2">
            <Sparkline
              data={closes.length >= 2 ? closes : null}
              fluid
              height={56}
              title={
                windowFrom
                  ? `Adjusted close since ${fmtDate(windowFrom)}`
                  : 'Adjusted close'
              }
            />
          </div>
          <button
            type="button"
            onClick={() => onNavigate('chart')}
            className="mt-3 text-[0.74rem] font-semibold text-indigo-600 hover:text-indigo-800"
          >
            Open the chart →
          </button>
        </section>
      </div>

      {/* 4. Key fundamentals */}
      <section>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {fundamentalCells.map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="text-[0.6rem] font-semibold uppercase tracking-[0.06em] text-slate-400">
                {label}
              </div>
              <div className="mt-0.5 text-[0.95rem] font-bold tabular-nums text-gray-900">
                {value}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onNavigate('financials')}
          className="mt-2 text-[0.74rem] font-semibold text-indigo-600 hover:text-indigo-800"
        >
          Financials →
        </button>
      </section>
    </div>
  )
}
