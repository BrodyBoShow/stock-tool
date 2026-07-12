import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useToast } from '@/components/ui/Toast'
import {
  ApiError,
  generateFilingQa,
  generateSummary,
  getFilingQaStatus,
  getSummaryStatus,
} from '@/lib/api'
import { PANEL_LABEL as LABEL } from '@/lib/constants'
import { fmtDate } from '@/lib/format'
import type {
  FilingAnswers,
  FilingRow,
  FilingSummary,
  FilingTopicAnswer,
} from '@/types/api'

// Module-scoped guard so the Overview's auto-generate fires once per ticker even
// through React StrictMode's dev double-mount (avoids two paid Claude calls).
const autoTriggered = new Set<string>()

type Tab = 'overview' | 'diligence'

// ── shared renderers ────────────────────────────────────────────────────────

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[0.86rem] leading-relaxed text-ink">
          <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-slate-400" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

function SummaryBody({ summary, docUrl }: { summary: FilingSummary; docUrl: string | null }) {
  const s = summary.summary
  return (
    <div className="space-y-4">
      <p className="text-[0.9rem] leading-relaxed text-ink">{s.overview}</p>
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[0.7rem] text-subtle">
        <span>
          AI-generated from the {summary.form} ({summary.accession_no}) via{' '}
          {summary.model ?? 'Claude'} · {fmtDate(summary.generated_at.slice(0, 10))}
        </span>
        {docUrl && (
          <a href={docUrl} target="_blank" rel="noopener noreferrer"
            className="font-semibold text-accent hover:underline">
            View filing on SEC ↗
          </a>
        )}
      </div>
    </div>
  )
}

