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

// Tint the form badge by category so the list scans at a glance.
const CATEGORY_TINT: Record<string, string> = {
  'Annual report': 'bg-[#eef2ff] text-[#3730a3]',
  'Quarterly report': 'bg-[#eff6ff] text-[#1d4ed8]',
  'Current report': 'bg-[#ecfeff] text-[#0e7490]',
  'Proxy & governance': 'bg-[#f5f3ff] text-[#6d28d9]',
  'Ownership & insiders': 'bg-[#fef2f2] text-[#b91c1c]',
  'Tender & M&A': 'bg-[#fff7ed] text-[#c2410c]',
  'Offering & registration': 'bg-[#fefce8] text-[#a16207]',
  'Status & other': 'bg-[#f1f5f9] text-[#64748b]',
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

function SummaryInline({ summary }: { summary: FilingSummary }) {
  const s = summary.summary
  const Block = ({ label, items }: { label: string; items: string[] }) =>
    items.length ? (
      <div className="mt-2">
        <div className="text-[0.6rem] font-bold uppercase tracking-[0.06em] text-[#94a3b8]">
          {label}
        </div>
        <ul className="mt-0.5 space-y-1">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 text-[0.8rem] leading-relaxed text-[#1e293b]">
              <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-[#cbd5e1]" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null
  return (
    <div className="mt-2 rounded-lg border border-[#e5e7eb] bg-[#fafbff] p-3">
      <p className="text-[0.82rem] leading-relaxed text-[#334155]">{s.overview}</p>
      <Block label="Key points" items={s.what_changed} />
      <Block label="Risks / cautions" items={s.risk_factors} />
      <Block label="Key figures & terms" items={s.key_metrics} />
      <p className="mt-2 border-t border-[#eef2f7] pt-1.5 text-[0.66rem] text-[#9ca3af]">
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
  const [collapsed, setCollapsed] = useState(true)
  const [open, setOpen] = useState<Record<string, FilingSummary>>({})
  const toast = useToast()

  const gen = useMutation({
    mutationFn: (accession: string) => generateSummary(ticker, { accession }),
    onSuccess: (data) => setOpen((o) => ({ ...o, [data.accession_no]: data })),
    onError: (e) =>
      toast('error', e instanceof ApiError ? e.message : 'Could not summarize the filing'),
  })

  const groups = groupByCategory(filings)

  return (
    <section className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="mt-0.5 shrink-0 text-[#9ca3af] hover:text-[#64748b]"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            <svg className={`h-4 w-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
              viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
          <div>
            <div className="text-base font-bold text-[#111827]">All SEC filings</div>
            <div className="mt-0.5 text-[0.78rem] text-[#6b7280]">
              Every form on file — reports, proxies, ownership stakes, offerings.
              Hit “AI summary” on any narrative filing for a grounded read.
            </div>
          </div>
        </div>
        {filings.length > 0 && (
          <span className="inline-flex items-center rounded-lg bg-[#f1f5f9] px-2.5 py-1.5 text-[0.78rem] font-semibold text-[#475569]">
            {filings.length} filings
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="mt-3">
          {filings.length === 0 ? (
            <p className="text-[0.85rem] text-[#9ca3af]">
              No filings catalogued for {ticker} yet — a recently-added name may
              still be backfilling overnight.
            </p>
          ) : (
            <div className="space-y-4">
              {groups.map(([category, rows]) => (
                <div key={category}>
                  <div className="text-[0.66rem] font-bold uppercase tracking-[0.06em] text-[#94a3b8]">
                    {category}
                  </div>
                  <ul className="mt-1 divide-y divide-[#f3f4f6]">
                    {rows.map((f) => {
                      const pending = gen.isPending && gen.variables === f.accession_no
                      const summary = open[f.accession_no]
                      return (
                        <li key={f.accession_no} className="py-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-[0.78rem] font-bold text-[#111827] tabular-nums">
                              {fmtDate(f.filed_date)}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[0.72rem] font-semibold ${
                                CATEGORY_TINT[f.category ?? 'Status & other'] ??
                                CATEGORY_TINT['Status & other']
                              }`}
                            >
                              {f.form}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[0.82rem] text-[#475569]">
                              {f.label ?? f.form}
                            </span>
                            {f.analyzable && !summary && (
                              <button
                                type="button"
                                onClick={() => gen.mutate(f.accession_no)}
                                disabled={pending}
                                className="flex-none rounded-md border border-[#e5e7eb] bg-white px-2 py-1 text-[0.72rem] font-semibold text-[#4f46e5] hover:bg-[#f8fafc] disabled:opacity-50"
                              >
                                {pending ? 'Reading…' : 'AI summary'}
                              </button>
                            )}
                            {f.primary_doc_url && (
                              <a
                                href={f.primary_doc_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-none text-[0.72rem] font-semibold text-[#64748b] hover:underline"
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
            </div>
          )}
        </div>
      )}
    </section>
  )
}
