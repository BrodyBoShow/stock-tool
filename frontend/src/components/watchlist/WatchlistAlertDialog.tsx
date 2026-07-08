import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

import { useToast } from '@/components/ui/Toast'
import { ApiError, createAlertRule, deleteAlertRule, getAlerts } from '@/lib/api'
import type { AlertRuleType } from '@/types/api'

// Only the threshold-free event rules are one-click toggles here; the
// number-based ones (rank/composite drop/rise) live in the Alerts tab.
const EVENT_ALERTS: { type: AlertRuleType; label: string; hint: string }[] = [
  { type: 'new_8k', label: 'New 8-K filing', hint: 'a material-event SEC filing is posted' },
  { type: 'insider_buy', label: 'Insider buying', hint: 'an insider reports an open-market purchase' },
  { type: 'review_due', label: 'Thesis review due', hint: 'this name’s thesis review date arrives' },
]

/** Quick per-name alert setup, opened from a watchlist row. Reflects the rules
 *  already in the Alerts engine (so a toggle is create-if-off / delete-if-on,
 *  never a duplicate), scoped to this one ticker. Portal modal, Esc/backdrop
 *  close. StockBud notifies — it never trades. */
export function WatchlistAlertDialog({
  ticker,
  onClose,
}: {
  ticker: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data } = useQuery({ queryKey: ['alerts'], queryFn: getAlerts, staleTime: 60_000 })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const ruleFor = (type: AlertRuleType) =>
    (data?.rules ?? []).find(
      (r) => r.scope === 'ticker' && r.ticker === ticker && r.rule_type === type,
    )

  const invalidate = () => qc.invalidateQueries({ queryKey: ['alerts'] })
  const create = useMutation({
    mutationFn: (type: AlertRuleType) =>
      createAlertRule({ rule_type: type, scope: 'ticker', ticker }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: number) => deleteAlertRule(id),
    onSuccess: invalidate,
  })
  const pending = create.isPending || remove.isPending

  const onErr = (e: unknown) =>
    toast('error', e instanceof ApiError ? e.message : 'Could not update the alert')

  const toggle = (type: AlertRuleType) => {
    const existing = ruleFor(type)
    if (existing) {
      remove.mutate(existing.id, {
        onSuccess: () => toast('success', `Alert off for ${ticker}`),
        onError: onErr,
      })
    } else {
      create.mutate(type, {
        onSuccess: () => toast('success', `You’ll be alerted on ${ticker}`),
        onError: onErr,
      })
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Alerts for ${ticker}`}
        className="relative w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.25)]"
      >
        <h2 className="text-base font-bold text-gray-900">Alert me on {ticker}</h2>
        <p className="mt-0.5 text-[0.78rem] text-slate-500">
          Get notified when something material happens on this name. StockBud flags it — it
          never trades.
        </p>
        <div className="mt-4 space-y-2">
          {EVENT_ALERTS.map(({ type, label, hint }) => {
            const on = !!ruleFor(type)
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggle(type)}
                disabled={pending}
                aria-pressed={on}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                  on ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-[0.82rem] font-semibold text-slate-800">{label}</span>
                  <span className="block text-[0.7rem] text-slate-400">when {hint}</span>
                </span>
                <span
                  className={`flex-none text-[0.72rem] font-bold ${on ? 'text-indigo-600' : 'text-slate-400'}`}
                >
                  {on ? 'ON' : 'OFF'}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <Link to="/alerts" className="text-[0.72rem] font-semibold text-indigo-600 hover:underline">
            More alert options →
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-[0.82rem] font-semibold text-slate-600 hover:bg-slate-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
