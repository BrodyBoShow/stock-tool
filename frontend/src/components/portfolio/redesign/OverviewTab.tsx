import { DASH, fmtMoney, fmtPrice, fmtSignedMoney, fmtSignedPct } from '@/lib/format'
import type { PortfolioFlag, PortfolioHolding, PortfolioPerformance, PortfolioSummary } from '@/types/api'
import { type HealthScore as HealthScoreT, type RangeKey } from '../portfolioUi'
import { DisclaimerChip } from './DisclaimerChip'
import { DragsList, type DragItem } from './DragsList'
import { ExploreChips } from './ExploreChips'
import { HealthScore } from './HealthScore'
import { MetricChip } from './MetricChip'
import { PerfChart } from './PerfChart'
import { PortfolioHero } from './PortfolioHero'
import { sentimentFromNumber, type Sentiment } from './sentimentUtils'

export interface OverviewTabProps {
  view: { live: boolean; total_value: number; day_change: number | null; day_change_pct: number | null }
  summary: PortfolioSummary
  health: HealthScoreT | null
  holdings: PortfolioHolding[]
  flags: PortfolioFlag[]
  performance: PortfolioPerformance | null
  benchmark: string
  range: RangeKey
  onRangeChange: (r: RangeKey) => void
  onReview: (ticker: string) => void
  onExplore: (pane: 'risk' | 'holdings' | 'activity') => void
}

const DRAGS_ID = 'overview-drags'

/** Overview tab in the 3-zone pattern (spec IA). Zone A = hero + the one primary
 *  next-action; Zone B = the analytical core (single-axis chart + drags + metric
 *  strip); Zone C = cross-tab explore chips + the single disclaimer. */
export function OverviewTab({
  view,
  summary: s,
  health,
  holdings,
  performance,
  benchmark,
  range,
  onRangeChange,
  onReview,
  onExplore,
}: OverviewTabProps) {
  const drags: DragItem[] = holdings
    .filter((h) => h.ticker && (h.unrealized_pl ?? 0) < 0)
    .map((h) => ({
      ticker: h.ticker as string,
      name: h.name ?? (h.ticker as string),
      pctOfBook: h.weight ?? 0,
      lossPct: h.unrealized_pl_pct ?? 0,
      lossUsd: h.unrealized_pl ?? 0,
    }))
  const realizedPlusDivs =
    s.realized_pl != null && s.dividends_received != null
      ? s.realized_pl + s.dividends_received
      : null
  const sig = (n: number | null): Sentiment => (n == null ? 'neutral' : sentimentFromNumber(n))

  return (
    <div className="space-y-5">
      {/* ── Zone A · hero + portfolio health ────────────────────────────── */}
      <PortfolioHero
        value={view.total_value}
        dayChange={view.day_change ?? 0}
        dayChangePct={view.day_change_pct ?? 0}
        status="live"
      />
      {health && <HealthScore health={health} benchmark={benchmark} />}

      {/* ── Zone B · analytical core ────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {performance && (
          <PerfChart
            performance={performance}
            benchmark={benchmark}
            range={range}
            onRangeChange={onRangeChange}
          />
        )}
        <div id={DRAGS_ID}>
          <DragsList items={drags} onReview={onReview} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricChip
          label="Time-weighted"
          value={s.twr_total != null ? fmtSignedPct(s.twr_total) : DASH}
          sub={`${s.twr_cagr != null ? fmtSignedPct(s.twr_cagr) + '/yr' : ''} · ${benchmark} ${s.bench_total != null ? fmtSignedPct(s.bench_total) : DASH}`}
          sentiment={sig(s.twr_total)}
          gloss="Time-weighted return removes the effect of WHEN you added or withdrew cash — it isolates how your holdings performed, so it's comparable to an index."
        />
        <MetricChip
          label="Money-weighted"
          value={s.mwr != null ? fmtSignedPct(s.mwr) : DASH}
          sub="your dollars, your timing"
          sentiment={sig(s.mwr)}
          gloss="Money-weighted return (an internal rate of return) reflects the size and timing of your cash flows — the return on the actual dollars you had invested."
        />
        <MetricChip
          label="Realized + divs"
          value={realizedPlusDivs != null ? fmtSignedMoney(realizedPlusDivs) : DASH}
          sub={`${s.realized_pl != null ? fmtSignedMoney(s.realized_pl) + ' realized' : ''} · ${s.dividends_received != null ? fmtPrice(s.dividends_received) + ' divs' : ''}`}
          sentiment={sig(realizedPlusDivs)}
          gloss="Cash you've actually banked: profit or loss on shares you've SOLD, plus dividends received. Separate from paper (unrealized) gains."
        />
        <MetricChip
          label="Max drawdown"
          value={s.max_drawdown != null ? fmtSignedPct(s.max_drawdown) : DASH}
          sub={s.cost_basis != null ? `on a ${fmtMoney(s.cost_basis)} book` : undefined}
          sentiment={s.max_drawdown != null ? 'neg' : 'neutral'}
          gloss="The largest peak-to-trough drop your portfolio has taken — a gauge of how painful the worst stretch has been. Shown against your cost basis (what you paid for the shares you currently hold)."
        />
      </div>

      {/* ── Zone C · what to explore next + the one disclaimer ──────────── */}
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <ExploreChips
          chips={[
            { label: 'Open Risk & Fit', onClick: () => onExplore('risk') },
            { label: 'See Holdings', onClick: () => onExplore('holdings') },
            { label: 'Income & Activity', onClick: () => onExplore('activity') },
          ]}
        />
        <DisclaimerChip variant="footer" />
      </div>
    </div>
  )
}
