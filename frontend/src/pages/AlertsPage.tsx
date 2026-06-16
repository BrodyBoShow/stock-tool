import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorCard } from '@/components/ErrorCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/Toast'
import {
  ApiError,
  createAlertRule,
  deleteAlertRule,
  getAlerts,
  toggleAlertRule,
} from '@/lib/api'
import type { AlertRule, AlertRuleType } from '@/types/api'

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
      <label className="flex flex-col gap-1 text-[0.72rem] font-semibold text-[#64748b]">
        Condition
        <select
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value as AlertRuleType)}
          className="rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[0.82rem] font-medium text-[#1e293b]"
        >
          {Object.entries(RULE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </label>

      {THRESHOLD_TYPES.has(ruleType) && (
        <label className="flex flex-col gap-1 text-[0.72rem] font-semibold text-[#64748b]">
          Threshold
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-24 rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[0.82rem] text-[#1e293b]"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-[0.72rem] font-semibold text-[#64748b]">
        Ticker (optional)
        <input
          type="text"
          value={ticker}
          placeholder="whole market"
          onChange={(e) => setTicker(e.target.value)}
          className="w-32 rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[0.82rem] uppercase text-[#1e293b] placeholder:normal-case placeholder:text-[#cbd5e1]"
        />
      </label>

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className="rounded-lg bg-[#4f46e5] px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-[#4338ca] disabled:opacity-50"
      >
        {create.isPending ? 'Adding…' : 'Add rule'}
      </button>
    </div>
  )
}

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

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-[200px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  const { triggered, rules } = data

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold text-[#111827]">Alerts</h1>
        <p className="mt-0.5 text-[0.82rem] text-[#6b7280]">
          Whole-market scan — biggest factor movers, largest insider buys, and high-signal
          8-Ks across the entire universe. Refreshed from the nightly pipeline (so each
          morning reflects the prior session); your watchlist&apos;s own changes live on the
          Watchlist tab.
        </p>
      </div>

      <SectionCard
        title={`Triggered now (${triggered.length})`}
        hint="What currently matches your rules across the whole market."
      >
        {triggered.length === 0 ? (
          <p className="text-[0.85rem] text-[#9ca3af]">
            Nothing triggered right now. Add or adjust rules below.
          </p>
        ) : (
          <div className="space-y-2">
            {triggered.map((t, i) => (
              <div
                key={`${t.rule_id}-${t.security_id}-${i}`}
                className={
                  'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ' +
                  (t.severity === 'warn'
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-sky-200 bg-sky-50')
                }
              >
                <span
                  className={
                    'flex-none rounded px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide ' +
                    (t.severity === 'warn'
                      ? 'bg-amber-200 text-amber-800'
                      : 'bg-sky-200 text-sky-800')
                  }
                >
                  {t.rule_label}
                </span>
                <Link
                  to={`/securities/${t.ticker}`}
                  className="w-16 flex-none font-bold text-[#111827] hover:text-[#4f46e5] hover:underline"
                >
                  {t.ticker}
                </Link>
                <span className="min-w-0 flex-1 text-[0.85rem] text-[#1e293b]">{t.message}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

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
                    : 'bg-[#f1f5f9] text-[#94a3b8]')
                }
              >
                {r.enabled ? 'On' : 'Off'}
              </button>
              <span className="min-w-0 flex-1 text-[0.84rem] text-[#334155]">
                <span className="font-semibold text-[#111827]">{RULE_LABELS[r.rule_type]}</span>
                <span className="text-[#9ca3af]"> — {ruleDescription(r)}</span>
              </span>
              <button
                type="button"
                onClick={() => remove.mutate(r.id)}
                className="flex-none text-[0.78rem] font-semibold text-[#dc2626] hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          {rules.length === 0 && (
            <p className="text-[0.85rem] text-[#9ca3af]">No rules yet — add one below.</p>
          )}
        </div>
        <div className="mt-4 border-t border-[#f1f5f9] pt-4">
          <AddRuleForm />
        </div>
      </SectionCard>
    </div>
  )
}
