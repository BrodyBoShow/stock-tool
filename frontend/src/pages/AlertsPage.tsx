import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorCard } from '@/components/ErrorCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/Toast'
import {
  addToWatchlist,
  ApiError,
  createAlertRule,
  deleteAlertRule,
  getAlerts,
  getWatchlist,
  toggleAlertRule,
} from '@/lib/api'
import { fmtShortDate } from '@/lib/format'
import type {
  AlertKind,
  AlertRule,
  AlertRuleType,
  AlertTier,
  AlertTrigger,
} from '@/types/api'

// ── rule / form copy ──────────────────────────────────────────────────────────

const RULE_LABELS: Record<AlertRuleType, string> = {
  rank_drop: 'Rank drop',
  composite_drop: 'Composite drop',
  composite_rise: 'Composite rise',
  insider_buy: 'Insider buying',
  new_8k: 'New 8-K',
  review_due: 'Thesis review due',
}

const THRESHOLD_TYPES = new Set<AlertRuleType>([
  'rank_drop',
  'composite_drop',
  'composite_rise',
])

function ruleDescription(r: AlertRule): string {
  const t = r.threshold ?? 0
  const base =
    r.rule_type === 'rank_drop'
      ? `Rank falls more than ${t} places vs ~1mo ago`
      : r.rule_type === 'composite_drop'
        ? `Composite falls more than ${t} points vs ~1mo ago`
        : r.rule_type === 'composite_rise'
          ? `Composite rises more than ${t} points vs ~1mo ago`
          : r.rule_type === 'insider_buy'
            ? 'Any open-market insider buy (last 3 months)'
            : r.rule_type === 'new_8k'
              ? 'A high-signal 8-K filed (last 30 days)'
              : 'A thesis review date has been reached'
  const where =
    r.scope === 'ticker' && r.ticker
      ? ` · ${r.ticker} only`
      : r.scope === 'watchlist'
        ? ' · watchlist'
        : ' · whole market'
  return base + where
}

// ── triage classification → display ───────────────────────────────────────────

const KIND_LABEL: Record<AlertKind, string> = {
  red_flag: 'Red flag',
  event_8k: '8-K',
  earnings: 'Earnings',
  insider: 'Insider buy',
  factor_drop: 'Factor',
  factor_rise: 'Factor',
  review: 'Review',
}

type GroupKey = 'factor' | 'insider' | '8k' | 'review'

const GROUPS: { key: GroupKey; chip: string; title: string; kinds: AlertKind[] }[] = [
  { key: 'factor', chip: 'Factor', title: 'Factor movers', kinds: ['factor_drop', 'factor_rise'] },
  { key: 'insider', chip: 'Insider', title: 'Insider buying', kinds: ['insider'] },
  { key: '8k', chip: '8-K', title: '8-K filings', kinds: ['red_flag', 'event_8k', 'earnings'] },
  { key: 'review', chip: 'Reviews', title: 'Thesis reviews', kinds: ['review'] },
]

function groupOf(kind: AlertKind): GroupKey {
  if (kind === 'insider') return 'insider'
  if (kind === 'review') return 'review'
  if (kind === 'factor_drop' || kind === 'factor_rise') return 'factor'
  return '8k'
}

function isPositive(kind: AlertKind): boolean {
  return kind === 'insider' || kind === 'factor_rise'
}

/** Tailwind classes for a row, given its tier + kind. Color is rationed to the
 * left accent bar, the magnitude stat and the kind chip so the page never
 * becomes a wall of tint; positive kinds (buys, rises) read emerald/sky. */
function rowStyle(tier: AlertTier, kind: AlertKind) {
  const positive = isPositive(kind)
  const accent = positive
    ? 'border-l-emerald-400'
    : tier === 'critical'
      ? 'border-l-red-500'
      : tier === 'elevated'
        ? 'border-l-amber-400'
        : 'border-l-slate-300'
  const stat = positive
    ? 'text-emerald-600'
    : tier === 'critical'
      ? 'text-red-700'
      : tier === 'elevated'
        ? 'text-amber-700'
        : 'text-slate-500'
  const iconBox = positive
    ? 'bg-emerald-100 text-emerald-600'
    : tier === 'critical'
      ? 'bg-red-100 text-red-600'
      : tier === 'elevated'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-500'
  const chip =
    kind === 'factor_rise'
      ? 'bg-sky-100 text-sky-700'
      : kind === 'insider'
        ? 'bg-emerald-100 text-emerald-700'
        : tier === 'critical'
          ? 'bg-red-100 text-red-700'
          : tier === 'elevated'
            ? 'bg-amber-100 text-amber-800'
            : 'bg-slate-100 text-slate-600'
  return { accent, stat, iconBox, chip }
}