function TopicCard({ t }: { t: FilingTopicAnswer }) {
  return (
    <div
      className={`rounded-xl border p-3.5 ${
        t.disclosed ? 'border-line bg-surface' : 'border-dashed border-line bg-surface-2'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[0.82rem] font-bold text-ink">{t.topic}</div>
        <span
          className={`flex-none rounded-full px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.04em] ${
            t.disclosed ? 'bg-pos-soft text-pos' : 'bg-surface-3 text-subtle'
          }`}
        >
          {t.disclosed ? 'disclosed' : 'not disclosed'}
        </span>
      </div>
      <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink">{t.finding}</p>
      {t.evidence && (
        <p className="mt-2 border-l-2 border-accent pl-2.5 text-[0.76rem] italic leading-relaxed text-muted">
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
      <p className="text-[0.9rem] font-medium leading-relaxed text-ink">
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
              <li key={i} className="flex gap-2 text-[0.85rem] leading-relaxed text-ink">
                <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-slate-400" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.unanswered.length > 0 && (
        <div className="rounded-xl border border-warn bg-warn-soft p-3.5">
          <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-warn">
            Not answerable from the filings
          </div>
          <ul className="mt-1 space-y-1.5">
            {a.unanswered.map((u, i) => (
              <li key={i} className="flex gap-2 text-[0.82rem] leading-relaxed text-amber-900">
                <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-amber-600" />
                <span>{u}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="border-t border-line pt-3 text-[0.7rem] text-subtle">
        Answered strictly from the {data.form} ({data.accession_no}) — business, risk
        factors, MD&A, market risk{data.form === '20-F' ? '' : ' + latest 10-Q'} — via{' '}
        {data.model ?? 'Claude'} · {fmtDate(data.generated_at.slice(0, 10))} — grounded
        in the filing text, not investment advice.
      </p>
    </div>
  )
}

function NoFiling({
  ticker,
  context,
  form,
}: {
  ticker: string
  context: 'overview' | 'diligence'
  form?: string | null
}) {
  if (context === 'diligence') {
    return (
      <p className="text-[0.85rem] text-subtle">
        {form
          ? `Deep diligence reads full 10-K / 20-F annual reports; ${ticker} files ${form}. Use “All SEC filings” below to AI-summarize a specific filing.`
          : `No 10-K or 20-F annual report on file for ${ticker} to analyze.`}
      </p>
    )
  }
  return (
    <p className="text-[0.85rem] text-subtle">
      No annual report on file for {ticker} to summarize — browse “All SEC filings”
      below to read a specific filing.
    </p>
  )
}

/**
 * Filing intelligence (Phases 10 + 14, merged). One home for the deep-dive's
 * filing AI, with two views:
 *   • Overview — fast structured summary of the latest 10-K (MD&A + Risk
 *     Factors); auto-generated once per company, cached after.
 *   • Diligence — deep, citation-grounded Q&A over the 10-K (Items 1/1A/7/7A) +
 *     10-Q across nine analyst topics, each disclosed/not-disclosed; on demand.
 * Both are honest-instrument context, not advice.
 */
function TabButton({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-lg px-3 py-1.5 text-[0.78rem] font-semibold transition-colors ' +
        (active ? 'bg-ink text-inverse' : 'text-muted hover:bg-surface-3')
      }
    >
      {children}
    </button>
  )
}

export function FilingIntelligencePanel({
  ticker,
  filings,
}: {
  ticker: string
  filings: FilingRow[]
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  // Deep-link hint: ?filing=diligence (e.g. from the Brief's "what to investigate
  // next" cross-link) opens straight to the deep analysis and scrolls it in.
  const wantsDiligence = searchParams.get('filing') === 'diligence'
  const [collapsed, setCollapsed] = useState(false)
  // Seed to diligence on the initial mount (no first-paint flash); the effect
  // below also handles an already-mounted panel and consumes the one-shot hint.
  const [tab, setTab] = useState<Tab>(wantsDiligence ? 'diligence' : 'overview')
  const sectionRef = useRef<HTMLElement>(null)
  const qc = useQueryClient()
  const toast = useToast()

  // The initial tab state (above) already opens Diligence on the fresh mount the
  // Brief cross-link causes; here we just scroll it into view and consume the
  // one-shot hint so it doesn't ride the J/K ticker pager (which carries the
  // search string forward) and re-scroll every subsequent ticker.
  useEffect(() => {
    if (!wantsDiligence) return
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const next = new URLSearchParams(searchParams)
    next.delete('filing')
    setSearchParams(next, { replace: true })
  }, [wantsDiligence, searchParams, setSearchParams])

  // ── Overview (summary) ──
  const sum = useQuery({
    queryKey: ['summary', ticker],
    queryFn: () => getSummaryStatus(ticker),
    staleTime: 10 * 60 * 1000,
  })
  const sumGen = useMutation({
    mutationFn: () => generateSummary(ticker),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['summary', ticker] })
      toast('success', 'Filing summary generated')
    },
    onError: (e) =>
      toast('error', e instanceof ApiError ? e.message : 'Could not generate the summary'),
  })
  // Auto-generate the Overview once per company (it's the cheap, always-on view).
  useEffect(() => {
    if (sum.data?.has_filing && !sum.data.summary && !sumGen.isPending && !autoTriggered.has(ticker)) {
      autoTriggered.add(ticker)
      sumGen.mutate()
    }
  }, [sum.data, ticker, sumGen])

  // ── Diligence (filing-qa) — on demand only ──
  const qa = useQuery({
    queryKey: ['filing-qa', ticker],
    queryFn: () => getFilingQaStatus(ticker),
    staleTime: 10 * 60 * 1000,
  })
  const qaGen = useMutation({
    mutationFn: () => generateFilingQa(ticker),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['filing-qa', ticker] })
      toast('success', 'Deep filing analysis ready')
    },
    onError: (e) =>
      toast('error', e instanceof ApiError ? e.message : 'Could not run the filing analysis'),
  })

  const docUrl =
    filings.find(
      (f) => f.accession_no === (sum.data?.summary?.accession_no ?? sum.data?.latest_accession),
    )?.primary_doc_url ?? null

  // The resolved annual form for each view (10-K for domestic, 20-F for foreign
  // filers) — drives the copy so it reads correctly for ADRs, not just 10-K names.
  const summaryForm = sum.data?.latest_form ?? '10-K'
  const qaForm = qa.data?.latest_form ?? '10-K'

  // Header regenerate button is contextual to the active tab.
  const regen =
    tab === 'overview' && sum.data?.summary
      ? { label: sumGen.isPending ? 'Regenerating…' : 'Regenerate', onClick: () => sumGen.mutate(), disabled: sumGen.isPending }
      : tab === 'diligence' && qa.data?.answers
        ? { label: qaGen.isPending ? 'Re-analyzing…' : 'Re-analyze', onClick: () => qaGen.mutate(), disabled: qaGen.isPending }
        : null

  return (
    <section ref={sectionRef} className="scroll-mt-20 rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 items-start gap-3">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="mt-0.5 shrink-0 text-subtle hover:text-muted"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            <svg className={`h-4 w-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
              viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
          <div>
            <div className="text-base font-bold text-ink">Filing intelligence</div>
            {!collapsed && (
              <div className="mt-0.5 text-[0.78rem] text-muted">
                {tab === 'overview'
                  ? `Fast AI summary of the latest ${summaryForm} (MD&A + risk factors) — context, not advice.`
                  : `Analyst diligence from the latest ${qaForm} (business, risk, MD&A, market risk)${qaForm === '20-F' ? '' : ' + 10-Q'} — hedging, debt, commitments, concentration. Context, not advice.`}
              </div>
            )}
          </div>
        </div>
        {!collapsed && regen && (
          <button
            type="button"
            onClick={regen.onClick}
            disabled={regen.disabled}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.78rem] font-semibold text-muted hover:bg-surface-2 disabled:opacity-50"
          >
            {regen.label}
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="mt-3 inline-flex gap-1 rounded-xl bg-surface-2 p-1">
            <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
            <TabButton active={tab === 'diligence'} onClick={() => setTab('diligence')}>
              Diligence
              {qa.data?.has_filing && !qa.data.answers && (
                <span
                  aria-hidden
                  title="Deep analysis available — not run yet"
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle bg-accent"
                />
              )}
            </TabButton>
          </div>

          {/* Discoverability: surface the deep analysis from the default Overview
              view so it isn't hidden behind the Diligence sub-tab. */}
          {tab === 'overview' && qa.data?.has_filing && !qa.data.answers && !qaGen.isPending && (
            <button
              type="button"
              onClick={() => {
                setTab('diligence')
                qaGen.mutate()
              }}
              className="mt-3 flex w-full items-center gap-2 rounded-xl border border-accent bg-accent-soft px-3.5 py-2.5 text-left transition-opacity hover:opacity-90"
            >
              <span className="flex-none rounded bg-accent-solid px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-accent-ink">
                AI
              </span>
              <span className="min-w-0 text-[0.8rem] leading-snug text-ink">
                <span className="font-semibold">Go deeper —</span> run a citation-grounded read of{' '}
                {ticker}&apos;s {qaForm}
                {qaForm === '20-F' ? '' : ' + 10-Q'} across nine diligence topics the factor score
                can&apos;t see.
              </span>
              <span className="ml-auto flex-none whitespace-nowrap text-[0.78rem] font-bold text-accent">
                Run analysis →
              </span>
            </button>
          )}

          <div className="mt-4">
            {tab === 'overview' ? (
              sum.isPending ? (
                <p className="text-[0.85rem] text-subtle">Loading…</p>
              ) : sum.error ? (
                <p className="text-[0.85rem] text-neg">Couldn’t load summary status.</p>
              ) : !sum.data?.has_filing ? (
                <NoFiling ticker={ticker} context="overview" />
              ) : sum.data.summary ? (
                <SummaryBody summary={sum.data.summary} docUrl={docUrl} />
              ) : sumGen.isError ? (
                <div className="rounded-xl border border-dashed border-neg-border bg-[var(--neg-soft)] p-5 text-center">
                  <p className="text-[0.85rem] font-semibold text-neg">
                    Couldn’t generate the summary
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-[0.8rem] text-subtle">
                    {sumGen.error instanceof ApiError
                      ? sumGen.error.message
                      : 'Something went wrong reaching the model or the filing.'}
                  </p>
                  <button type="button" onClick={() => sumGen.mutate()} disabled={sumGen.isPending}
                    className="mt-3 inline-flex items-center rounded-lg bg-accent-solid px-4 py-1.5 text-[0.82rem] font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60">
                    {sumGen.isPending ? 'Generating…' : 'Try again'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-5">
                  <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-accent-soft border-t-accent" />
                  <p className="text-[0.85rem] text-muted">
                    Reading {ticker}’s latest {summaryForm}
                    {sum.data.latest_filed_date ? ` (filed ${fmtDate(sum.data.latest_filed_date)})` : ''}{' '}
                    and writing the summary — up to a minute.
                  </p>
                </div>
              )
            ) : qa.isPending ? (
              <p className="text-[0.85rem] text-subtle">Loading…</p>
            ) : qa.error ? (
              <p className="text-[0.85rem] text-neg">Couldn’t load filing-analysis status.</p>
            ) : !qa.data.has_filing ? (
              <NoFiling ticker={ticker} context="diligence" form={qa.data.latest_form} />
            ) : qa.data.answers ? (
              <AnswersBody data={qa.data.answers} />
            ) : qaGen.isPending ? (
              <div className="flex items-center gap-3 rounded-xl border border-line bg-[var(--surface)] p-5">
                <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-accent-soft border-t-accent" />
                <p className="text-[0.85rem] text-muted">
                  Reading {ticker}’s {qaForm}
                  {qaForm === '20-F' ? '' : ' and 10-Q'} and working through the diligence
                  framework — this is the deep one, give it up to a minute.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-accent bg-[var(--surface)] p-5 text-center">
                <p className="text-[0.88rem] font-semibold text-ink">
                  Answer the open questions from the filings
                </p>
                <p className="mx-auto mt-1 max-w-lg text-[0.8rem] text-muted">
                  Runs a deep, citation-grounded read of {ticker}’s latest {qaForm}
                  {qaForm === '20-F' ? '' : ' and 10-Q'} across nine diligence topics — the
                  things the factor score can’t see. Cached after the first run.
                </p>
                <button type="button" onClick={() => qaGen.mutate()} disabled={qaGen.isPending}
                  className="mt-3 inline-flex items-center rounded-lg bg-accent-solid px-4 py-2 text-[0.82rem] font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60">
                  Run deep filing analysis
                </button>
                {qaGen.isError && (
                  <p className="mt-2 text-[0.78rem] text-neg">
                    {qaGen.error instanceof ApiError
                      ? qaGen.error.message
                      : 'Something went wrong reaching the model or the filing.'}
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
