import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useToast } from '@/components/ui/Toast'
import { ApiError, generateFilingQa, getFilingQaStatus } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type { FilingAnswers, FilingTopicAnswer } from '@/types/api'

const LABEL = 'text-[0.67rem] font-bold uppercase tracking-[0.06em] text-[#6b7280]'

function TopicCard({ t }: { t: FilingTopicAnswer }) {
  return (
    <div
      className={`rounded-xl border p-3.5 ${
        t.disclosed
          ? 'border-[#e5e7eb] bg-white'
          : 'border-dashed border-[#e5e7eb] bg-[#fafafa]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[0.82rem] font-bold text-[#111827]">{t.topic}</div>
        <span
          className={`flex-none rounded-full px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.04em] ${
            t.disclosed
              ? 'bg-[#ecfdf5] text-[#047857]'
              : 'bg-[#f1f5f9] text-[#94a3b8]'
          }`}
        >
          {t.disclosed ? 'disclosed' : 'not disclosed'}
        </span>
      </div>
      <p className="mt-1.5 text-[0.85rem] leading-relaxed text-[#1e293b]">
        {t.finding}
      </p>
      {t.evidence && (
        <p className="mt-2 border-l-2 border-[#c7d2fe] pl-2.5 text-[0.76rem] italic leading-relaxed text-[#64748b]">
          {t.evidence}
        </p>
      )}
    </div>
  )
}

function AnswersBody({ data }: { data: FilingAnswers }) {
  const a = data.answers
  return (
    <div className="space-y-4">
      <p className="text-[0.9rem] font-medium leading-relaxed text-[#111827]">
        {a.executive_read}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {a.topics.map((t, i) => (
          <TopicCard key={i} t={t} />
        ))}
      </div>

      {a.notable_disclosures.length > 0 && (
        <div>
          <div className={LABEL}>Notable disclosures</div>
          <ul className="mt-1 space-y-1.5">
            {a.notable_disclosures.map((n, i) => (
              <li key={i} className="flex gap-2 text-[0.85rem] leading-relaxed text-[#1e293b]">
                <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-[#94a3b8]" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.unanswered.length > 0 && (
        <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-3.5">
          <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-[#b45309]">
            Not answerable from the filings
          </div>
          <ul className="mt-1 space-y-1.5">
            {a.unanswered.map((u, i) => (
              <li key={i} className="flex gap-2 text-[0.82rem] leading-relaxed text-[#78350f]">
                <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-[#d97706]" />
                <span>{u}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-[#f1f5f9] pt-3 text-[0.7rem] text-[#9ca3af]">
        Answered strictly from the {data.form} ({data.accession_no}) Items
        1/1A/7/7A + latest 10-Q via {data.model ?? 'Claude'} ·{' '}
        {fmtDate(data.generated_at.slice(0, 10))} — grounded in the filing text,
        not investment advice.
      </p>
    </div>
  )
}

/**
 * Deep filing diligence (Phase 14). On demand, Claude (Opus) reads the latest
 * 10-K (Items 1/1A/7/7A) + 10-Q MD&A and answers a fixed analyst diligence
 * framework — the questions the factor score is blind to (hedging, capital
 * commitments, concentration, litigation), each grounded with a citation or
 * honestly marked "not disclosed." Generation is the most expensive call in
 * the app, so it's explicit (a button), then cached per annual filing.
 */
export function FilingAnswersPanel({ ticker }: { ticker: string }) {
  const qc = useQueryClient()
  const toast = useToast()

  const { data, isPending, error } = useQuery({
    queryKey: ['filing-qa', ticker],
    queryFn: () => getFilingQaStatus(ticker),
    staleTime: 10 * 60 * 1000,
  })

  const gen = useMutation({
    mutationFn: () => generateFilingQa(ticker),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['filing-qa', ticker] })
      toast('success', 'Deep filing analysis ready')
    },
    onError: (e) =>
      toast(
        'error',
        e instanceof ApiError ? e.message : 'Could not run the filing analysis',
      ),
  })

  return (
    <section className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-bold text-[#111827]">
            Deep filing analysis
          </div>
          <div className="mt-0.5 text-[0.78rem] text-[#6b7280]">
            Analyst diligence answered from the 10-K (Items 1/1A/7/7A) + 10-Q —
            hedging, debt, commitments, concentration, litigation. Context, not
            advice.
          </div>
        </div>
        {data?.has_filing && data.answers && (
          <button
            type="button"
            onClick={() => gen.mutate()}
            disabled={gen.isPending}
            className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-1.5 text-[0.78rem] font-semibold text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-50"
          >
            {gen.isPending ? 'Re-analyzing…' : 'Re-analyze'}
          </button>
        )}
      </div>

      <div className="mt-4">
        {isPending ? (
          <p className="text-[0.85rem] text-[#9ca3af]">Loading…</p>
        ) : error ? (
          <p className="text-[0.85rem] text-[#b91c1c]">
            Couldn’t load filing-analysis status.
          </p>
        ) : !data.has_filing ? (
          <p className="text-[0.85rem] text-[#9ca3af]">
            No 10-K on file for {ticker} to analyze yet.
          </p>
        ) : data.answers ? (
          <AnswersBody data={data.answers} />
        ) : gen.isPending ? (
          <div className="flex items-center gap-3 rounded-xl border border-[#e5e7eb] bg-[#fafbff] p-5">
            <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-[#c7d2fe] border-t-[#4f46e5]" />
            <p className="text-[0.85rem] text-[#475569]">
              Reading {ticker}’s 10-K and 10-Q and working through the diligence
              framework — this is the deep one, give it up to a minute.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#c7d2fe] bg-[#fafbff] p-5 text-center">
            <p className="text-[0.88rem] font-semibold text-[#1e293b]">
              Answer the open questions from the filings
            </p>
            <p className="mx-auto mt-1 max-w-lg text-[0.8rem] text-[#64748b]">
              Runs a deep, citation-grounded read of {ticker}’s latest 10-K and
              10-Q across nine diligence topics — the things the factor score
              can’t see. Cached after the first run.
            </p>
            <button
              type="button"
              onClick={() => gen.mutate()}
              disabled={gen.isPending}
              className="mt-3 inline-flex items-center rounded-lg bg-[#4f46e5] px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-[#4338ca] disabled:opacity-60"
            >
              Run deep filing analysis
            </button>
            {gen.isError && (
              <p className="mt-2 text-[0.78rem] text-[#b91c1c]">
                {gen.error instanceof ApiError
                  ? gen.error.message
                  : 'Something went wrong reaching the model or the filing.'}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
