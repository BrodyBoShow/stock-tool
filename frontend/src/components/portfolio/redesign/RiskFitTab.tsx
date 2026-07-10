import type { ComponentProps } from 'react'

import type { PortfolioHolding, PortfolioPerformance } from '@/types/api'
import { AlignedIdeasPanel } from '../risk/AlignedIdeasPanel'
import { RiskAlignmentPanel } from '../risk/RiskAlignmentPanel'
import { RiskProfileCard } from '../risk/RiskProfileCard'
import { DisclaimerChip } from './DisclaimerChip'
import { ExploreChips } from './ExploreChips'
import { UnifiedPerfStress } from './UnifiedPerfStress'

type RiskAlignment = ComponentProps<typeof RiskAlignmentPanel>['data']
type Stress = ComponentProps<typeof UnifiedPerfStress>['stress']
type Weights = ComponentProps<typeof UnifiedPerfStress>['suggestedWeights']

export interface RiskFitTabProps {
  riskAlignment: RiskAlignment | undefined
  performance: PortfolioPerformance | null
  stress: Stress
  suggestedWeights: Weights
  holdings: PortfolioHolding[]
  benchmark: string
  onExplore: (pane: 'overview' | 'holdings' | 'activity') => void
}

const FIT_ID = 'risk-fit-table'

/** Risk & Fit tab (3-zone). Zone A = the stated risk preference + the one
 *  next-action (the holdings sitting above the user's bands). Zone B = the
 *  risk-fit table + spectrum, then the unified Performance/Stress/Projection
 *  module (one vocabulary). Zone C = cross-tab chips + the single disclaimer. */
export function RiskFitTab({
  riskAlignment,
  performance,
  stress,
  suggestedWeights,
  holdings,
  benchmark,
  onExplore,
}: RiskFitTabProps) {
  return (
    <div className="space-y-5">
      {/* Zone A */}
      <div id="risk-profile-setup">
        <RiskProfileCard />
      </div>

      {/* Zone B */}
      <div id={FIT_ID}>{riskAlignment && <RiskAlignmentPanel data={riskAlignment} />}</div>
      <UnifiedPerfStress
        performance={performance}
        stress={stress}
        benchmark={benchmark}
        holdings={holdings}
        suggestedWeights={suggestedWeights}
      />
      {riskAlignment && <AlignedIdeasPanel data={riskAlignment} benchmark={benchmark} />}

      {/* Zone C */}
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <ExploreChips
          chips={[
            { label: 'See Holdings', onClick: () => onExplore('holdings') },
            { label: 'Overview', onClick: () => onExplore('overview') },
            { label: 'Income & Activity', onClick: () => onExplore('activity') },
          ]}
        />
        <DisclaimerChip variant="footer" />
      </div>
    </div>
  )
}
