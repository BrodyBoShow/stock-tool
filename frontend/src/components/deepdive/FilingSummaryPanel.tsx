import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useToast } from '@/components/ui/Toast'
import { ApiError, generateSummary, getSummaryStatus } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type { FilingRow, FilingSummary } from '@/types/api'

const LABEL =
  'text-[0.67rem] font-bold uppercase tracking-[0.06em] text-[#6b7280]'

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[0.86rem] leading-relaxed text-[#1e293b]">
          <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-[#94a3b8]" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

function SummaryBody({
  summary,
  docUrl,
}: {
  summary: FilingSummary
  docUrl: string | null
}) {
  const s = summary.summary
  return (
    <div className="space-y-4">
      <p className="text-[0.9rem] leading-relaxed text-[#334155]">{s.overview}</p>

      <div>
        <div className={LABEL}>What changed this year</div>
        <BulletList items={s.what_changed} />
      </div>
      <div>
        <div className={LABEL}>Key risk factors</div>
        <BulletList items={s.risk_factors} />
      </div>
      <div>
        <div className={LABEL}>Key metrics</div>
        <BulletList items={s.key_metrics} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#f1f5f9] pt-3 text-[0.7rem] text-[#9ca3af]">
        <span>
          AI-generated from the {summary.form} ({summary.accession_no}) via{' '}
          {summary.model ?? 'Claude'} · {fmtDate(summary.generated_at.slice(0, 10))}
        </span>
        {docUrl && (
          <a
            href={docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#4f46e5] hover:underline"
          >
            View filing on SEC ↗
          </a>
        )}
      </div>
    </div>
  )
}

/**
 * AI filing summary (Phase 10). Reads the cached summary status; if none exists
 * the user can generate one on demand (Claude reads the latest 10-K's MD&A +
 * Risk Factors). Honest-instrument framing: it summarizes the filing, it does
 * not advise.
 */
export function FilingSummaryPanel({
  ticker,
  filings,
}: {
  ticker: string
  filings: FilingRow[]
}) {
  const qc = useQueryClient()
  const toast = useToast()

  const { data, isPending, error } = useQuery({
    queryKey: ['summary', ticker],
    queryFn: () => getSummaryStatus(ticker),
    staleTime: 10 * 60 * 1000,
  })

  const gen = useMutation({
    mutationFn: () => generateSummary(ticker),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['summary', ticker] })
      toast('success', 'Filing summary generated')
    },
    onError: (e) =>
      toast(
        'error',
        e instanceof ApiError ? e.message : 'Could not generate the summary',
      ),
  })

  // SEC link for the summarized 10-K (match by accession when we know it)
  const docUrl =
    filings.find(
      (f) => f.accession_no === (data?.summary?.accession_no ?? data?.latest_accession),
    )?.primary_doc_url ?? null

  return (
    <section className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-bold text-[#111827]">Filing summary</div>
          <div className="mt-0.5 text-[0.78rem] text-[#6b7280]">
            AI summary of the latest 10-K (MD&amp;A + Risk Factors) — context, not advice.
          </div>
        </div>
        {data?.summary && (
          <button
            type="button"
            onClick={() => gen.mutate()}
            disabled={gen.isPending}
            className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-1.5 text-[0.78rem] font-semibold text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-50"
          >
            {gen.isPending ? 'Regenerating…' : 'Regenerate'}
          </button>
        )}
      </div>

      <div className="mt-4">
        {isPending ? (
          <p className="text-[0.85rem] text-[#9ca3af]">Loading…</p>
        ) : error ? (
          <p className="text-[0.85rem] text-[#b91c1c]">
            Couldn’t load summary status.
          </p>
        ) : !data?.has_filing ? (
          <p className="text-[0.85rem] text-[#9ca3af]">
            No 10-K on file for {ticker} yet — a summary will be available once one
            is filed.
          </p>
        ) : data.summary ? (
          <SummaryBody summary={data.summary} docUrl={docUrl} />
        ) : (
          <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#fafbff] p-5 text-center">
            <p className="text-[0.85rem] font-semibold text-[#374151]">
              No summary generated yet
            </p>
            <p className="mx-auto mt-1 max-w-md text-[0.8rem] text-[#9ca3af]">
              Generate a plain-language read of {ticker}’s latest 10-K
              {data.latest_filed_date
                ? ` (filed ${fmtDate(data.latest_filed_date)})`
                : ''}{' '}
              — overview, what changed, key risks, and key metrics.
            </p>
            <button
              type="button"
              onClick={() => gen.mutate()}
              disabled={gen.isPending}
              className="mt-3 inline-flex items-center rounded-lg bg-[#4f46e5] px-4 py-1.5 text-[0.82rem] font-semibold text-white hover:bg-[#4338ca] disabled:opacity-60"
            >
              {gen.isPending ? 'Generating… (up to a minute)' : 'Generate AI summary'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
