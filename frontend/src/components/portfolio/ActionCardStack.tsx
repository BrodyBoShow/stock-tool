import { useState } from 'react'
import type { PortfolioFlag } from '@/types/api'
import { SEVERITY_TONES, activeSnoozes, flagKey, snoozeFlag } from '@/components/portfolio/portfolioUi'
import { fmtSignedMoney } from '@/lib/format'

export interface ActionCardStackProps {
  flags: PortfolioFlag[]
  /** Pre-fill the Rebalance drawer with this card's fix. */
  onOpenSimulator: (flag: PortfolioFlag) => void
}

type SortBy = 'severity' | 'kind'
type Severity = 'high' | 'med' | 'low'

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, med: 1, low: 2 }

function flagSeverity(f: PortfolioFlag): Severity {
  return f.severity ?? 'low'
}

/** Human-readable "why it matters" line, composed from the flag's fields. */
function whyLine(f: PortfolioFlag): string | null {
  if (f.kind === 'concentration') {
    return `Why it matters: a 30% drawdown in ${f.ticker ?? 'this name'} alone would cut the portfolio ~${Math.round(
      (f.weight ?? 0) * 30,
    )}%. Threshold: ${Math.round((f.threshold ?? 0) * 100)}% per name.`
  }
  if (f.kind === 'sector') {
    return `Why: one sector shock hits ${Math.round((f.weight ?? 0) * 100)}% of your book at once. Threshold: ${Math.round(
      (f.threshold ?? 0) * 100,
    )}% per sector.`
  }
  if (f.kind === 'drawdown') {
    return 'Awareness only — inside the range your risk profile implies.'
  }
  return null
}

interface ActionCardProps {
  flag: PortfolioFlag
  isSnoozed: boolean
  onSnooze: (days: number) => void
  onOpenSimulator: (flag: PortfolioFlag) => void
}

function ActionCard({ flag, isSnoozed, onSnooze, onOpenSimulator }: ActionCardProps): JSX.Element {
  const sev = flagSeverity(flag)
  const tone = SEVERITY_TONES[sev]
  const why = whyLine(flag)
  const fix = flag.fix
  const hasSimTarget = fix != null && (fix.sell_ticker != null || fix.add_ticker != null)
  const taxParts: string[] = []
  if (fix?.tax_lt != null) taxParts.push(`tax: LT ${fmtSignedMoney(fix.tax_lt)}`)
  if (fix?.tax_st != null && fix.tax_st !== 0) taxParts.push(`ST ${fmtSignedMoney(fix.tax_st)}`)

  return (
    <div
      className={`rounded-lg border border-gray-200 border-l-4 ${tone.border} p-3.5 space-y-2 ${
        isSnoozed ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded ${tone.badge}`}>{sev.toUpperCase()}</span>
        <span className="text-[0.8rem] font-semibold flex-1">{flag.text}</span>
        {isSnoozed ? (
          <button
            type="button"
            className="text-[0.66rem] text-slate-400 hover:text-slate-700"
            onClick={() => onSnooze(0)}
          >
            Unsnooze
          </button>
        ) : (
          <>
            <button
              type="button"
              className="text-[0.66rem] text-slate-400 hover:text-slate-700"
              onClick={() => onSnooze(30)}
            >
              Snooze 30d
            </button>
            <button
              type="button"
              className="text-[0.66rem] text-slate-400 hover:text-slate-700"
              onClick={() => onSnooze(90)}
            >
              Snooze 90d
            </button>
          </>
        )}
      </div>

      {why != null && <p className="text-[0.74rem] text-slate-500">{why}</p>}

      {fix != null && (
        <div className="bg-slate-50 border border-slate-100 rounded-md p-2.5 flex flex-wrap items-center gap-2 text-[0.74rem]">
          <span className="text-slate-400">Suggested:</span>
          <span className="font-medium text-slate-800">{fix.action}</span>
          {fix.target_weight != null && (
            <span className="tabular-nums" style={{ color: '#16a34a' }}>
              → weight {Math.round((flag.weight ?? 0) * 100)}% → {Math.round(fix.target_weight * 100)}%
            </span>
          )}
          {taxParts.length > 0 && <span className="text-slate-500 tabular-nums">{taxParts.join(' · ')}</span>}
          {fix.wash_sale_risk && (
            <span className="bg-red-50 text-red-700 rounded px-1.5">⚠ wash-sale risk</span>
          )}
          {hasSimTarget && (
            <button
              type="button"
              className="ml-auto rounded-md bg-indigo-600 px-2.5 py-1 text-[0.7rem] font-semibold text-white hover:bg-indigo-700"
              onClick={() => onOpenSimulator(flag)}
            >
              Open in Rebalance Simulator →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ActionCardStack(props: ActionCardStackProps): JSX.Element | null {
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => activeSnoozes())
  const [sortBy, setSortBy] = useState<SortBy>('severity')
  const [showSnoozed, setShowSnoozed] = useState(false)

  if (props.flags.length === 0) return null

  const snoozedFlags = props.flags.filter((f) => flagKey(f) in snoozed)
  const visible = showSnoozed ? props.flags : props.flags.filter((f) => !(flagKey(f) in snoozed))

  const sorted = [...visible].sort((a, b) => {
    if (sortBy === 'severity') {
      return SEVERITY_ORDER[flagSeverity(a)] - SEVERITY_ORDER[flagSeverity(b)]
    }
    return a.kind.localeCompare(b.kind)
  })

  const handleSnooze = (f: PortfolioFlag, days: number) => {
    snoozeFlag(f, days)
    setSnoozed(activeSnoozes())
  }

  const sortPill = (key: SortBy, label: string) => (
    <button
      type="button"
      className={`rounded-full px-2 py-0.5 text-[0.66rem] font-semibold ${
        sortBy === key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-700'
      }`}
      onClick={() => setSortBy(key)}
    >
      {label}
    </button>
  )

  return (
    <div className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1">
          <div className="text-[0.82rem] font-bold">Things to review</div>
          <div className="text-[0.7rem] text-slate-400">
            {sorted.length} issue{sorted.length === 1 ? '' : 's'} · sorted by {sortBy}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {sortPill('severity', 'Severity')}
          {sortPill('kind', 'Type')}
        </div>
        {snoozedFlags.length > 0 && (
          <button
            type="button"
            className="text-[0.66rem] text-slate-400 hover:text-slate-700"
            onClick={() => setShowSnoozed((v) => !v)}
          >
            Snoozed ({snoozedFlags.length})
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        {sorted.map((f) => (
          <ActionCard
            key={flagKey(f)}
            flag={f}
            isSnoozed={flagKey(f) in snoozed}
            onSnooze={(days) => handleSnooze(f, days)}
            onOpenSimulator={props.onOpenSimulator}
          />
        ))}
      </div>
    </div>
  )
}
