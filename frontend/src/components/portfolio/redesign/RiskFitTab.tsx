import type { ComponentProps } from 'react'

import type { PortfolioHolding, PortfolioPerformance } from '@/types/api'
import { AlignedIdeasPanel } from '../risk/AlignedIdeasPanel'
import { RiskAlignmentPanel } from '../risk/RiskAlignmentPanel'
import { RiskProfileCard } from '../risk/RiskProfileCard'
import { DisclaimerChip } from './DisclaimerChip'
import { ExploreChips } from './ExploreChips'
import { NextActionCTA } from './NextActionCTA'
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
  const hasProfile = !!riskAlignment?.has_profile
  const above = (riskAlignment?.holdings ?? []).filter((h) => h.fit === 'above')
  const abovePct = riskAlignment?.portfolio?.above_band_weight_pct ?? 0
  const scrollFit = () =>
    document.getElementById(FIT_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const cta = !hasProfile
    ? {
        intent: 'primary' as const,
        message: 'Set your risk preference to see how each holding compares to it.',
        ctaLabel: 'Take the 60-second quiz',
        onCta: scrollFit,
      }
    : above.length > 0
      ? {
          intent: 'primary' as const,
          message: `${above.length} holding${above.length > 1 ? 's' : ''} (${above
            .slice(0, 2)
            .map((h) => h.ticker)
            .join(', ')}${above.length > 2 ? '…' : ''}) sit above your risk bands — together ${Math.round(abovePct * 100)}% of your book.`,
          ctaLabel: `See the ${above.length} above your bands`,
          onCta: scrollFit,
        }
      : {
          intent: 'primary' as const,
          message: 'Every holding sits inside your chosen risk bands.',
          ctaLabel: 'Review your fit',
          onCta: scrollFit,
        }

  return (
    <div className="space-y-5">
      {/* Zone A */}
      <RiskProfileCard />
      <NextActionCTA {...cta} />

      {/* Zone B */}
      <div id={FIT_ID}>{riskAlignment && <RiskAlignmentPanel data={riskAlignment} />}</div>
      <UnifiedPerfStress
        performance={performance}
        stress={stress}
        benchmark={benchmark}
        holdings={holdings}
        suggestedWeights={suggestedWeights}
      />
      {riskAlignment && <AlignedIdeasPanel data={riskAlignment} />}

      {/* Zone C */}
      <div className="flex flex-col gap-3 border-t border-slate-100 pt-4">
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
