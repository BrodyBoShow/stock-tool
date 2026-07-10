import type { ComponentProps } from 'react'

import { DASH, fmtPrice, fmtSignedMoney } from '@/lib/format'
import type { PortfolioFlag, PortfolioHolding, PortfolioSummary } from '@/types/api'
import { HoldingsDiagnostic } from '../HoldingsDiagnostic'
import { DisclaimerChip } from './DisclaimerChip'
import { ExploreChips } from './ExploreChips'
import { MetricChip } from './MetricChip'
import { sentimentFromNumber } from './sentimentUtils'

type Quotes = ComponentProps<typeof HoldingsDiagnostic>['quotes']
type Analytics = ComponentProps<typeof HoldingsDiagnostic>['analytics']

export interface HoldingsTabProps {
  summary: PortfolioSummary
  holdings: PortfolioHolding[]
  quotes: Quotes
  analytics: Analytics
  flags: PortfolioFlag[]
  // string | null to match HoldingsDiagnostic.onOpenSimulator (null = the whole
  // book / suggested set); the concentration CTA always passes a concrete ticker.
  onReview: (ticker: string | null) => void
  onExplore: (pane: 'overview' | 'risk' | 'activity') => void
}

const TABLE_ID = 'holdings-table'

/** Holdings tab (3-zone). Zone A = a 4-metric strip (net liquidation, unrealized
 *  P/L, top-name concentration, alerts), each with a gloss, plus the one
 *  concentration next-action. Zone B = the full grouped holdings table (reused).
 *  Zone C = cross-tab chips + the single disclaimer. */
export function HoldingsTab({
  summary: s,
  holdings,
  quotes,
  analytics,
  flags,
  onReview,
  onExplore,
}: HoldingsTabProps) {
  const nSectors = new Set(holdings.map((h) => h.sector).filter(Boolean)).size
  let topW = 0
  let topTicker = ''
  for (const h of holdings) {
    const w = h.weight ?? 0
    if (w > topW) {
      topW = w
      topTicker = h.ticker ?? ''
    }
  }
  return (
    <div className="space-y-5">
      {/* Zone A */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricChip
          label="Net liquidation"
          value={fmtPrice(s.total_value)}
          sub={`${holdings.length} positions · ${nSectors} sectors`}
          gloss="The current market value of every position you hold, using the latest price for each — your book's total worth right now."
        />
        <MetricChip
          label="Unrealized P/L"
          value={s.unrealized_pl != null ? fmtSignedMoney(s.unrealized_pl) : DASH}
          sub={`cost basis ${fmtPrice(s.cost_basis)}`}
          sentiment={s.unrealized_pl != null ? sentimentFromNumber(s.unrealized_pl) : 'neutral'}
          gloss="Paper profit or loss on the shares you still hold: current value minus what you paid. It's only realized when you sell."
        />
        <MetricChip
          label="Concentration"
          value={topTicker ? `${topTicker} ${Math.round(topW * 100)}%` : DASH}
          sub={topW > 0.2 ? 'above 20% threshold' : 'within threshold'}
          gloss="Your single largest position as a share of the book. High concentration means one name drives an outsized part of your outcome."
        />
        <MetricChip
          label="Alerts"
          value={String(flags.length)}
          sub={flags.length ? 'structural flags' : 'none'}
          gloss="Count of structural flags on the book — concentration, sector tilt, or drawdown thresholds crossed. Diagnostics, not advice."
        />
      </div>

      {/* Zone B */}
      <div id={TABLE_ID}>
        <HoldingsDiagnostic
          holdings={holdings}
          quotes={quotes}
          analytics={analytics}
          flags={flags}
          asOf={s.as_of}
          onOpenSimulator={onReview}
        />
      </div>

      {/* Zone C */}
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <ExploreChips
          chips={[
            { label: 'Open Risk & Fit', onClick: () => onExplore('risk') },
            { label: 'Overview', onClick: () => onExplore('overview') },
            { label: 'Income & Activity', onClick: () => onExplore('activity') },
          ]}
        />
        <DisclaimerChip variant="footer" />
      </div>
    </div>
  )
}
