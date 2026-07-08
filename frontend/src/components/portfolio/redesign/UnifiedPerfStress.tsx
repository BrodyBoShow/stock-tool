import { type ComponentProps, useState } from 'react'

import type { PortfolioPerformance } from '@/types/api'
import { MonteCarloPanel } from '../MonteCarloPanel'
import { StressTestPanel } from '../StressTestPanel'
import type { RangeKey } from '../portfolioUi'
import { PerfChart } from './PerfChart'

type Stress = ComponentProps<typeof StressTestPanel>['stress']
type Weights = ComponentProps<typeof MonteCarloPanel>['suggestedWeights']
type Holdings = ComponentProps<typeof StressTestPanel>['holdings']

type Tab = 'performance' | 'stress' | 'projection'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'performance', label: 'Performance' },
  { id: 'stress', label: 'Stress test' },
  { id: 'projection', label: 'Projection · Monte Carlo' },
]

/** The unified Performance / Stress / Projection module (spec: one module, one
 *  vocabulary — replaces the 5 previously-scattered risk views). A single tablist
 *  over the reused, already-tested panels; the Performance tab uses the
 *  single-axis PerfChart (no dual-axis). */
export function UnifiedPerfStress({
  performance,
  stress,
  benchmark,
  holdings,
  suggestedWeights,
}: {
  performance: PortfolioPerformance | null
  stress: Stress
  benchmark: string
  holdings: Holdings
  suggestedWeights: Weights
}) {
  const [tab, setTab] = useState<Tab>('performance')
  const [range, setRange] = useState<RangeKey>('Max')

  return (
    <div className="rounded-[var(--r-lg)] border border-slate-200/70 bg-surface p-4 shadow-[var(--sh-sm)]">
      <div role="tablist" aria-label="Performance and risk views" className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-[36px] rounded-[var(--r-md)] px-3 text-[0.78rem] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] ${
              tab === t.id ? 'bg-slate-900 text-white' : 'text-muted hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'performance' &&
        (performance ? (
          <PerfChart
            performance={performance}
            benchmark={benchmark}
            range={range}
            onRangeChange={setRange}
          />
        ) : (
          <p className="py-8 text-center text-[0.8rem] text-muted">No performance history yet.</p>
        ))}
      {tab === 'stress' && (
        <StressTestPanel stress={stress} benchmark={benchmark} holdings={holdings} />
      )}
      {tab === 'projection' && (
        <MonteCarloPanel benchmark={benchmark} suggestedWeights={suggestedWeights} />
      )}
    </div>
  )
}
