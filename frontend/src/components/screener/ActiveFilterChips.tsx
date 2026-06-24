import { FACTOR_ORDER, type FactorKey } from '@/lib/constants'
import { MARKET_CAP_OPTIONS, type Filters } from '@/lib/filters'

const FACTOR_LABEL: Record<FactorKey, string> = {
  composite: 'Composite',
  growth: 'Growth',
  value: 'Value',
  quality: 'Quality',
  momentum: 'Momentum',
}

/** Removable chips for every active filter — the current screen made legible and
 * one-click editable above the results, instead of hunting the sidebar. */
export function ActiveFilterChips({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters
  onChange: (next: Filters) => void
  onReset: () => void
}) {
  const chips: { key: string; label: string; clear: () => void }[] = []

  if (filters.search.trim())
    chips.push({
      key: 'search',
      label: `“${filters.search.trim()}”`,
      clear: () => onChange({ ...filters, search: '' }),
    })
  if (filters.sector !== 'All')
    chips.push({
      key: 'sector',
      label: filters.sector,
      clear: () => onChange({ ...filters, sector: 'All' }),
    })
  if (filters.minMarketCap > 0) {
    const o = MARKET_CAP_OPTIONS.find((o) => o.value === filters.minMarketCap)
    chips.push({
      key: 'mcap',
      label: o?.label ?? 'Market cap',
      clear: () => onChange({ ...filters, minMarketCap: 0 }),
    })
  }
  if (!filters.completeOnly)
    chips.push({
      key: 'partial',
      label: 'Incl. partial names',
      clear: () => onChange({ ...filters, completeOnly: true }),
    })
  for (const k of FACTOR_ORDER) {
    if (filters.mins[k] > 0)
      chips.push({
        key: `min-${k}`,
        label: `${FACTOR_LABEL[k]} ≥ ${filters.mins[k]}`,
        clear: () => onChange({ ...filters, mins: { ...filters.mins, [k]: 0 } }),
      })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-slate-400">
        Active
      </span>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.clear}
          className="group inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-2 text-[0.73rem] font-semibold text-slate-700 transition hover:bg-slate-200"
        >
          {c.label}
          <svg
            className="text-slate-400 group-hover:text-slate-700"
            width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="3" strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ))}
      <button
        type="button"
        onClick={onReset}
        className="ml-0.5 text-[0.73rem] font-semibold text-indigo-600 hover:underline"
      >
        Clear all
      </button>
    </div>
  )
}
