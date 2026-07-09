import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { useToast } from '@/components/ui/Toast'
import { ApiError, generateSummary } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type { FilingRow, FilingSummary } from '@/types/api'

// Mirrors engine/filing_taxonomy.CATEGORY_ORDER so groups render in a sensible
// order; any unknown category falls to the end.
const CATEGORY_ORDER = [
  'Annual report',
  'Quarterly report',
  'Current report',
  'Proxy & governance',
  'Ownership & insiders',
  'Tender & M&A',
  'Offering & registration',
  'Status & other',
]

// Plain-English hover explanations for the most common form codes (B12).
const FORM_TOOLTIPS: Record<string, string> = {
  '10-K': 'Audited annual report',
  '10-Q': 'Unaudited quarterly report',
  '8-K': 'Material corporate event — filed within 4 business days',
  '6-K': 'Foreign private issuer report',
  '4': 'Insider ownership change (Form 4)',
  'DEF 14A': 'Proxy statement',
}

// How many rows show before "Load 10 more" (B6 preview + load-more).
const PREVIEW_ROWS = 5

// Tint the form badge by category so the list scans at a glance.
const CATEGORY_TINT: Record<string, string> = {
  'Annual report': 'bg-accent-soft text-accent',
  'Quarterly report': 'bg-accent-soft text-accent',
  'Current report': 'bg-cyan-50 text-cyan-700',
  'Proxy & governance': 'bg-violet-50 text-violet-700',
  'Ownership & insiders': 'bg-neg-soft text-neg',
  'Tender & M&A': 'bg-orange-50 text-orange-700',
  'Offering & registration': 'bg-yellow-50 text-yellow-700',
  'Status & other': 'bg-surface-3 text-muted',
}

function groupByCategory(filings: FilingRow[]): [string, FilingRow[]][] {
  const groups = new Map<string, FilingRow[]>()
  for (const f of filings) {
    const cat = f.category ?? 'Status & other'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat)!.push(f)
  }
  return [...groups.entries()].sort(
    (a, b) =>
      (CATEGORY_ORDER.indexOf(a[0]) + 1 || 99) - (CATEGORY_ORDER.indexOf(b[0]) + 1 || 99),
  )
}

