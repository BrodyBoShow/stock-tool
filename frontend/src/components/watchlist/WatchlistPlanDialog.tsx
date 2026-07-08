import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

import { DisclaimerChip } from '@/components/portfolio/redesign/DisclaimerChip'
import { useToast } from '@/components/ui/Toast'
import { useWatchlistMutations } from '@/hooks/useWatchlist'
import { ApiError } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type { WatchlistRow } from '@/types/api'

const FIELD =
  'mt-1 w-full resize-y rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none'
const LABEL = 'text-[0.72rem] font-semibold text-slate-600'

/**
 * Edit a watched name's decision plan: an entry target price (drives the row's
 * "% to entry" gauge) plus the free-text why / entry-trigger / kill-criteria —
 * the "write your exit reasons while you're still objective" discipline. The
 * user's own notes; StockBud never acts on them. Portal modal, Esc/backdrop close.
 */
export function WatchlistPlanDialog({
  row,
  onClose,
}: {
  row: WatchlistRow
  onClose: () => void
}) {
  const { updatePlan } = useWatchlistMutations()
  const toast = useToast()
  // Seeded once from the row. The parent remounts this dialog (via a `key` on
  // the ticker) when a different name opens it, so there's no set-state-in-effect
  // re-sync — the fresh mount reads the new row.
  const [note, setNote] = useState(row.note ?? '')
  const [target, setTarget] = useState(
    row.target_price != null ? String(row.target_price) : '',
  )
  const [entry, setEntry] = useState(row.entry_trigger ?? '')
  const [kill, setKill] = useState(row.kill_criteria ?? '')
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !updatePlan.isPending) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, updatePlan.isPending])

  const trimmed = target.trim()
  const targetNum = trimmed === '' ? null : Number(trimmed)
  // Reject anything that isn't a finite, non-negative number — e.g. "1e999"
  // parses to Infinity, which would JSON-serialize to null and vanish silently.
  const targetInvalid = targetNum != null && (!Number.isFinite(targetNum) || targetNum < 0)

  const save = () => {
    if (targetInvalid) return
    updatePlan.mutate(
      {
        ticker: row.ticker,
        body: {
          note: note.trim() || null,
          target_price: targetNum,
          entry_trigger: entry.trim() || null,
          kill_criteria: kill.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast('success', `Saved your plan for ${row.ticker}`)
          onClose()
        },
        onError: (e) =>
          toast('error', e instanceof ApiError ? e.message : `Could not save ${row.ticker}`),
      },
    )
  }

  // Whether this row already has a saved plan (drives the Clear button).
  const hasExistingPlan =
    row.target_price != null || !!row.note || !!row.entry_trigger || !!row.kill_criteria

  // Two-click clear (guards against wiping typed notes by accident): first click
  // arms it, second sends an all-null body so the partial PATCH clears every field.
  const clear = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    updatePlan.mutate(
      {
        ticker: row.ticker,
        body: { note: null, target_price: null, entry_trigger: null, kill_criteria: null },
      },
      {
        onSuccess: () => {
          toast('success', `Cleared your plan for ${row.ticker}`)
          onClose()
        },
        onError: (e) =>
          toast('error', e instanceof ApiError ? e.message : `Could not clear ${row.ticker}`),
      },
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={() => !updatePlan.isPending && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Plan for ${row.ticker}`}
        className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.25)]"
      >
        <h2 className="text-base font-bold text-gray-900">Your plan for {row.ticker}</h2>
        <p className="mt-0.5 text-[0.78rem] text-slate-500">
          The price you’d act on, and what would make you buy or drop it. Your private
          notes — StockBud never places orders.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className={LABEL}>
              Entry target price{' '}
              <span className="font-normal text-slate-400">
                (optional — drives the “% to entry” gauge)
              </span>
            </span>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-slate-400">$</span>
              <input
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={row.last_price != null ? `now ${row.last_price.toFixed(2)}` : 'e.g. 100'}
                className="w-36 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </div>
            {targetInvalid && (
              <span className="mt-1 block text-[0.7rem] font-semibold text-rose-600">
                Enter a non-negative number.
              </span>
            )}
          </label>

          <label className="block">
            <span className={LABEL}>Why I’m watching</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="the core reason this is on your radar"
              className={FIELD}
            />
          </label>

          <label className="block">
            <span className={LABEL}>What makes it a buy</span>
            <textarea
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="e.g. drops below 18× forward earnings, or breaks above its 50-day average"
              className={FIELD}
            />
          </label>

          <label className="block">
            <span className={LABEL}>What would make me drop it</span>
            <textarea
              value={kill}
              onChange={(e) => setKill(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="pre-commit your exit reasons now, while you’re objective"
              className={FIELD}
            />
          </label>
        </div>

        {/* Thesis — folded in from the retired Theses tab; written/edited on the
            deep dive, surfaced here read-only so the watch row is the one place
            you see your full case. */}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className={LABEL}>Your thesis</span>
            {row.thesis_review_due && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.6rem] font-bold text-amber-800">
                review due
              </span>
            )}
          </div>
          {row.thesis_summary ? (
            <>
              <p className="mt-1 text-[0.8rem] leading-snug text-slate-700">{row.thesis_summary}</p>
              {row.thesis_review_date && (
                <p className="mt-1 text-[0.68rem] text-slate-400">
                  Review by {fmtDate(row.thesis_review_date)}
                </p>
              )}
              <Link
                to={`/securities/${row.ticker}`}
                className="mt-1.5 inline-block text-[0.72rem] font-semibold text-indigo-600 hover:underline"
              >
                Edit on the deep dive →
              </Link>
            </>
          ) : (
            <p className="mt-1 text-[0.76rem] text-slate-400">
              No thesis yet.{' '}
              <Link
                to={`/securities/${row.ticker}`}
                className="font-semibold text-indigo-600 hover:underline"
              >
                Write one on the deep dive →
              </Link>
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DisclaimerChip variant="inline" />
            {hasExistingPlan && (
              <button
                type="button"
                onClick={clear}
                disabled={updatePlan.isPending}
                className={`rounded-lg px-2.5 py-1.5 text-[0.78rem] font-semibold transition-colors disabled:opacity-50 ${
                  confirmClear
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'text-rose-600 hover:bg-rose-50'
                }`}
                title="Remove this name's saved plan (target + notes)"
              >
                {confirmClear ? 'Confirm clear' : 'Clear plan'}
              </button>
            )}
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={updatePlan.isPending}
              className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-[0.82rem] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={updatePlan.isPending || targetInvalid}
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[0.82rem] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {updatePlan.isPending ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
