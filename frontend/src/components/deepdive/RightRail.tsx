import { Tip } from '@/components/ui/Tip'
import { fmtInput, fmtMoney } from '@/lib/format'
import type { FundamentalPoint, SecurityHeader } from '@/types/api'
import type { PaneId } from '@/pages/DeepDivePage'

/**
 * Persistent right rail for the reading panes (spec §2.3): what's on this
 * pane, an at-a-glance stat list (every row glossary-tipped), a compare
 * entry point, and the methodology/provenance note.
 */
export interface RightRailProps {
  pane: PaneId
  header: SecurityHeader
  fundamentals: FundamentalPoint[]
  onNavigate: (pane: PaneId) => void
  onCompare: () => void
}

/** Static per-pane content map for the "On this pane" list. */
const PANE_SECTIONS: Partial<Record<PaneId, string[]>> = {
  overview: ['Decision brief teaser', 'Factor scores', 'Latest activity', 'Price trend'],
  brief: ['Decision brief', 'Your thesis'],
  scores: ['Factor tiles', 'What drives the composite', 'Sub-metric detail', 'Peers & sector rank', 'Score history'],
  value: ['Reverse DCF', 'Scenario compare', 'Macro backdrop'],
}

/**
 * Latest non-null value of a fundamentals metric (rows are per metric+date).
 * Skips null-valued rows so a newest-dated gap doesn't hide an older real
 * value — same semantics as OverviewPane's helper.
 */
function latestMetric(fundamentals: FundamentalPoint[], metric: string): number | null {
  let bestDate = ''
  let bestValue: number | null = null
  for (const f of fundamentals) {
    if (f.metric !== metric || f.value == null) continue
    if (f.as_of_date >= bestDate) {
      bestDate = f.as_of_date
      bestValue = f.value
    }
  }
  return bestValue
}

function Row({ label, tipKey, value }: { label: string; tipKey?: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1 text-[0.74rem]">
      <span className="text-muted">
        {tipKey ? <Tip k={tipKey}>{label}</Tip> : label}
      </span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </li>
  )
}

export function RightRail(props: RightRailProps) {
  const { pane, header, fundamentals, onNavigate, onCompare } = props
  const inputs = header.details?.inputs ?? {}
  const sections = PANE_SECTIONS[pane] ?? []

  const num = (k: string): number | null => {
    const v = (inputs as Record<string, unknown>)[k]
    return typeof v === 'number' ? v : null
  }

  return (
    <aside className="space-y-4 lg:sticky lg:top-14">
      {sections.length > 0 && (
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-subtle">
            On this pane
          </div>
          <ul className="space-y-1 text-[0.76rem] text-muted">
            {sections.map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-accent" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-card border border-line bg-surface p-4 shadow-card">
        <div className="mb-1.5 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-subtle">
          At a glance
        </div>
        <ul className="divide-y divide-slate-50">
          <Row
            label="Revenue (TTM)"
            tipKey="TTM"
            value={fmtMoney(latestMetric(fundamentals, 'ttm_revenue'))}
          />
          <Row label="FCF" tipKey="FCF" value={fmtMoney(latestMetric(fundamentals, 'fcf'))} />
          <Row label="P/E" tipKey="P/E" value={fmtInput('pe', num('pe'))} />
          <Row label="P/S" tipKey="P/S" value={fmtInput('ps', num('ps'))} />
          <Row
            label="FCF yield"
            tipKey="FCF yield"
            value={fmtInput('fcf_yield', num('fcf_yield'))}
          />
          <Row
            label="Debt/Equity"
            tipKey="D/E"
            value={fmtInput('debt_to_equity', num('debt_to_equity'))}
          />
          <Row
            label="ROIC"
            tipKey="ROIC"
            value={fmtInput('roic', num('roic'), header.details?.flags?.roic_pool === 'roa_proxy')}
          />
        </ul>
        <button
          type="button"
          onClick={() => onNavigate('scores')}
          className="mt-2 text-[0.7rem] font-semibold text-accent hover:underline"
        >
          Full sub-metric breakdown →
        </button>
      </div>

      <div className="rounded-card border border-line bg-surface p-4 shadow-card">
        <div className="mb-1.5 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-subtle">
          Compare
        </div>
        <p className="text-[0.72rem] text-muted">
          Put {header.ticker} side-by-side with up to 3 tickers — composite, factors and
          key fundamentals.
        </p>
        <button
          type="button"
          onClick={onCompare}
          className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.74rem] font-bold text-muted transition-colors hover:border-accent hover:text-accent"
        >
          Open compare →
        </button>
      </div>

      <div className="rounded-card border border-line bg-surface p-4 shadow-card">
        <div className="mb-1.5 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-subtle">
          Methodology
        </div>
        <p className="text-[0.68rem] leading-relaxed text-subtle">
          Scores are cross-sectional percentiles vs the US-listed universe, refreshed
          nightly (Value and Momentum live-adjust intraday). AI text is synthesized from
          StockBud&rsquo;s own factor data and can be wrong — verify against the Data
          panes. Not investment advice.
        </p>
      </div>
    </aside>
  )
}
