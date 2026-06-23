import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { SectionCard } from '@/components/ui/SectionCard'
import { useToast } from '@/components/ui/Toast'
import {
  connectPortfolioLink,
  deletePortfolioLink,
  getPortfolioLinks,
  syncPortfolioLink,
} from '@/lib/api'
import { fmtDate } from '@/lib/format'

/** Connect-a-brokerage card. "Connect" opens the SnapTrade portal (you log in
 * at Schwab there — read-only, we never see your password); "Sync now" pulls
 * trades/dividends into the ledger above, so the whole tab updates itself.
 * Re-syncing is duplicate-safe (de-duped by provider transaction id). */
export function LinkedAccountsSection() {
  const qc = useQueryClient()
  const toast = useToast()
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
      title="Connect a brokerage — auto-sync"
      hint="Link a broker to pull trades & dividends into the ledger above, so the tab updates itself. Strictly read-only: you log in at the broker — StockBud never sees your password and never places trades."
    >
      {accounts.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[0.84rem]"
            >
              <span className="font-semibold text-slate-800">
                {a.display_name ?? a.provider}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500">
                {a.status}
                {a.last_synced_at ? ` · ${fmtDate(a.last_synced_at.slice(0, 10))}` : ''}
              </span>
              {a.last_error && (
                <span className="text-[0.7rem] text-red-600">{a.last_error}</span>
              )}
              <span className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => syncM.mutate(a.id)}
                  className="rounded-full bg-indigo-50 px-3 py-1 text-[0.72rem] font-semibold text-indigo-600 disabled:opacity-50"
                >
                  {syncM.isPending ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => unlinkM.mutate(a.id)}
                  className="rounded-full px-3 py-1 text-[0.72rem] font-semibold text-slate-400 hover:text-red-600 disabled:opacity-50"
                >
                  Unlink
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

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
                <div className="text-[0.72rem] text-slate-400">{label}</div>
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

      {data && !data.ready && (
        <p className="mt-3 text-[0.72rem] text-gray-400">
          Setup pending — apply migration 0021_linked_accounts to enable account linking.
        </p>
      )}
      <p className="mt-2 text-[0.7rem] text-gray-400">
        Read-only. After connecting, click "Sync now" to import — it can take a moment
        after you finish the broker login while data populates. Re-syncing never
        double-imports.
      </p>
    </SectionCard>
  )
}
