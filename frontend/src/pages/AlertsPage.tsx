import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorCard } from '@/components/ErrorCard'
import { Icon } from '@/components/ui/Icon'
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
    ? 'text-pos'
    : tier === 'critical'
      ? 'text-neg'
      : tier === 'elevated'
        ? 'text-warn'
        : 'text-muted'
  const iconBox = positive
    ? 'bg-pos-soft text-pos'
    : tier === 'critical'
      ? 'bg-neg-soft text-neg'
      : tier === 'elevated'
        ? 'bg-warn-soft text-warn'
        : 'bg-surface-3 text-muted'
  const chip =
    kind === 'factor_rise'
      ? 'bg-info-soft text-info'
      : kind === 'insider'
        ? 'bg-pos-soft text-pos'
        : tier === 'critical'
          ? 'bg-neg-soft text-neg'
          : tier === 'elevated'
            ? 'bg-warn-soft text-warn'
            : 'bg-surface-3 text-muted'
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
      className={`group relative flex items-center gap-3 rounded-xl border border-line border-l-4 bg-surface px-3 py-2 hover:bg-surface-2 ${st.accent}`}
    >
      <span className={`flex-none rounded-md p-1 ${st.iconBox}`}>
        <KindIcon kind={a.kind} />
      </span>

      <Link
        to={`/securities/${a.ticker}`}
        className="flex w-[4.2rem] flex-none items-center gap-0.5 font-bold text-[0.9rem] text-ink hover:text-accent"
      >
        {watched && <Icon icon={Star} size={12} className="text-warn fill-current" />}
        <span className="truncate">{a.ticker}</span>
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`flex-none rounded px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-[0.06em] ${st.chip}`}
          >
            {KIND_LABEL[a.kind]}
          </span>
          <span className="truncate text-[0.83rem] font-medium text-ink">{headline}</span>
        </div>
        <div className="truncate text-[0.7rem] text-subtle">
          {a.name ?? a.ticker}
          {a.sector ? ` · ${a.sector}` : ''}
        </div>
      </div>

      <div className="flex-none text-right">
        <div className={`font-bold tabular-nums text-[0.92rem] leading-tight ${st.stat}`}>
          {a.magnitude_label || '—'}
        </div>
        {a.observed_date && (
          <div className="text-[0.62rem] text-subtle">{fmtShortDate(a.observed_date)}</div>
        )}
      </div>

      {/* fixed-width action column: visible on hover, never shifts layout */}
      <div className="flex w-9 flex-none items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100">
        {!watched && (
          <button
            type="button"
            onClick={() => onWatch(a.ticker)}
            title="Add to watchlist"
            className="rounded-md p-1 text-subtle hover:bg-warn-soft hover:text-warn"
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
          className="rounded-md p-1 text-subtle hover:bg-surface-3 hover:text-ink"
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
      <label className="flex flex-col gap-1 text-[0.72rem] font-semibold text-muted">
        Condition
        <select
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value as AlertRuleType)}
          className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[0.82rem] font-medium text-ink"
        >
          {Object.entries(RULE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </label>

      {THRESHOLD_TYPES.has(ruleType) && (
        <label className="flex flex-col gap-1 text-[0.72rem] font-semibold text-muted">
          Threshold
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-24 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[0.82rem] text-ink"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-[0.72rem] font-semibold text-muted">
        Ticker (optional)
        <input
          type="text"
          value={ticker}
          placeholder="whole market"
          onChange={(e) => setTicker(e.target.value)}
          className="w-32 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[0.82rem] uppercase text-ink placeholder:normal-case placeholder:text-subtle"
        />
      </label>

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className="rounded-lg bg-accent-solid px-4 py-2 text-[0.82rem] font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
      >
        {create.isPending ? 'Adding…' : 'Add rule'}
      </button>
    </div>
  )
}

// ── triage strip + filter bar ─────────────────────────────────────────────────

const TIER_TILE: Record<AlertTier, { label: string; on: string }> = {
  critical: { label: 'Critical', on: 'bg-neg-soft text-neg ring-red-400' },
  elevated: { label: 'Elevated', on: 'bg-warn-soft text-warn ring-amber-400' },
  routine: { label: 'Routine', on: 'bg-surface-3 text-muted ring-line-strong' },
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
              className="inline-flex items-center gap-1 rounded-full bg-pos-soft px-3 py-1 text-[0.75rem] font-semibold text-pos"
            >
              <Icon icon={Check} size={13} /> Quiet today
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
      <span className="ml-auto text-[0.74rem] text-subtle">{total} signals</span>
    </div>
  )
}

/** Left "filter by type" rail — a vertical list of the signal groups with live
 *  counts. The active group gets an accent left-border + surface-2 fill so the
 *  selection reads at a glance (mirrors the spec mock). */
function FilterSidebar({
  byGroup,
  kindFilter,
  toggleGroup,
  onClear,
}: {
  byGroup: Record<GroupKey, number>
  kindFilter: Set<GroupKey>
  toggleGroup: (g: GroupKey) => void
  onClear: () => void
}) {
  return (
    <aside className="rounded-card border border-line bg-surface p-2.5 lg:sticky lg:top-4">
      <div className="px-1.5 pb-2 text-[0.62rem] font-bold uppercase tracking-[0.09em] text-subtle">
        Filter by type
      </div>
      <nav className="space-y-0.5">
        {GROUPS.map((g) => {
          const n = byGroup[g.key] ?? 0
          const active = kindFilter.has(g.key)
          return (
            <button
              key={g.key}
              type="button"
              disabled={n === 0}
              onClick={() => toggleGroup(g.key)}
              className={`flex w-full items-center gap-2 rounded-lg border-l-2 px-2.5 py-1.5 text-left text-[0.8rem] font-semibold transition ${
                active
                  ? 'border-accent bg-surface-2 text-ink'
                  : 'border-transparent text-muted hover:bg-surface-2 hover:text-ink'
              } ${n === 0 ? 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted' : ''}`}
            >
              <span className="min-w-0 flex-1 truncate">{g.title}</span>
              <span
                className={`tabular-nums text-[0.72rem] ${active ? 'text-accent' : 'text-subtle'}`}
              >
                {n}
              </span>
            </button>
          )
        })}
      </nav>
      {kindFilter.size > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="mt-2 px-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.05em] text-subtle hover:text-muted"
        >
          Clear all
        </button>
      )}
    </aside>
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
  const dot = rows.some((r) => r.tier === 'elevated') ? 'bg-warn-strong' : 'bg-slate-300'
  const shown = showAll ? rows : rows.slice(0, 8)

  return (
    <details
      open={open}
      onToggle={(e) => {
        const o = (e.target as HTMLDetailsElement).open
        setOpen(o)
        localStorage.setItem(lsKey, o ? '1' : '0')
      }}
      className="rounded-card border border-line bg-surface shadow-card"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
        <span className={`h-2 w-2 flex-none rounded-full ${dot}`} />
        <span className="text-[0.92rem] font-bold text-ink">{group.title}</span>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[0.68rem] font-semibold text-muted">
          {rows.length}
        </span>
        <svg
          className={`ml-auto h-4 w-4 text-subtle transition ${open ? 'rotate-180' : ''}`}
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
            className="w-full rounded-lg py-1.5 text-[0.76rem] font-semibold text-accent hover:bg-accent-soft"
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
          <span className="mt-1 flex-none rounded-full bg-info-soft px-2.5 py-1 text-[0.68rem] font-semibold text-info">
            as of {fmtShortDate(as_of)} · nightly
          </span>
        )}
      </div>

      {triggered.length === 0 ? (
        <SectionCard title="Triggered now (0)">
          <p className="text-[0.85rem] text-subtle">
            All clear — nothing tripped your rules from the prior session. Add or adjust rules below.
          </p>
        </SectionCard>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[240px] flex-1">
              <TriageStrip
                counts={tierCounts}
                total={triggered.length}
                tierFilter={tierFilter}
                setTierFilter={setTierFilter}
              />
            </div>
            <input
              type="text"
              value={query}
              placeholder="ticker or name"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              className="w-44 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[0.78rem] text-ink placeholder:text-subtle"
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start">
            <FilterSidebar
              byGroup={byGroup}
              kindFilter={kindFilter}
              toggleGroup={toggleGroup}
              onClear={() => setKindFilter(new Set())}
            />
            <div className="space-y-4">
          {/* Needs attention — the loud, capped critical cluster */}
          <section className="rounded-card border border-neg-border bg-neg-soft p-4 shadow-card">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-base font-bold text-ink">Needs attention</h2>
              {criticals.length > 0 && (
                <span className="rounded-full bg-neg-soft px-2 py-0.5 text-[0.68rem] font-bold text-neg">
                  {criticals.length}
                </span>
              )}
            </div>
            {criticals.length === 0 ? (
              summary.critical === 0 ? (
                <p className="flex items-center gap-1 text-[0.83rem] font-medium text-pos">
                  <Icon icon={Check} size={14} /> No critical signals — nothing demands action today.
                </p>
              ) : (
                <p className="text-[0.82rem] text-subtle">No critical signals match your filters.</p>
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
                    className="w-full rounded-lg py-1.5 text-[0.76rem] font-semibold text-neg hover:bg-neg-soft"
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
              <p className="px-1 text-[0.84rem] text-subtle">No matching signals.</p>
            )
          )}

          {(dismissedCount > 0 || showDismissed) && (
            <button
              type="button"
              onClick={() => {
                if (showDismissed) persistDismissed(new Set())
                setShowDismissed((v) => !v)
              }}
              className="text-[0.76rem] font-medium text-subtle hover:text-muted"
            >
              {showDismissed ? 'Hide & clear dismissed' : `${dismissedCount} dismissed · show`}
            </button>
          )}
            </div>
          </div>
        </>
      )}

      <SectionCard title="Rules" hint="Toggle off to silence without deleting.">
        <div className="space-y-2">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-lg border border-[var(--divider)] px-3 py-2"
            >
              <button
                type="button"
                onClick={() => toggle.mutate({ id: r.id, enabled: !r.enabled })}
                className={
                  'flex-none rounded-full px-2 py-0.5 text-[0.66rem] font-bold uppercase tracking-wide ' +
                  (r.enabled
                    ? 'bg-pos-soft text-pos'
                    : 'bg-surface-3 text-subtle')
                }
              >
                {r.enabled ? 'On' : 'Off'}
              </button>
              <span className="min-w-0 flex-1 text-[0.84rem] text-ink">
                <span className="font-semibold text-ink">{RULE_LABELS[r.rule_type]}</span>
                <span className="text-subtle"> — {ruleDescription(r)}</span>
              </span>
              <button
                type="button"
                onClick={() => remove.mutate(r.id)}
                className="flex-none text-[0.78rem] font-semibold text-neg hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          {rules.length === 0 && (
            <p className="text-[0.85rem] text-subtle">No rules yet — add one below.</p>
          )}
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <AddRuleForm />
        </div>
      </SectionCard>
    </div>
  )
}
