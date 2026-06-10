import { useState } from 'react'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { useWatchlistMutations, useWatchlistSet } from '@/hooks/useWatchlist'
import { ApiError } from '@/lib/api'

type Variant = 'button' | 'icon' | 'remove'

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 17.27 6.18 21l1.64-7.03L2 9.24l7.19-.61L12 2l2.81 6.63 7.19.61-5.82 4.73L17.82 21z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Add/remove a ticker from the watchlist. Membership comes from the shared
 * ['watchlist'] query; removes go through a confirm dialog. Errors and
 * confirmations surface as toasts. Disabled while a mutation is in flight.
 *
 * Variants: "button" (deep-dive header), "icon" (screener row star),
 * "remove" (watchlist page row).
 */
export function WatchlistButton({
  ticker,
  variant = 'button',
}: {
  ticker: string
  variant?: Variant
}) {
  const { tickers } = useWatchlistSet()
  const { add, remove } = useWatchlistMutations()
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const inList = tickers.has(ticker)
  const pending = add.isPending || remove.isPending

  const doAdd = () =>
    add.mutate(ticker, {
      onSuccess: (r) =>
        toast(
          'success',
          r.status === 'already_present'
            ? `${ticker} is already in your watchlist`
            : `Added ${ticker} to watchlist`,
        ),
      onError: (e) =>
        toast('error', e instanceof ApiError ? e.message : `Could not add ${ticker}`),
    })

  const doRemove = () =>
    remove.mutate(ticker, {
      onSuccess: () => {
        toast('success', `Removed ${ticker} from watchlist`)
        setConfirmOpen(false)
      },
      onError: (e) => {
        toast('error', e instanceof ApiError ? e.message : `Could not remove ${ticker}`)
        setConfirmOpen(false)
      },
    })

  // Adds are immediate; removes always confirm first.
  const handlePrimary = (e: React.MouseEvent) => {
    // In the screener the control lives inside a row <a>; don't navigate.
    e.preventDefault()
    e.stopPropagation()
    if (inList) setConfirmOpen(true)
    else doAdd()
  }

  const dialog = (
    <ConfirmDialog
      open={confirmOpen}
      title="Remove from watchlist"
      message={
        <>
          Remove <strong>{ticker}</strong> from your watchlist?
        </>
      }
      confirmLabel="Remove"
      danger
      pending={remove.isPending}
      onConfirm={doRemove}
      onCancel={() => setConfirmOpen(false)}
    />
  )

  if (variant === 'icon') {
    return (
      <>
        <button
          type="button"
          onClick={handlePrimary}
          disabled={pending}
          aria-pressed={inList}
          aria-label={inList ? `Remove ${ticker} from watchlist` : `Add ${ticker} to watchlist`}
          title={inList ? 'In watchlist' : 'Add to watchlist'}
          className={
            'flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40 ' +
            (inList
              ? 'text-[#f59e0b] hover:bg-amber-50'
              : 'text-[#cbd5e1] hover:bg-slate-100 hover:text-[#94a3b8]')
          }
        >
          <StarIcon filled={inList} />
        </button>
        {dialog}
      </>
    )
  }

  if (variant === 'remove') {
    return (
      <>
        <button
          type="button"
          onClick={handlePrimary}
          disabled={pending}
          aria-label={`Remove ${ticker} from watchlist`}
          className="rounded-md px-2.5 py-1 text-[0.74rem] font-semibold text-[#b91c1c] transition-colors hover:bg-red-50 disabled:opacity-40"
        >
          Remove
        </button>
        {dialog}
      </>
    )
  }

  // variant === 'button'
  return (
    <>
      <button
        type="button"
        onClick={handlePrimary}
        disabled={pending}
        aria-pressed={inList}
        className={
          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[0.82rem] font-semibold transition-colors disabled:opacity-50 ' +
          (inList
            ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
            : 'border-[#e5e7eb] bg-white text-[#1e293b] hover:bg-[#f8fafc]')
        }
      >
        <StarIcon filled={inList} />
        {inList ? 'In watchlist' : 'Add to watchlist'}
      </button>
      {dialog}
    </>
  )
}
