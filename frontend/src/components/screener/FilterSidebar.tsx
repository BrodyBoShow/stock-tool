import { Slider } from '@/components/ui/slider'
import {
  FACTOR_ORDER,
  FACTOR_TABLE,
  sectorPillColors,
  type FactorKey,
} from '@/lib/constants'
import { activeFilterCount, DEFAULT_FILTERS, MARKET_CAP_OPTIONS, type Filters } from '@/lib/filters'

const FACTOR_LABEL: Record<FactorKey, string> = {
  composite: 'Composite',
  growth: 'Growth',
  value: 'Value',
  quality: 'Quality',
  momentum: 'Momentum',
}

const SECTION =
  'text-[0.67rem] font-bold uppercase tracking-[0.07em] text-[#6b7280]'

interface Preset {
  label: string
  emoji: string
  apply: Partial<Filters>
}

const PRESETS: Preset[] = [
  {
    label: 'Quality Growth',
    emoji: '🏆',
    apply: { mins: { composite: 0, growth: 70, value: 0, quality: 70, momentum: 0 } },
  },
  {
    label: 'Deep Value',
    emoji: '💎',
    apply: { mins: { composite: 0, growth: 0, value: 80, quality: 50, momentum: 0 } },
  },
  {
    label: 'Momentum',
    emoji: '🚀',
    apply: { mins: { composite: 0, growth: 0, value: 0, quality: 0, momentum: 80 } },
  },
  {
    label: 'All Stars',
    emoji: '⭐',
    apply: { mins: { composite: 80, growth: 0, value: 0, quality: 0, momentum: 0 } },
  },
]

export function FilterSidebar({
  filters,
  onChange,
  onReset,
  resultCount,
  totalCount,
  sectors,
}: {
  filters: Filters
  onChange: (next: Filters) => void
  onReset: () => void
  resultCount: number
  totalCount: number
  sectors: string[]
}) {
  const active = activeFilterCount(filters)

  return (
    <aside className="w-[270px] shrink-0 rounded-card border border-[#e5e7eb] bg-white p-4 shadow-card">
      {/* header */}
      <div className="border-b border-[#f1f5f9] pb-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-[#1e293b]">
            Filters
            {active > 0 && (
              <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#1e293b] text-[0.64rem] font-extrabold text-white">
                {active}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onReset}
            disabled={active === 0}
            className="text-xs font-bold text-[#64748b] hover:text-[#1e293b] disabled:cursor-default disabled:opacity-40"
          >
            Reset
          </button>
        </div>
        <div className="mt-1.5 text-[0.8rem] text-[#6b7280]">
          <span className="text-[0.9rem] font-extrabold text-[#1e293b]">
            {resultCount}
          </span>{' '}
          of {totalCount} companies
        </div>
      </div>

      {/* preset buttons */}
      <div className="mt-3.5">
        <div className={SECTION}>Presets</div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => {
            const isActive =
              JSON.stringify(p.apply.mins) === JSON.stringify(filters.mins) &&
              filters.sector === 'All' && filters.search === '' && filters.minMarketCap === 0
            return (
              <button
                key={p.label}
                type="button"
                onClick={() =>
                  onChange(isActive ? DEFAULT_FILTERS : { ...DEFAULT_FILTERS, ...p.apply })
                }
                className={`rounded-lg border px-2 py-1.5 text-left text-[0.72rem] font-semibold transition-all ${
                  isActive
                    ? 'border-[#4f46e5] bg-[#eef2ff] text-[#4f46e5]'
                    : 'border-[#e5e7eb] bg-white text-[#475569] hover:border-[#c7d2fe] hover:bg-[#f5f7ff]'
                }`}
              >
                <span className="mr-1">{p.emoji}</span>
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* complete-factors toggle — the most consequential setting, up top */}
      <label className="mt-3.5 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={filters.completeOnly}
          onChange={(e) => onChange({ ...filters, completeOnly: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#4f46e5]"
        />
        <span>
          <span className="block text-[0.8rem] font-semibold text-[#374151]">
            Complete factors only
          </span>
          <span className="mt-0.5 block text-[0.68rem] leading-snug text-[#9ca3af]">
            Rank only names scored on all four factors (recommended). Off = include
            partial names like momentum-only micro-caps.
          </span>
        </span>
      </label>

      {/* search */}
      <div className="mt-4">
        <div className={SECTION}>Search</div>
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Ticker or company…"
          className="mt-1.5 w-full rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#111827] placeholder:text-[#9ca3af] focus:border-[#1e293b] focus:outline-none"
        />
      </div>

      {/* sector chips */}
      <div className="mt-4">
        <div className={SECTION}>Sector</div>
        <div className="mt-2 flex flex-wrap gap-[5px]">
          {['All', ...sectors].map((s) => {
            const selected = filters.sector === s
            const [bg, fg] =
              s === 'All' ? ['#f1f5f9', '#475569'] : sectorPillColors(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...filters, sector: s })}
                className="rounded-full px-[11px] py-[3px] text-[0.72rem] font-semibold transition-shadow"
                style={
                  selected
                    ? { background: bg, color: fg, boxShadow: `inset 0 0 0 1.5px ${fg}` }
                    : {
                        background: '#ffffff',
                        color: '#64748b',
                        boxShadow: 'inset 0 0 0 1px #e5e7eb',
                      }
                }
              >
                {s}
              </button>
            )
          })}
        </div>
      </div>

      {/* market-cap floor */}
      <div className="mt-4">
        <div className={SECTION}>Market cap</div>
        <select
          value={filters.minMarketCap}
          onChange={(e) =>
            onChange({ ...filters, minMarketCap: Number(e.target.value) })
          }
          aria-label="Minimum market cap"
          className="mt-1.5 w-full rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#111827] focus:border-[#1e293b] focus:outline-none"
        >
          {MARKET_CAP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* factor minimums */}
      <div className="mt-4">
        <div className={SECTION}>Factor minimums</div>
        <div className="mt-2 space-y-3">
          {FACTOR_ORDER.map((key) => {
            const v = filters.mins[key]
            const accent = FACTOR_TABLE[key].bar
            return (
              <div key={key}>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center text-[0.78rem] font-semibold text-[#374151]">
                    <span
                      className="mr-1.5 inline-block h-2 w-2 rounded-full"
                      style={{ background: accent }}
                    />
                    {FACTOR_LABEL[key]}
                  </span>
                  <span className="rounded-md bg-[#f1f5f9] px-2 py-0.5 text-[0.7rem] font-extrabold text-[#1e293b]">
                    {v === 0 ? 'Any' : `${v}+`}
                  </span>
                </div>
                <Slider
                  accent={accent}
                  min={0}
                  max={100}
                  step={5}
                  value={[v]}
                  onValueChange={([nv]) =>
                    onChange({ ...filters, mins: { ...filters.mins, [key]: nv } })
                  }
                  aria-label={`${FACTOR_LABEL[key]} minimum`}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* active banner */}
      {active > 0 && (
        <div className="mt-4 rounded-[10px] bg-[#1e293b] px-3 py-2.5 text-white">
          <strong className="text-[0.8rem] font-bold">
            {active} filter{active === 1 ? '' : 's'} active
          </strong>
          <div className="mt-0.5 text-[0.69rem] text-[#94a3b8]">
            {resultCount} of {totalCount} companies match
          </div>
        </div>
      )}
    </aside>
  )
}
