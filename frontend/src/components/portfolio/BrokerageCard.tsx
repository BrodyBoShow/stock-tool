import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { InfoTip } from '@/components/ui/InfoTip'
import { SectionCard } from '@/components/ui/SectionCard'
import { useToast } from '@/components/ui/Toast'
import {
  connectPortfolioLink,
  deletePortfolioLink,
  getPortfolioLinks,
  syncPortfolioLink,
} from '@/lib/api'
import { fmtDate } from '@/lib/format'

/** "2 hours ago"-style relative time from an ISO timestamp. Falls back to the
 * absolute date once it's more than a week old. */
function relTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return fmtDate(iso.slice(0, 10))
}

function statusDotClass(status: string): string {
  if (status === 'active') return 'bg-green-500 ring-2 ring-green-200'
  if (status === 'error') return 'bg-red-500'
  return 'bg-amber-400'
}

/** Brokerage connection card — restyle of LinkedAccountsSection with identical
 * behavior: list linked accounts, connect a provider (SnapTrade OAuth — read-only,
 * we never see your password), sync now, disconnect. Re-syncing is duplicate-safe. */
export function BrokerageCard(): JSX.Element | null {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const { data } = useQuery({
    queryKey: ['portfolio', 'links'],
    queryFn: getPortfolioLinks,
    staleTime: 60 * 1000,
  })
  const providers = data?.providers ?? []
  const accounts = data?.accounts ?? []

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['portfolio', 'links'] })
    void qc.invalidateQueries({ queryKey: ['portfolio'] })
    void qc.invalidateQueries({ queryKey: ['portfolio', 'transactions'] })
  }

  const connectM = useMutation({
    mutationFn: (provider: string) => connectPortfolioLink(provider),
    onSuccess: (res) => {
      if (res.status === 'authorize' && res.authorize_url) {
        // Standard OAuth: leave to SnapTrade to authorize, return via the callback.
        window.location.href = res.authorize_url
      } else {
        toast('error', res.detail ?? 'That provider isn’t available yet.')
      }
    },
    onError: (e: Error) => toast('error', e.message),
  })

  // Surface the OAuth callback result (we return to /portfolio?linked=ok|error).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const linked = p.get('linked')
    if (!linked) return
    if (linked === 'ok') {
      toast('success', 'Brokerage linked! Click "Sync now" to import your transactions.')
    } else {
      toast('error', 'Linking failed or was cancelled — try Connect again.')
    }
    void qc.invalidateQueries({ queryKey: ['portfolio', 'links'] })
    p.delete('linked')
    const qs = p.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const syncM = useMutation({
    mutationFn: (id: number) => syncPortfolioLink(id),
    onSuccess: (res) => {
      if (res.pending) {
        toast('success', 'Still linking — finish in the SnapTrade window, then click Sync again.')
      } else {
        const skip = res.skipped_count ? ` (${res.skipped_count} skipped)` : ''
        toast('success', `Synced — ${res.inserted} new transaction${res.inserted === 1 ? '' : 's'} imported${skip}.`)
      }
      refresh()
    },
    onError: (e: Error) => toast('error', e.message),
  })

  const unlinkM = useMutation({
    mutationFn: (id: number) => deletePortfolioLink(id),
    onSuccess: () => {
      toast('success', 'Account unlinked — imported history kept.')
      refresh()
    },
    onError: (e: Error) => toast('error', e.message),
  })

  const busy = connectM.isPending || syncM.isPending || unlinkM.isPending

  return (
    <SectionCard
      title="Brokerage connection"
      hint="Sync transactions automatically (read-only). Manual entries and broker imports are reconciled — duplicates flagged, never silently imported."
    >
      {accounts.length > 0 ? (
        <div className="space-y-2.5">
          {accounts.map((a) => {
            const connected = a.status === 'active'
            return (
              <div
                key={a.id}
                className={
                  'rounded-lg border p-4 flex flex-wrap items-center gap-4 ' +
                  (connected
                    ? 'bg-gradient-to-r from-green-50 to-white border-green-200'
                    : 'border-gray-200 bg-white')
                }
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${statusDotClass(a.status)}`}
                    aria-hidden="true"
                  />
                  <span className="font-semibold text-[0.8rem] text-slate-800">
                    Connected to {a.display_name ?? a.provider}
                  </span>
                </span>
                <span className="flex-1 min-w-[220px] text-[0.72rem] text-slate-500">
                  <span className="block">
                    last sync{' '}
                    {a.last_synced_at ? relTime(a.last_synced_at) : 'never'}
                  </span>
                  <span className="block">status: {a.status}</span>
                  {a.last_error && (
                    <span className="block text-[0.68rem] text-red-600">{a.last_error}</span>
                  )}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => syncM.mutate(a.id)}
                    className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[0.74rem] font-semibold text-white transition-shadow hover:shadow-[0_2px_10px_rgba(79,70,229,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600/40 disabled:opacity-50"
                  >
                    {syncM.isPending ? 'Syncing…' : 'Sync now'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmId(a.id)}
                    className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-[0.74rem] font-semibold text-slate-500 transition-colors hover:border-red-200 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600/40 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {providers.map((p) => {
            const ready = p.implemented && p.configured
            const label = !p.implemented
              ? 'Coming soon'
              : p.configured
                ? 'Ready to connect'
                : 'Add API keys to .env'
            return (
              <div
                key={p.key}
                className="flex items-center justify-between rounded-xl border border-gray-200 bg-[#fafbff] px-4 py-3"
              >
                <div>
                  <div className="text-[0.9rem] font-bold text-slate-800">{p.label}</div>
                  <div className="flex items-center text-[0.72rem] text-slate-400">
                    {label}
                    {label === 'Add API keys to .env' && (
                      <InfoTip text="These credentials live in the backend .env — add this provider's API keys there and restart the API to enable Connect. Read-only: your password is entered at the broker, never here." />
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!ready || busy}
                  onClick={() => connectM.mutate(p.key)}
                  className={
                    'rounded-full px-3.5 py-1.5 text-[0.74rem] font-semibold transition-shadow ' +
                    (ready
                      ? 'bg-indigo-600 text-white hover:shadow-[0_2px_10px_rgba(79,70,229,0.4)] disabled:opacity-50'
                      : 'cursor-not-allowed bg-slate-100 text-gray-400')
                  }
                >
                  {!p.implemented ? 'Soon' : connectM.isPending ? 'Opening…' : 'Connect'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {data && !data.ready && (
        <p className="mt-3 text-[0.72rem] text-gray-400">
          Setup pending — apply migration 0021_linked_accounts to enable account linking.
        </p>
      )}
      <p className="mt-2 text-[0.66rem] text-slate-400">
        Auto-sync runs with the nightly data job when configured.
      </p>

      <ConfirmDialog
        open={confirmId !== null}
        title="Disconnect brokerage?"
        message="Stops automatic syncing for this account. Transactions already imported are kept in your ledger."
        confirmLabel="Disconnect"
        danger
        pending={unlinkM.isPending}
        onConfirm={() => {
          if (confirmId !== null) unlinkM.mutate(confirmId)
          setConfirmId(null)
        }}
        onCancel={() => setConfirmId(null)}
      />
    </SectionCard>
  )
}
