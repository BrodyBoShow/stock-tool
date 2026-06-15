import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { getEvents } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type { MaterialEvent } from '@/types/api'

const SHOWN_DEFAULT = 8

// Routine item codes that shouldn't dim a row but also aren't the story.
const ROUTINE = new Set(['9.01', '7.01', '8.01', '5.07', '5.08', '5.03', '5.05'])

function EventRow({ e }: { e: MaterialEvent }) {
  // Pair each code with its label, ordering high-signal items first.
  const pairs = e.items.map((code, i) => ({ code, label: e.labels[i] ?? code }))
  const date = e.event_date ?? e.filed_date

  return (
    <li className="flex gap-3 py-2.5">
      <div className="flex flex-none flex-col items-center pt-1">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            e.high_signal ? 'bg-[#4f46e5]' : 'bg-[#cbd5e1]'
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[0.8rem] font-bold text-[#111827] tabular-nums">
            {fmtDate(date)}
          </span>
          <span className="text-[0.7rem] text-[#9ca3af]">{e.form}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {pairs.map(({ code, label }) => {
            const routine = ROUTINE.has(code)
            return (
              <span
                key={code}
                title={`Item ${code}`}
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-[0.74rem] font-medium ${
                  routine
                    ? 'bg-[#f1f5f9] text-[#94a3b8]'
                    : 'bg-[#eef2ff] text-[#3730a3]'
                }`}
              >
                {label}
              </span>
            )
          })}
        </div>
      </div>
      {e.primary_doc_url && (
        <a
          href={e.primary_doc_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-none self-center text-[0.72rem] font-semibold text-[#4f46e5] hover:underline"
        >
          8-K ↗
        </a>
      )}
    </li>
  )
}

/**
 * Recent 8-K material events (Phase 13) — a timeline of SEC-reported corporate
 * events (earnings releases, exec changes, M&A, impairments, ...) so the page
 * reflects what's happened lately, not just quarterly numerics. Context, not
 * advice; the event item codes come straight from EDGAR.
 */
export function EventsPanel({ ticker }: { ticker: string }) {
  const [expanded, setExpanded] = useState(false)
  const { data, isPending, error } = useQuery({
    queryKey: ['events', ticker],
    queryFn: () => getEvents(ticker),
    staleTime: 10 * 60 * 1000,
  })

  const events = data?.events ?? []
  const shown = expanded ? events : events.slice(0, SHOWN_DEFAULT)
  const highCount = events.filter((e) => e.high_signal).length

  return (
    <section className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-bold text-[#111827]">Recent events</div>
          <div className="mt-0.5 text-[0.78rem] text-[#6b7280]">
            Material corporate events from SEC 8-K filings (last 12 months) —
            what happened, beyond the numbers. Context, not advice.
          </div>
        </div>
        {events.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#eef2ff] px-2.5 py-1.5 text-[0.78rem] font-semibold text-[#3730a3]">
            {highCount} material · {events.length} total
          </span>
        )}
      </div>

      <div className="mt-3">
        {isPending ? (
          <p className="text-[0.85rem] text-[#9ca3af]">Loading…</p>
        ) : error ? (
          <p className="text-[0.85rem] text-[#b91c1c]">
            Couldn’t load recent events.
          </p>
        ) : events.length === 0 ? (
          <p className="text-[0.85rem] text-[#9ca3af]">
            No 8-K events on record for {ticker}. Foreign private issuers file
            6-K instead of 8-K (not covered here yet); a recently-added domestic
            name may still be backfilling overnight.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-[#f3f4f6]">
              {shown.map((e) => (
                <EventRow key={e.accession_no} e={e} />
              ))}
            </ul>
            {events.length > SHOWN_DEFAULT && (
              <button
                type="button"
                onClick={() => setExpanded((x) => !x)}
                className="mt-2.5 rounded-lg border border-[#e5e7eb] bg-white px-3 py-1.5 text-[0.78rem] font-semibold text-[#64748b] hover:bg-[#f8fafc]"
              >
                {expanded ? 'Show fewer' : `Show all ${events.length} events`}
              </button>
            )}
            <p className="mt-2.5 text-[0.7rem] text-[#9ca3af]">
              Indigo dots/badges mark genuinely market-moving items (M&amp;A,
              exec changes, results, impairments, delisting, restatements);
              grey = routine (exhibits, Reg-FD, votes).
            </p>
          </>
        )}
      </div>
    </section>
  )
}
