import {
  Gem,
  type LucideIcon,
  Rocket,
  Save,
  Star,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import { useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { Slider } from '@/components/ui/slider'
import { FACTOR_TABLE, sectorChip, type FactorKey } from '@/lib/constants'
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  MARKET_CAP_OPTIONS,
  type Filters,
} from '@/lib/filters'
import { deleteView, getSavedViews, saveView } from '@/lib/savedViews'

const FACTOR_LABEL: Record<FactorKey, string> = {
  composite: 'Composite',
  growth: 'Growth',
  value: 'Value',
  quality: 'Quality',
  momentum: 'Momentum',
}

/** Per-factor minimums shown in the Advanced step (composite gets its own
 *  prominent slider in Step 3). */
const ADVANCED_FACTORS: FactorKey[] = ['growth', 'value', 'quality', 'momentum']

/** Historical risk bands (realized vol over the past year; see RiskBandChip).
 * 0 = "No band" — names with under a year of history, explicit opt-in. */
const RISK_BAND_OPTIONS: Array<{ value: number; label: string; title: string }> = [
  // Titles frame the vol range as the band's ANCHOR, not each name's measured
  // vol — modifiers can raise a lower-volatility name into a band.
  { value: 1, label: '1 Very Low', title: 'Volatility anchor < 18%/yr' },
  { value: 2, label: '2 Low', title: 'Volatility anchor 18–28%/yr (modifiers can raise lower-vol names into a band)' },
  { value: 3, label: '3 Moderate', title: 'Volatility anchor 28–40%/yr (modifiers can raise lower-vol names into a band)' },
  { value: 4, label: '4 High', title: 'Volatility anchor 40–60%/yr (modifiers can raise lower-vol names into a band)' },
  { value: 5, label: '5 Speculative', title: 'Volatility anchor ≥ 60%/yr (modifiers can raise lower-vol names into a band)' },
  { value: 0, label: 'No band', title: 'Under 1 year of trading history or no recent prices — band never estimated' },
]

interface Preset {
  label: string
  icon: LucideIcon
  meta: string
  mins: Record<FactorKey, number>
}

const PRESETS: Preset[] = [
  { label: 'Quality Growth', icon: Trophy, meta: 'Growth + Quality ≥ 70',
    mins: { composite: 0, growth: 70, value: 0, quality: 70, momentum: 0 } },
  { label: 'Deep Value', icon: Gem, meta: 'Value ≥ 80, Quality ≥ 50',
    mins: { composite: 0, growth: 0, value: 80, quality: 50, momentum: 0 } },
  { label: 'Momentum', icon: Rocket, meta: 'Momentum ≥ 80',
    mins: { composite: 0, growth: 0, value: 0, quality: 0, momentum: 80 } },
  // "Cheap & Rising" (GARP): trending AND still reasonably priced — the
  // value×momentum sweet spot. Pairs with the sortable GARP column (worst-of
  // value/momentum) to rank names strong on BOTH.
  { label: 'Cheap & Rising', icon: TrendingUp, meta: 'Value + Momentum ≥ 60',
    mins: { composite: 0, growth: 0, value: 60, quality: 0, momentum: 60 } },
  { label: 'All Stars', icon: Star, meta: 'Composite ≥ 80',
    mins: { composite: 80, growth: 0, value: 0, quality: 0, momentum: 0 } },
]

function StepHeader({
  n,
  title,
  sub,
  muted,
}: {
  n: number
  title: string
  sub?: string
  muted?: boolean
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span
        className={
          'flex h-[18px] w-[18px] items-center justify-center rounded-full text-[0.62rem] font-bold ' +
          (muted ? 'bg-surface-3 text-subtle' : 'bg-accent-solid text-accent-ink')
        }
      >
        {n}
      </span>
      <span className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-ink">
        {title}
      </span>
      {sub && (
        <span className="ml-auto text-[0.64rem] font-medium normal-case text-subtle">
          {sub}
        </span>
      )}
    </div>
  )
}

/** iOS-style toggle — visually distinct from the multi-select chips. */
function Toggle({
  on,
  onToggle,
  label,
  sub,
}: {
  on: boolean
  onToggle: () => void
  label: string
  sub: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className="flex w-full items-center justify-between gap-3 py-1.5 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[0.78rem] font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-[0.66rem] leading-snug text-subtle">{sub}</span>
      </span>
      <span
        className={
          'relative h-[18px] w-8 shrink-0 rounded-full transition-colors ' +
          (on ? 'bg-accent-solid' : 'bg-surface-3')
        }
      >
        <span
          className={
            'absolute top-0.5 h-[14px] w-[14px] rounded-full bg-surface shadow transition-all ' +
            (on ? 'left-[16px]' : 'left-0.5')
          }
        />
      </span>
    </button>
  )
}

const STEP = 'border-b border-divider py-3 first:pt-3 last:border-b-0'

export function FilterSidebar({
  filters,
  onChange,
  onReset,
  resultCount,
  totalCount,
  sectors,
  currentQuery,
  onApplyQuery,
}: {
  filters: Filters
  onChange: (next: Filters) => void
  onReset: () => void
  resultCount: number
  totalCount: number
  sectors: string[]
  /** Current filters+sort serialized as a URL query (for Save view). */
  currentQuery: string
  /** Apply a saved view's stored query string. */
  onApplyQuery: (query: string) => void
}) {
  const [advOpen, setAdvOpen] = useState(
    () => ADVANCED_FACTORS.some((k) => filters.mins[k] > 0),
  )
  const [views, setViews] = useState(getSavedViews)
  const [naming, setNaming] = useState(false)
  const [viewName, setViewName] = useState('')
  const active = activeFilterCount(filters)
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  const commitSave = () => {
    const n = viewName.trim()
    if (!n) return
    setViews(saveView(n, currentQuery))
    setViewName('')
    setNaming(false)
  }

  const pristineExceptMins =
    filters.sectors.length === 0 &&
    filters.search === '' &&
    filters.minMarketCap === 0 &&
    !filters.excludePenny &&
    filters.riskBands.length === 0
  const presetActive = (p: Preset) =>
    pristineExceptMins && JSON.stringify(filters.mins) === JSON.stringify(p.mins)

  const toggleSector = (s: string) =>
    set({
      sectors: filters.sectors.includes(s)
        ? filters.sectors.filter((x) => x !== s)
        : [...filters.sectors, s],
    })

  return (
    <aside className="w-full shrink-0 rounded-card border border-line bg-surface px-3.5 pb-3.5 shadow-card lg:w-[270px]">
      {/* header */}
      <div className="flex items-center justify-between border-b border-divider py-3">
        <div className="flex items-center gap-2 text-sm font-bold text-ink">
          Filters
          {active > 0 && (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink px-1 text-[0.62rem] font-bold text-inverse">
              {active}
            </span>
          )}
        </div>
        <div className="text-[0.74rem] text-muted">
          <span className="numeric font-bold text-ink">{resultCount}</span> of{' '}
          <span className="numeric">{totalCount}</span>
        </div>
      </div>

      {/* search (kept until ⌘K command palette lands) */}
      <div className="pt-2.5">
        <input
          id="screener-search"
          type="text"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search ticker or company…  ( / )"
          className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.8rem] text-ink placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* ① START FROM */}
      <div className={STEP}>
        <StepHeader n={1} title="Start from" sub="optional" />
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => {
            const on = presetActive(p)
            return (
              <button
                key={p.label}
                type="button"
                onClick={() =>
                  onChange(on ? DEFAULT_FILTERS : { ...DEFAULT_FILTERS, mins: p.mins })
                }
                className={
                  'flex flex-col gap-0.5 rounded-lg border px-2 py-1.5 text-left transition-all ' +
                  (on
                    ? 'border-accent bg-accent-solid text-accent-ink'
                    : 'border-line bg-surface hover:border-accent hover:bg-accent-soft')
                }
              >
                <Icon icon={p.icon} size={16} className={on ? 'text-accent-ink' : 'text-accent'} />
                <span className="text-[0.72rem] font-bold leading-tight">{p.label}</span>
                <span
                  className={
                    'text-[0.6rem] leading-tight ' +
                    (on ? 'text-accent-ink' : 'text-subtle')
                  }
                >
                  {p.meta}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ② WHAT KIND OF STOCKS */}
      <div className={STEP}>
        <StepHeader n={2} title="What kind" />

        <div className="mb-1 flex items-center justify-between">
          <span className="text-[0.66rem] font-bold uppercase tracking-[0.05em] text-subtle">
            Sectors
          </span>
          <span className="text-[0.62rem] text-subtle">empty = all</span>
        </div>
        <div className="flex flex-wrap gap-[5px]">
          {sectors.map((s) => {
            const on = filters.sectors.includes(s)
            const { hue, bg, fg } = sectorChip(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSector(s)}
                className="inline-flex items-center gap-1.5 rounded-full px-[10px] py-[3px] text-[0.7rem] font-semibold transition-shadow"
                style={
                  on
                    ? { background: bg, color: fg, boxShadow: `inset 0 0 0 1.5px ${fg}` }
                    : {
                        background: 'var(--surface)',
                        color: 'var(--muted)',
                        boxShadow: 'inset 0 0 0 1px var(--border)',
                      }
                }
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: hue }}
                />
                {s}
              </button>
            )
          })}
        </div>

        <div className="mb-1 mt-3.5 text-[0.66rem] font-bold uppercase tracking-[0.05em] text-subtle">
          Market cap
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MARKET_CAP_OPTIONS.map((o) => {
            const on = filters.minMarketCap === o.value
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => set({ minMarketCap: o.value })}
                className={
                  'rounded-md border px-1.5 py-1 text-center text-[0.62rem] font-semibold leading-tight transition-all ' +
                  (on
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line bg-surface text-muted hover:border-accent')
                }
              >
                {o.label.replace(/ \(.*\)/, '').replace('Any size', 'Any')}
              </button>
            )
          })}
        </div>

        {/* Historical risk band — a backward-looking measurement (realized vol/
            beta/drawdown), attached after ranking; filtering by it never changes
            any name's rank. "No band" (under 1y of history) is an explicit
            opt-in so new listings don't silently vanish. */}
        <div className="mb-1 mt-3.5 text-[0.66rem] font-bold uppercase tracking-[0.05em] text-subtle">
          Risk band <span className="normal-case font-medium">(historical)</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {RISK_BAND_OPTIONS.map((o) => {
            const on = filters.riskBands.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                title={o.title}
                onClick={() =>
                  set({
                    riskBands: on
                      ? filters.riskBands.filter((b) => b !== o.value)
                      : [...filters.riskBands, o.value].sort((a, b) => a - b),
                  })
                }
                className={
                  'rounded-md border px-1.5 py-1 text-center text-[0.62rem] font-semibold leading-tight transition-all ' +
                  (on
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line bg-surface text-muted hover:border-accent')
                }
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ③ HOW GOOD */}
      <div className={STEP}>
        <StepHeader n={3} title="How good" />
        <div className="mb-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[0.78rem] font-semibold text-ink">
              Min composite score
            </span>
            <span className="numeric text-[0.95rem] font-bold text-accent">
              {filters.mins.composite === 0 ? 'Any' : filters.mins.composite}
            </span>
          </div>
          <Slider
            accent={FACTOR_TABLE.composite.bar}
            min={0}
            max={100}
            step={5}
            value={[filters.mins.composite]}
            onValueChange={([v]) => set({ mins: { ...filters.mins, composite: v } })}
            aria-label="Minimum composite score"
          />
          <div className="mt-0.5 flex justify-between text-[0.6rem] text-subtle">
            <span>0 (all)</span>
            <span>100 (best)</span>
          </div>
        </div>
        <Toggle
          on={filters.completeOnly}
          onToggle={() => set({ completeOnly: !filters.completeOnly })}
          label="Require complete factor data"
          sub="Hide names missing any of the 4 sub-scores (recommended)"
        />
        <Toggle
          on={filters.excludePenny}
          onToggle={() => set({ excludePenny: !filters.excludePenny })}
          label="Exclude penny stocks"
          sub="Hide names priced under $1"
        />
      </div>

      {/* ④ ADVANCED */}
      <div className={STEP}>
        <button
          type="button"
          onClick={() => setAdvOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-[0.7rem] font-bold text-muted transition hover:bg-surface-3"
        >
          <span className="flex items-center gap-2">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-surface-3 text-[0.62rem] font-bold text-subtle">
              4
            </span>
            Advanced — per-factor minimums
          </span>
          <span>{advOpen ? '▴' : '▾'}</span>
        </button>
        {advOpen && (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
            {ADVANCED_FACTORS.map((key) => {
              const v = filters.mins[key]
              const accent = FACTOR_TABLE[key].bar
              return (
                <div key={key}>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center text-[0.7rem] font-semibold text-muted">
                      <span
                        className="mr-1 inline-block h-[7px] w-[7px] rounded-full"
                        style={{ background: accent }}
                      />
                      {FACTOR_LABEL[key]}
                    </span>
                    <span className="numeric text-[0.66rem] font-bold text-ink">
                      {v === 0 ? '—' : v}
                    </span>
                  </div>
                  <Slider
                    accent={accent}
                    min={0}
                    max={100}
                    step={5}
                    value={[v]}
                    onValueChange={([nv]) => set({ mins: { ...filters.mins, [key]: nv } })}
                    aria-label={`${FACTOR_LABEL[key]} minimum`}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* saved views */}
      {views.length > 0 && (
        <div className="border-t border-line pt-3">
          <div className="mb-1.5 text-[0.66rem] font-bold uppercase tracking-[0.05em] text-subtle">
            Saved views
          </div>
          <div className="flex flex-wrap gap-1.5">
            {views.map((v) => (
              <span
                key={v.name}
                className="inline-flex items-center gap-1 rounded-full bg-surface-3 py-1 pl-2.5 pr-1.5 text-[0.7rem] font-semibold text-ink"
              >
                <button
                  type="button"
                  onClick={() => onApplyQuery(v.query)}
                  className="hover:text-accent"
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => setViews(deleteView(v.name))}
                  className="leading-none text-subtle hover:text-neg"
                  aria-label={`Delete saved view ${v.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* footer */}
      <div className="mt-3 border-t border-line pt-3">
        {naming ? (
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitSave()
                if (e.key === 'Escape') setNaming(false)
              }}
              placeholder="Name this view…"
              className="min-w-0 flex-1 rounded-lg border border-line px-2.5 py-1.5 text-[0.78rem] focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={commitSave}
              className="rounded-lg bg-accent-solid px-3 py-1.5 text-[0.74rem] font-semibold text-accent-ink hover:bg-accent-hover"
            >
              Save
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line py-2 text-[0.76rem] font-semibold text-muted transition hover:border-accent hover:bg-accent-soft"
          >
            <Icon icon={Save} size={14} />
            Save as view
          </button>
        )}
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[0.72rem] text-muted">
            {active > 0 ? (
              <>
                <span className="numeric font-bold text-accent">{active}</span> active
              </>
            ) : (
              'No filters'
            )}
          </span>
          <button
            type="button"
            onClick={onReset}
            disabled={active === 0}
            className="text-[0.72rem] font-semibold text-subtle transition hover:text-neg disabled:cursor-default disabled:opacity-40"
          >
            Reset all
          </button>
        </div>
      </div>
    </aside>
  )
}
