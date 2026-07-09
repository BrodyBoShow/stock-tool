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
          Thesis <span className="text-neg">*</span>
        </label>
        <textarea
          id="thesis-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => setTouched(true)}
          rows={4}
          placeholder="Why you'd own this — the core argument."
          className={
            'mt-1 w-full resize-y rounded-lg border bg-surface px-3 py-2 text-[0.88rem] text-ink placeholder:text-subtle focus:outline-none ' +
            (touched && summaryError
              ? 'border-neg-border focus:border-red-600'
              : 'border-line focus:border-accent')
          }
        />
        {touched && summaryError && (
          <p className="mt-1 text-[0.72rem] font-medium text-neg">
            A thesis summary is required.
          </p>
        )}
      </div>

      <div>
        <label className={LABEL} htmlFor="thesis-invalidation">
          Invalidation rule <span className="font-normal normal-case text-subtle">(optional)</span>
        </label>
        <textarea
          id="thesis-invalidation"
          value={invalidation}
          onChange={(e) => setInvalidation(e.target.value)}
          rows={2}
          placeholder="What would prove this wrong and make you sell."
          className="mt-1 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[0.88rem] text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="thesis-review">
          Review date <span className="font-normal normal-case text-subtle">(optional)</span>
        </label>
        <input
          id="thesis-review"
          type="date"
          value={reviewDate ?? ''}
          onChange={(e) => setReviewDate(e.target.value)}
          className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2 text-[0.88rem] text-ink focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2.5 pt-1">
        <button
          type="submit"
          disabled={save.isPending || summaryError}
          className="rounded-lg bg-accent-solid px-4 py-1.5 text-[0.82rem] font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : hasExisting ? 'Save changes' : 'Save thesis'}
        </button>
        {hasExisting && (
          <button
            type="button"
            onClick={onClose}
            disabled={save.isPending}
            className="rounded-lg border border-line bg-surface px-3.5 py-1.5 text-[0.82rem] font-semibold text-muted hover:bg-surface-2 disabled:opacity-50"
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
        <p className="mt-1 whitespace-pre-wrap text-[0.9rem] leading-relaxed text-ink">
          {thesis.summary}
        </p>
      </div>

      {thesis.invalidation_rules && (
        <div>
          <div className={LABEL}>Invalidation rule</div>
          <p className="mt-1 whitespace-pre-wrap text-[0.88rem] leading-relaxed text-muted">
            {thesis.invalidation_rules}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
        {thesis.review_date && (
          <div className="flex items-center gap-2">
            <span className={LABEL}>Review</span>
            <span className="text-[0.82rem] font-semibold text-ink">
              {fmtDate(thesis.review_date)}
            </span>
            {thesis.review_due && (
              <span className="rounded-full border border-neg-border bg-neg-soft px-2 py-0.5 text-[0.68rem] font-bold text-neg">
                Review due
              </span>
            )}
          </div>
        )}
        <span className="text-[0.72rem] text-subtle">
          Updated {fmtDate(thesis.updated_at.slice(0, 10))}
        </span>
      </div>

      <div className="flex items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-line bg-surface px-3.5 py-1.5 text-[0.82rem] font-semibold text-ink hover:bg-surface-2"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="rounded-lg px-3 py-1.5 text-[0.82rem] font-semibold text-neg hover:bg-neg-soft"
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
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div className="text-base font-bold text-ink">Investment thesis</div>
        {thesis && thesis.review_due && !editing && (
          <span className="rounded-full border border-neg-border bg-neg-soft px-2.5 py-0.5 text-[0.7rem] font-bold text-neg">
            Review due
          </span>
        )}
      </div>

      <div className="mt-3">
        {isPending ? (
          <p className="text-[0.85rem] text-subtle">Loading…</p>
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
          <div className="rounded-xl border border-dashed border-line bg-[var(--surface)] p-5 text-center">
            <p className="text-[0.85rem] font-semibold text-ink">
              No thesis for {ticker} yet
            </p>
            <p className="mx-auto mt-1 max-w-md text-[0.8rem] text-subtle">
              Write down why you’d own it and what would change your mind — you’ll
              get a review reminder on the date you set.
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-3 inline-flex items-center rounded-lg bg-accent-solid px-4 py-1.5 text-[0.82rem] font-semibold text-accent-ink hover:bg-accent-hover"
            >
              Add thesis
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
