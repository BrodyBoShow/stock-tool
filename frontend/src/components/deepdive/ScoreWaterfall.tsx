import { rankColor } from '@/lib/colors'
import { FACTOR_ORDER, FACTOR_TABLE } from '@/lib/constants'
import type { SecurityHeader } from '@/types/api'

type FactorEntry = {
  key: string
  label: string
  pctl: number | null
  weight: number
  contribution: number
}

function WaterfallBar({ entry, maxContrib }: { entry: FactorEntry; maxContrib: number }) {
  const { bg, fg } = rankColor(entry.pctl)
  const barPct = maxContrib > 0 ? (entry.contribution / maxContrib) * 100 : 0
  const color = FACTOR_TABLE[entry.key as keyof typeof FACTOR_TABLE]?.bar ?? '#64748b'

  return (
    <div className="flex items-center gap-3">
      {/* Factor label + weight */}
      <div className="w-28 shrink-0">
        <span
          className="inline-flex items-center gap-1.5 text-[0.78rem] font-semibold"
          style={{ color }}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
          />
          {entry.label}
        </span>
        <span className="ml-1 text-[0.7rem] text-[#9ca3af]">
          {(entry.weight * 100).toFixed(0)}%
        </span>
      </div>

      {/* Percentile pill */}
      <span
        className="inline-block min-w-[40px] rounded-md px-2 py-0.5 text-[0.78rem] font-bold tabular-nums text-center"
        style={{ background: bg, color: fg }}
      >
        {entry.pctl === null ? '—' : entry.pctl.toFixed(1)}
      </span>

      {/* Contribution bar */}
      <div className="flex flex-1 items-center gap-2">
        <div className="relative flex-1 h-2.5 overflow-hidden rounded-full bg-[#f1f5f9]">
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
            style={{ width: `${barPct}%`, background: color, opacity: 0.8 }}
          />
        </div>
        <span className="w-10 shrink-0 text-right text-[0.78rem] font-bold tabular-nums text-[#374151]">
          +{entry.contribution.toFixed(1)}
        </span>
      </div>
    </div>
  )
}

/**
 * Score waterfall: composite = Σ (weight_i × pctl_i) per factor.
 * Data comes entirely from the header — no extra fetch needed.
 */
export function ScoreWaterfall({ header }: { header: SecurityHeader }) {
  const weights: Record<string, number> = header.details?.weights ?? {}

  const entries: FactorEntry[] = FACTOR_ORDER.filter((k) => k !== 'composite').map((key) => {
    const pctl =
      key === 'growth'
        ? header.growth_pctl
        : key === 'value'
          ? header.value_pctl
          : key === 'quality'
            ? header.quality_pctl
            : header.momentum_pctl
    const weight = weights[key] ?? 0.25
    return {
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      pctl,
      weight,
      contribution: weight * (pctl ?? 0),
    }
  })

  const composite = header.composite
  const maxContrib = Math.max(...entries.map((e) => e.contribution), 1)
  const { bg: compBg, fg: compFg } = rankColor(composite)

  if (composite === null && entries.every((e) => e.pctl === null)) return null

  return (
    <div className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-bold text-[#111827]">Score breakdown</div>
          <div className="mt-0.5 text-[0.78rem] text-[#6b7280]">
            Composite = Σ (factor weight × percentile rank)
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[0.78rem] text-[#9ca3af]">Composite</span>
          <span
            className="rounded-lg px-3 py-1 text-[1.1rem] font-extrabold tabular-nums"
            style={{ background: compBg, color: compFg }}
          >
            {composite === null ? '—' : composite.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {entries.map((entry) => (
          <WaterfallBar key={entry.key} entry={entry} maxContrib={maxContrib} />
        ))}
      </div>

      {/* Sum check */}
      <div className="mt-4 flex items-center gap-2 border-t border-[#f1f5f9] pt-3">
        <div className="flex-1 border-t-2 border-dashed border-[#e5e7eb]" />
        <span className="text-[0.72rem] text-[#9ca3af]">
          {entries.map((e) => `${e.label.slice(0, 1)} ${(e.weight * 100).toFixed(0)}%`).join(' · ')} ·{' '}
          bar = weighted contribution
        </span>
      </div>
    </div>
  )
}