function Block({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div className="mt-2">
      <div className="text-[0.6rem] font-bold uppercase tracking-[0.06em] text-subtle">
        {label}
      </div>
      <ul className="mt-0.5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-[0.8rem] leading-relaxed text-ink">
            <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-slate-300" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SummaryInline({ summary }: { summary: FilingSummary }) {
  const s = summary.summary
  return (
    <div className="mt-2 rounded-lg border border-line bg-[var(--surface)] p-3">
      <p className="text-[0.82rem] leading-relaxed text-ink">{s.overview}</p>
      <Block label="Key points" items={s.what_changed} />
      <Block label="Risks / cautions" items={s.risk_factors} />
      <Block label="Key figures & terms" items={s.key_metrics} />
      <p className="mt-2 border-t border-[var(--surface-2)] pt-1.5 text-[0.66rem] text-subtle">
        AI-generated from the filing via {summary.model ?? 'Claude'} — grounded in the
        text, not advice.
      </p>
    </div>
  )
}

/**
 * Full SEC filing history (Phase: filing-intelligence expansion). Lists every
 * catalogued form — annual/quarterly/current reports, proxies, ownership stakes,
 * tender offers, offerings — grouped by category with EDGAR links. Narrative
 * filings get an on-demand "AI summary" button (one cached Haiku read each), so
 * any filing on any stock can be researched, not just the 10-K. Browse + context,
 * never advice.
 */
export function FilingsListPanel({
  ticker,
  filings,
}: {
  ticker: string
  filings: FilingRow[]
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [open, setOpen] = useState<Record<string, FilingSummary>>({})
  const [shown, setShown] = useState(PREVIEW_ROWS)
  const [prevKey, setPrevKey] = useState(ticker)
  const toast = useToast()

  // Render-phase derived-state reset (React-sanctioned, unlike setState in an
  // effect): when the list's identity changes, snap the preview back to 5.
  if (prevKey !== ticker) {
    setPrevKey(ticker)
    setShown(PREVIEW_ROWS)
  }

  const gen = useMutation({
    mutationFn: (accession: string) => generateSummary(ticker, { accession }),
    onSuccess: (data) => setOpen((o) => ({ ...o, [data.accession_no]: data })),
    onError: (e) =>
      toast('error', e instanceof ApiError ? e.message : 'Could not summarize the filing'),
  })

  // Newest first, then cap to the preview window; grouping runs on the
  // visible slice so category headers only appear for rows on screen.
  const filtered = [...filings].sort((a, b) => b.filed_date.localeCompare(a.filed_date))
  const groups = groupByCategory(filtered.slice(0, shown))

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-3">
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
            <div className="text-base font-bold text-ink">All SEC filings</div>
            <div className="mt-0.5 text-[0.78rem] text-muted">
              Every form on file — reports, proxies, ownership stakes, offerings.
              Hit “AI summary” on any narrative filing for a grounded read.
            </div>
          </div>
        </div>
        {filings.length > 0 && (
          <span className="inline-flex items-center rounded-lg bg-surface-3 px-2.5 py-1.5 text-[0.78rem] font-semibold text-muted">
            {filings.length} filings
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="mt-3">
          {filings.length === 0 ? (
            <div className="py-8 text-center">
              <svg
                className="mx-auto text-subtle"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M9 13h6" />
                <path d="M9 17h6" />
              </svg>
              <div className="mt-2 text-[0.82rem] font-semibold text-muted">
                No SEC filings on file
              </div>
              <p className="mt-1 text-[0.72rem] text-subtle">
                No filings in StockBud&rsquo;s catalog for this security —
                coverage can lag for foreign issuers, non-common share classes
                and recently added names.
              </p>
              <a
                href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(ticker)}`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-[0.72rem] font-semibold text-accent hover:underline"
              >
                Search EDGAR →
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map(([category, rows]) => (
                <div key={category}>
                  <div className="text-[0.66rem] font-bold uppercase tracking-[0.06em] text-subtle">
                    {category}
                  </div>
                  <ul className="mt-1 divide-y divide-line">
                    {rows.map((f) => {
                      const pending = gen.isPending && gen.variables === f.accession_no
                      const summary = open[f.accession_no]
                      return (
                        <li key={f.accession_no} className="py-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-[0.78rem] font-bold text-ink tabular-nums">
                              {fmtDate(f.filed_date)}
                            </span>
                            <span
                              title={FORM_TOOLTIPS[f.form] ?? f.label ?? f.form}
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[0.72rem] font-semibold ${
                                CATEGORY_TINT[f.category ?? 'Status & other'] ??
                                CATEGORY_TINT['Status & other']
                              }`}
                            >
                              {f.form}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[0.82rem] text-muted">
                              {f.label ?? f.form}
                            </span>
                            {f.analyzable && !summary && (
                              <button
                                type="button"
                                onClick={() => gen.mutate(f.accession_no)}
                                disabled={pending}
                                className="flex-none rounded-md border border-line bg-surface px-2 py-1 text-[0.72rem] font-semibold text-accent hover:bg-surface-2 disabled:opacity-50"
                              >
                                {pending ? 'Reading…' : 'AI summary'}
                              </button>
                            )}
                            {f.primary_doc_url && (
                              <a
                                href={f.primary_doc_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-none text-[0.72rem] font-semibold text-muted hover:underline"
                              >
                                SEC ↗
                              </a>
                            )}
                          </div>
                          {summary && <SummaryInline summary={summary} />}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
              {filtered.length > PREVIEW_ROWS && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                  <span className="text-[0.66rem] text-subtle tabular-nums">
                    Showing the {Math.min(shown, filtered.length)} newest of {filtered.length},
                    grouped by category
                  </span>
                  {filtered.length > shown && (
                    <button
                      type="button"
                      onClick={() => setShown((s) => s + 10)}
                      className="text-[0.72rem] font-semibold text-accent hover:underline"
                    >
                      Load 10 more →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
