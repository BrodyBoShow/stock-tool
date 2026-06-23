import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorCard } from '@/components/ErrorCard'
import { PageHeader } from '@/components/ui/PageHeader'
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
      <PageHeader title="Alerts">
        Whole-market scan — biggest factor movers, largest insider buys, and high-signal
        8-Ks across the entire universe. Refreshed from the nightly pipeline (so each
        morning reflects the prior session); your watchlist&apos;s own changes live on the
        Watchlist tab.
      </PageHeader>

      <SectionCard
        title={`Triggered now (${triggered.length})`}
        hint="What currently matches your rules across the whole market."
      >
        {triggered.length === 0 ? (
          <p className="text-[0.85rem] text-gray-400">
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
                  className="w-16 flex-none font-bold text-gray-900 hover:text-indigo-600 hover:underline"
                >
                  {t.ticker}
                </Link>
                <span className="min-w-0 flex-1 text-[0.85rem] text-slate-800">{t.message}</span>
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
