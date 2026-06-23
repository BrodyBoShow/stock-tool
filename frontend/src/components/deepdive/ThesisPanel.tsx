import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { ApiError, deleteThesis, getTheses, upsertThesis } from '@/lib/api'
import { PANEL_LABEL as LABEL } from '@/lib/constants'
import { fmtDate } from '@/lib/format'
import type { ThesisRow } from '@/types/api'

function ThesisForm({
  ticker,
  existing,
  onClose,
  hasExisting,
}: {
  ticker: string
  existing: ThesisRow | null
  onClose: () => void
  hasExisting: boolean
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [summary, setSummary] = useState(existing?.summary ?? '')
  const [invalidation, setInvalidation] = useState(existing?.invalidation_rules ?? '')
  const [reviewDate, setReviewDate] = useState(existing?.review_date ?? '')
  const [touched, setTouched] = useState(false)

  const summaryError = summary.trim().length === 0

  const save = useMutation({
    mutationFn: () =>
      upsertThesis(ticker, {
        summary: summary.trim(),
        invalidation_rules: invalidation.trim() || null,
        review_date: reviewDate || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['theses'] })
      toast('success', hasExisting ? 'Thesis updated' : 'Thesis saved')
      onClose()
    },
    onError: (e) =>
      toast('error', e instanceof ApiError ? e.message : 'Could not save thesis'),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (summaryError) return
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div>
        <label className={LABEL} htmlFor="thesis-summary">
          Thesis <span className="text-red-600">*</span>
        </label>
        <textarea
          id="thesis-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => setTouched(true)}
          rows={4}
          placeholder="Why you'd own this — the core argument."
          className={
            'mt-1 w-full resize-y rounded-lg border bg-white px-3 py-2 text-[0.88rem] text-gray-900 placeholder:text-gray-400 focus:outline-none ' +
            (touched && summaryError
              ? 'border-red-300 focus:border-red-600'
              : 'border-gray-200 focus:border-indigo-600')
          }
        />
        {touched && summaryError && (
          <p className="mt-1 text-[0.72rem] font-medium text-red-600">
            A thesis summary is required.
          </p>
        )}
      </div>

      <div>
        <label className={LABEL} htmlFor="thesis-invalidation">
          Invalidation rule <span className="font-normal normal-case text-gray-400">(optional)</span>
        </label>
        <textarea
          id="thesis-invalidation"
          value={invalidation}
          onChange={(e) => setInvalidation(e.target.value)}
          rows={2}
          placeholder="What would prove this wrong and make you sell."
          className="mt-1 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-[0.88rem] text-gray-900 placeholder:text-gray-400 focus:border-indigo-600 focus:outline-none"
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="thesis-review">
          Review date <span className="font-normal normal-case text-gray-400">(optional)</span>
        </label>
        <input
          id="thesis-review"
          type="date"
          value={reviewDate ?? ''}
          onChange={(e) => setReviewDate(e.target.value)}
          className="mt-1 block rounded-lg border border-gray-200 bg-white px-3 py-2 text-[0.88rem] text-gray-900 focus:border-indigo-600 focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2.5 pt-1">
        <button
          type="submit"
          disabled={save.isPending || summaryError}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[0.82rem] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : hasExisting ? 'Save changes' : 'Save thesis'}
        </button>
        {hasExisting && (
          <button
            type="button"
            onClick={onClose}
            disabled={save.isPending}
            className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-[0.82rem] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

function ThesisView({
  thesis,
  ticker,
  onEdit,
}: {
  thesis: ThesisRow
  ticker: string
  onEdit: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const del = useMutation({
    mutationFn: () => deleteThesis(ticker),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['theses'] })
      toast('success', 'Thesis deleted')
      setConfirmOpen(false)
    },
    onError: (e) => {
      toast('error', e instanceof ApiError ? e.message : 'Could not delete thesis')
      setConfirmOpen(false)
    },
  })

  return (
    <div className="space-y-3.5">
      <div>
        <div className={LABEL}>Thesis</div>
        <p className="mt-1 whitespace-pre-wrap text-[0.9rem] leading-relaxed text-slate-800">
          {thesis.summary}
        </p>
      </div>

      {thesis.invalidation_rules && (
        <div>
          <div className={LABEL}>Invalidation rule</div>
          <p className="mt-1 whitespace-pre-wrap text-[0.88rem] leading-relaxed text-slate-600">
            {thesis.invalidation_rules}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
        {thesis.review_date && (
          <div className="flex items-center gap-2">
            <span className={LABEL}>Review</span>
            <span className="text-[0.82rem] font-semibold text-slate-800">
              {fmtDate(thesis.review_date)}
            </span>
            {thesis.review_due && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[0.68rem] font-bold text-red-700">
                Review due
              </span>
            )}
          </div>
        )}
        <span className="text-[0.72rem] text-gray-400">
          Updated {fmtDate(thesis.updated_at.slice(0, 10))}
        </span>
      </div>

      <div className="flex items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-[0.82rem] font-semibold text-slate-800 hover:bg-slate-50"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="rounded-lg px-3 py-1.5 text-[0.82rem] font-semibold text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete thesis"
        message={
          <>
            Delete your thesis for <strong>{ticker}</strong>? This can’t be undone.
          </>
        }
        confirmLabel="Delete"
        danger
        pending={del.isPending}
        onConfirm={() => del.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

/** Investment thesis for one ticker — reads the shared ['theses'] query. */
export function ThesisPanel({ ticker }: { ticker: string }) {
  const { data, isPending } = useQuery({
    queryKey: ['theses'],
    queryFn: getTheses,
    staleTime: 5 * 60 * 1000,
  })
  const thesis = data?.rows.find((r) => r.ticker === ticker) ?? null
  const [editing, setEditing] = useState(false)

  return (
    <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="text-base font-bold text-gray-900">Investment thesis</div>
        {thesis && thesis.review_due && !editing && (
          <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[0.7rem] font-bold text-red-700">
            Review due
          </span>
        )}
      </div>

      <div className="mt-3">
        {isPending ? (
          <p className="text-[0.85rem] text-gray-400">Loading…</p>
        ) : editing ? (
          <ThesisForm
            ticker={ticker}
            existing={thesis}
            hasExisting={Boolean(thesis)}
            onClose={() => setEditing(false)}
          />
        ) : thesis ? (
          <ThesisView thesis={thesis} ticker={ticker} onEdit={() => setEditing(true)} />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-[#fafbff] p-5 text-center">
            <p className="text-[0.85rem] font-semibold text-gray-700">
              No thesis for {ticker} yet
            </p>
            <p className="mx-auto mt-1 max-w-md text-[0.8rem] text-gray-400">
              Write down why you’d own it and what would change your mind — you’ll
              get a review reminder on the date you set.
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-3 inline-flex items-center rounded-lg bg-indigo-600 px-4 py-1.5 text-[0.82rem] font-semibold text-white hover:bg-indigo-700"
            >
              Add thesis
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