function KindIcon({ kind }: { kind: AlertKind }) {
  const c = {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (kind) {
    case 'insider':
      return (
        <svg {...c}>
          <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      )
    case 'factor_drop':
      return (
        <svg {...c}>
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      )
    case 'factor_rise':
      return (
        <svg {...c}>
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      )
    case 'red_flag':
      return (
        <svg {...c}>
          <path d="M4 22V4M4 4h13l-2 4 2 4H4" />
        </svg>
      )
    case 'review':
      return (
        <svg {...c}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      )
    default:
      return (
        <svg {...c}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      )
  }
}

const alertKey = (a: AlertTrigger) => `${a.rule_id}:${a.security_id}:${a.observed_date ?? ''}`

// ── row ───────────────────────────────────────────────────────────────────────

function AlertRow({
  a,
  watched,
  onWatch,
  onDismiss,
}: {
  a: AlertTrigger
  watched: boolean
  onWatch: (t: string) => void
  onDismiss: (a: AlertTrigger) => void
}) {
  const st = rowStyle(a.tier, a.kind)
  const headline = a.item_label ?? a.message
  return (
    <div
      className={`group relative flex items-center gap-3 rounded-xl border border-gray-100 border-l-4 bg-white px-3 py-2 hover:bg-slate-50 ${st.accent}`}
    >
      <span className={`flex-none rounded-md p-1 ${st.iconBox}`}>
        <KindIcon kind={a.kind} />
      </span>

      <Link
        to={`/securities/${a.ticker}`}
        className="flex w-[4.2rem] flex-none items-center gap-0.5 font-bold text-[0.9rem] text-gray-900 hover:text-indigo-600"
      >
        {watched && <span className="text-amber-400">★</span>}
        <span className="truncate">{a.ticker}</span>
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`flex-none rounded px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-[0.06em] ${st.chip}`}
          >
            {KIND_LABEL[a.kind]}
          </span>
          <span className="truncate text-[0.83rem] font-medium text-slate-800">{headline}</span>
        </div>
        <div className="truncate text-[0.7rem] text-slate-400">
          {a.name ?? a.ticker}
          {a.sector ? ` · ${a.sector}` : ''}
        </div>
      </div>

      <div className="flex-none text-right">
        <div className={`font-bold tabular-nums text-[0.92rem] leading-tight ${st.stat}`}>
          {a.magnitude_label || '—'}
        </div>
        {a.observed_date && (
          <div className="text-[0.62rem] text-slate-400">{fmtShortDate(a.observed_date)}</div>
        )}
      </div>

      {/* fixed-width action column: visible on hover, never shifts layout */}
      <div className="flex w-9 flex-none items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
        {!watched && (
          <button
            type="button"
            onClick={() => onWatch(a.ticker)}
            title="Add to watchlist"
            className="rounded-md p-1 text-slate-400 hover:bg-amber-50 hover:text-amber-500"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18l-5.8 3 1.1-6.5L2.6 9.8l6.5-.9z" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => onDismiss(a)}
          title="Dismiss"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── add-rule form (unchanged behavior) ────────────────────────────────────────

function AddRuleForm() {
  const qc = useQueryClient()
  const toast = useToast()
  const [ruleType, setRuleType] = useState<AlertRuleType>('rank_drop')
  const [threshold, setThreshold] = useState('10')
  const [ticker, setTicker] = useState('')

  const create = useMutation({
    mutationFn: () =>
      createAlertRule({
        rule_type: ruleType,
        scope: ticker.trim() ? 'ticker' : 'market',
        ticker: ticker.trim() ? ticker.trim().toUpperCase() : null,
        threshold: THRESHOLD_TYPES.has(ruleType) ? Number(threshold) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      toast('success', 'Alert rule added')
      setTicker('')
    },
    onError: (e) =>
      toast('error', e instanceof ApiError ? e.message : 'Could not add the rule'),
  })

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-[0.72rem] font-semibold text-slate-500">
        Condition
        <select
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value as AlertRuleType)}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[0.82rem] font-medium text-slate-800"
        >
          {Object.entries(RULE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </label>

      {THRESHOLD_TYPES.has(ruleType) && (
        <label className="flex flex-col gap-1 text-[0.72rem] font-semibold text-slate-500">
          Threshold
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-24 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[0.82rem] text-slate-800"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-[0.72rem] font-semibold text-slate-500">
        Ticker (optional)
        <input
          type="text"
          value={ticker}
          placeholder="whole market"
          onChange={(e) => setTicker(e.target.value)}
          className="w-32 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[0.82rem] uppercase text-slate-800 placeholder:normal-case placeholder:text-slate-300"
        />
      </label>

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {create.isPending ? 'Adding…' : 'Add rule'}
      </button>
    </div>
  )
}

// ── triage strip + filter bar ─────────────────────────────────────────────────

const TIER_TILE: Record<AlertTier, { label: string; on: string }> = {
  critical: { label: 'Critical', on: 'bg-red-100 text-red-700 ring-red-400' },
  elevated: { label: 'Elevated', on: 'bg-amber-100 text-amber-800 ring-amber-400' },
  routine: { label: 'Routine', on: 'bg-slate-100 text-slate-600 ring-slate-400' },
}

function TriageStrip({
  counts,
  total,
  tierFilter,
  setTierFilter,
}: {
  counts: Record<AlertTier, number>
  total: number
  tierFilter: AlertTier | null
  setTierFilter: (t: AlertTier | null) => void
}) {
  const tiers: AlertTier[] = ['critical', 'elevated', 'routine']
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tiers.map((t) => {
        const n = counts[t]
        const active = tierFilter === t
        if (t === 'critical' && n === 0) {
          return (
            <span
              key={t}
              className="rounded-full bg-emerald-50 px-3 py-1 text-[0.75rem] font-semibold text-emerald-700"
            >
              ✓ Quiet today
            </span>
          )
        }
        return (
          <button
            key={t}
            type="button"
            onClick={() => setTierFilter(active ? null : t)}
            className={`rounded-full px-3 py-1 text-[0.75rem] font-semibold transition ${TIER_TILE[t].on} ${active ? 'ring-2 ring-offset-1' : 'opacity-90 hover:opacity-100'} ${tierFilter && !active ? 'opacity-50' : ''}`}
          >
            {n} {TIER_TILE[t].label}
          </button>
        )
      })}
      <span className="ml-auto text-[0.74rem] text-slate-400">{total} signals</span>
    </div>
  )
}

function FilterBar({
  byGroup,
  kindFilter,
  toggleGroup,
  query,
  setQuery,
}: {
  byGroup: Record<GroupKey, number>
  kindFilter: Set<GroupKey>
  toggleGroup: (g: GroupKey) => void
  query: string
  setQuery: (s: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {GROUPS.map((g) => {
        const n = byGroup[g.key] ?? 0
        const active = kindFilter.has(g.key)
        return (
          <button
            key={g.key}
            type="button"
            disabled={n === 0}
            onClick={() => toggleGroup(g.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] font-semibold transition ${
              active
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            } ${n === 0 ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            {g.chip}
            <span className={active ? 'text-white/70' : 'text-slate-400'}>{n}</span>
          </button>
        )
      })}
      <input
        type="text"
        value={query}
        placeholder="ticker or name"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        className="ml-auto w-44 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[0.78rem] text-slate-800 placeholder:text-slate-300"
      />
    </div>
  )
}

// ── grouped (collapsible) section ─────────────────────────────────────────────

function KindGroup({
  group,
  rows,
  watchSet,
  onWatch,
  onDismiss,
}: {
  group: { key: GroupKey; title: string }
  rows: AlertTrigger[]
  watchSet: Set<string>
  onWatch: (t: string) => void
  onDismiss: (a: AlertTrigger) => void
}) {
  const lsKey = `alerts.group.${group.key}`
  const hasElevated = rows.some((r) => r.tier === 'elevated')
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(lsKey)
    return saved === null ? hasElevated : saved === '1'
  })
  const [showAll, setShowAll] = useState(false)
  const dot = rows.some((r) => r.tier === 'elevated') ? 'bg-amber-400' : 'bg-slate-300'
  const shown = showAll ? rows : rows.slice(0, 8)

  return (
    <details
      open={open}
      onToggle={(e) => {
        const o = (e.target as HTMLDetailsElement).open
        setOpen(o)
        localStorage.setItem(lsKey, o ? '1' : '0')
      }}
      className="rounded-card border border-gray-200 bg-white shadow-card"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
        <span className={`h-2 w-2 flex-none rounded-full ${dot}`} />
        <span className="text-[0.92rem] font-bold text-gray-900">{group.title}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-500">
          {rows.length}
        </span>
        <svg
          className={`ml-auto h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="space-y-1.5 px-3 pb-3">
        {shown.map((a) => (
          <AlertRow
            key={alertKey(a)}
            a={a}
            watched={watchSet.has(a.ticker)}
            onWatch={onWatch}
            onDismiss={onDismiss}
          />
        ))}
        {rows.length > 8 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="w-full rounded-lg py-1.5 text-[0.76rem] font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            {showAll ? 'Show less' : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </details>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

const DISMISS_KEY = 'alerts.dismissed'
const CRIT_CAP = 6

export function AlertsPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['alerts'],
    queryFn: getAlerts,
    staleTime: 60 * 1000,
    refetchInterval: 120 * 1000,
    refetchOnWindowFocus: true,
  })
  const { data: watchlist } = useQuery({ queryKey: ['watchlist'], queryFn: getWatchlist })
  const watchSet = useMemo(
    () => new Set((watchlist?.rows ?? []).map((r) => r.ticker)),
    [watchlist],
  )

  const [tierFilter, setTierFilter] = useState<AlertTier | null>(null)
  const [kindFilter, setKindFilter] = useState<Set<GroupKey>>(new Set())
  const [query, setQuery] = useState('')
  const [showCritAll, setShowCritAll] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const [showDismissed, setShowDismissed] = useState(false)

  const persistDismissed = (next: Set<string>) => {
    setDismissed(next)
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]))
  }
  const dismiss = (a: AlertTrigger) => persistDismissed(new Set(dismissed).add(alertKey(a)))

  const watch = useMutation({
    mutationFn: (ticker: string) => addToWatchlist(ticker),
    onSuccess: (_d, ticker) => {
      qc.invalidateQueries({ queryKey: ['watchlist'] })
      toast('success', `Added ${ticker} to watchlist`)
    },
    onError: (e) =>
      toast('error', e instanceof ApiError ? e.message : 'Could not add to watchlist'),
  })
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      toggleAlertRule(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
    onError: (e) =>
      toast('error', e instanceof ApiError ? e.message : 'Could not update the rule'),
  })
  const remove = useMutation({
    mutationFn: (id: number) => deleteAlertRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      toast('success', 'Rule removed')
    },
    onError: (e) =>
      toast('error', e instanceof ApiError ? e.message : 'Could not remove the rule'),
  })

  const triggered = useMemo(() => data?.triggered ?? [], [data])
  const dismissedCount = useMemo(
    () => triggered.filter((a) => dismissed.has(alertKey(a))).length,
    [triggered, dismissed],
  )

  // one filter pipeline → critical cluster + the grouped tail
  const { criticals, groups, visibleCount } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = triggered.filter((a) => {
      if (!showDismissed && dismissed.has(alertKey(a))) return false
      if (tierFilter && a.tier !== tierFilter) return false
      if (kindFilter.size > 0 && !kindFilter.has(groupOf(a.kind))) return false
      if (q && !a.ticker.toLowerCase().includes(q) && !(a.name ?? '').toLowerCase().includes(q))
        return false
      return true
    })
    const crit = visible.filter((a) => a.tier === 'critical')
    const rest = visible.filter((a) => a.tier !== 'critical')
    const gs = GROUPS.map((g) => ({
      ...g,
      rows: rest
        .filter((a) => groupOf(a.kind) === g.key)
        .sort((x, y) => y.magnitude - x.magnitude),
    })).filter((g) => g.rows.length > 0)
    return { criticals: crit, groups: gs, visibleCount: visible.length }
  }, [triggered, tierFilter, kindFilter, query, dismissed, showDismissed])

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-[220px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  const { rules, summary, as_of } = data
  const tierCounts: Record<AlertTier, number> = {
    critical: summary.critical,
    elevated: summary.elevated,
    routine: summary.routine,
  }
  const byGroup: Record<GroupKey, number> = { factor: 0, insider: 0, '8k': 0, review: 0 }
  for (const [kind, n] of Object.entries(summary.by_kind))
    byGroup[groupOf(kind as AlertKind)] += n

  const toggleGroup = (g: GroupKey) => {
    const next = new Set(kindFilter)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    setKindFilter(next)
  }
  const critShown = showCritAll ? criticals : criticals.slice(0, CRIT_CAP)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Alerts">
          Whole-market scan — the biggest factor moves, largest insider buys and high-signal
          8-Ks across the entire universe, ranked by what matters most. Refreshed nightly; your
          watchlist&apos;s own changes live on the Watchlist tab.
        </PageHeader>
        {as_of && (
          <span className="mt-1 flex-none rounded-full bg-sky-100 px-2.5 py-1 text-[0.68rem] font-semibold text-sky-700">
            as of {fmtShortDate(as_of)} · nightly
          </span>
        )}
      </div>

      {triggered.length === 0 ? (
        <SectionCard title="Triggered now (0)">
          <p className="text-[0.85rem] text-gray-400">
            All clear — nothing tripped your rules from the prior session. Add or adjust rules below.
          </p>
        </SectionCard>
      ) : (
        <>
          <TriageStrip
            counts={tierCounts}
            total={triggered.length}
            tierFilter={tierFilter}
            setTierFilter={setTierFilter}
          />
          <FilterBar
            byGroup={byGroup}
            kindFilter={kindFilter}
            toggleGroup={toggleGroup}
            query={query}
            setQuery={setQuery}
          />

          {/* Needs attention — the loud, capped critical cluster */}
          <section className="rounded-card border border-red-200 bg-red-50/40 p-4 shadow-card">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-base font-bold text-gray-900">Needs attention</h2>
              {criticals.length > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[0.68rem] font-bold text-red-700">
                  {criticals.length}
                </span>
              )}
            </div>
            {criticals.length === 0 ? (
              summary.critical === 0 ? (
                <p className="text-[0.83rem] font-medium text-emerald-700">
                  ✓ No critical signals — nothing demands action today.
                </p>
              ) : (
                <p className="text-[0.82rem] text-slate-400">No critical signals match your filters.</p>
              )
            ) : (
              <div className="space-y-1.5">
                {critShown.map((a) => (
                  <AlertRow
                    key={alertKey(a)}
                    a={a}
                    watched={watchSet.has(a.ticker)}
                    onWatch={(t) => watch.mutate(t)}
                    onDismiss={dismiss}
                  />
                ))}
                {criticals.length > CRIT_CAP && (
                  <button
                    type="button"
                    onClick={() => setShowCritAll((v) => !v)}
                    className="w-full rounded-lg py-1.5 text-[0.76rem] font-semibold text-red-700 hover:bg-red-100/60"
                  >
                    {showCritAll ? 'Show less' : `+${criticals.length - CRIT_CAP} more critical`}
                  </button>
                )}
              </div>
            )}
          </section>

          {/* The rest — kind-grouped collapsibles */}
          {groups.length > 0 ? (
            <div className="space-y-3">
              {groups.map((g) => (
                <KindGroup
                  key={g.key}
                  group={g}
                  rows={g.rows}
                  watchSet={watchSet}
                  onWatch={(t) => watch.mutate(t)}
                  onDismiss={dismiss}
                />
              ))}
            </div>
          ) : (
            visibleCount === 0 &&
            criticals.length === 0 && (
              <p className="px-1 text-[0.84rem] text-gray-400">No matching signals.</p>
            )
          )}

          {(dismissedCount > 0 || showDismissed) && (
            <button
              type="button"
              onClick={() => {
                if (showDismissed) persistDismissed(new Set())
                setShowDismissed((v) => !v)
              }}
              className="text-[0.76rem] font-medium text-slate-400 hover:text-slate-600"
            >
              {showDismissed ? 'Hide & clear dismissed' : `${dismissedCount} dismissed · show`}
            </button>
          )}
        </>
      )}

      <SectionCard title="Rules" hint="Toggle off to silence without deleting.">
        <div className="space-y-2">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-lg border border-[#eef1f6] px-3 py-2"
            >
              <button
                type="button"
                onClick={() => toggle.mutate({ id: r.id, enabled: !r.enabled })}
                className={
                  'flex-none rounded-full px-2 py-0.5 text-[0.66rem] font-bold uppercase tracking-wide ' +
                  (r.enabled
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-400')
                }
              >
                {r.enabled ? 'On' : 'Off'}
              </button>
              <span className="min-w-0 flex-1 text-[0.84rem] text-slate-700">
                <span className="font-semibold text-gray-900">{RULE_LABELS[r.rule_type]}</span>
                <span className="text-gray-400"> — {ruleDescription(r)}</span>
              </span>
              <button
                type="button"
                onClick={() => remove.mutate(r.id)}
                className="flex-none text-[0.78rem] font-semibold text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          {rules.length === 0 && (
            <p className="text-[0.85rem] text-gray-400">No rules yet — add one below.</p>
          )}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <AddRuleForm />
        </div>
      </SectionCard>
    </div>
  )
}
