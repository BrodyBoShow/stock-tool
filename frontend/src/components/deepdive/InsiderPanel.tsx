import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { getInsiders } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type { InsiderTransaction, InsiderWindow } from '@/types/api'

const SHOWN_DEFAULT = 12

// SEC Form 4 transaction codes — P and S are the ones with intent signal.
const CODE_LABELS: Record<string, string> = {
  P: 'Buy',
  S: 'Sell',
  A: 'Award',
  M: 'Exercise',
  F: 'Tax',
  G: 'Gift',
  D: 'To issuer',
  C: 'Conversion',
  J: 'Other',
  W: 'Inherited',
}

function fmtUsd(v: number | null): string {
  if (v === null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function CodeBadge({ t }: { t: InsiderTransaction }) {
  const styles =
    t.transaction_code === 'P'
      ? 'bg-pos-soft text-pos'
      : t.transaction_code === 'S'
        ? 'bg-neg-soft text-neg'
        : 'bg-surface-3 text-muted'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex rounded px-1.5 py-0.5 text-[0.68rem] font-bold ${styles}`}
      >
        {CODE_LABELS[t.transaction_code] ?? t.transaction_code}
      </span>
      {t.plan_10b5_1 && (
        <span
          className="inline-flex cursor-help rounded border border-line px-1 py-0.5 text-[0.62rem] font-semibold uppercase text-subtle"
          title="Filed as a pre-scheduled Rule 10b5-1 plan trade — far weaker signal than a discretionary transaction."
        >
          plan
        </span>
      )}
    </span>
  )
}

function WindowChip({ w }: { w: InsiderWindow }) {
  const planPct =
    w.sell_count > 0 ? Math.round((100 * w.sells_under_plan) / w.sell_count) : 0
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[0.78rem] text-muted">
      <span className="font-bold text-ink">{w.months}m</span>
      <span className={w.buy_count > 0 ? 'font-semibold text-pos' : ''}>
        {w.buy_count} buy{w.buy_count === 1 ? '' : 's'}
        {w.buy_value !== null ? ` (${fmtUsd(w.buy_value)})` : ''}
      </span>
      ·
      <span className={w.sell_count > 0 ? 'font-semibold text-neg' : ''}>
        {w.sell_count} sell{w.sell_count === 1 ? '' : 's'}
        {w.sell_value !== null ? ` (${fmtUsd(w.sell_value)})` : ''}
      </span>
      {w.sell_count > 0 && (
        <span className="text-[0.7rem] text-subtle">{planPct}% plan</span>
      )}
    </span>
  )
}

/** One-line read on the 12-month open-market pattern (P/S only, the signal
 *  trades). Plan-heavy selling is softened to amber, not red. */
function InsiderVerdict({ w }: { w: InsiderWindow }) {
  const net = (w.buy_value ?? 0) - (w.sell_value ?? 0)
  const planPct = w.sell_count > 0 ? (100 * w.sells_under_plan) / w.sell_count : 0
  let label: string
  let cls: string
  if (w.buy_count === 0 && w.sell_count === 0) {
    label = 'No open-market buys or sells in 12 months'
    cls = 'bg-surface-3 text-muted'
  } else if (w.buy_count > w.sell_count && net > 0) {
    label = 'Net accumulating — insiders bought on the open market'
    cls = 'bg-pos-soft text-pos'
  } else if (w.sell_count > w.buy_count && net < 0) {
    label =
      planPct >= 60
        ? 'Net selling, but mostly pre-scheduled plan sales (weak signal)'
        : 'Net distributing — open-market selling, no offsetting buys'
    cls = planPct >= 60 ? 'bg-warn-soft text-warn' : 'bg-neg-soft text-neg'
  } else {
    label = 'Mixed — buys and sells roughly offsetting'
    cls = 'bg-surface-3 text-muted'
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[0.8rem]">
      <span className={`rounded px-2 py-0.5 text-[0.72rem] font-bold ${cls}`}>12-month signal</span>
      <span className="text-muted">{label}.</span>
      <span className="numeric text-[0.74rem] text-subtle">
        {w.buy_count} buys / {w.sell_count} sells · net{' '}
        {net >= 0 ? '+' : '−'}
        {fmtUsd(Math.abs(net))}
      </span>
    </div>
  )
}

function role(t: InsiderTransaction): string {
  if (t.owner_title) return t.owner_title
  if (t.is_director && t.is_officer) return 'Director & Officer'
  if (t.is_director) return 'Director'
  if (t.is_officer) return 'Officer'
  if (t.is_ten_pct) return '10% owner'
  return ''
}

/**
 * Form 4 insider activity (Phase 12). Open-market buys (P) and sells (S) are
 * the signal lines; awards/exercises/tax rows are shown for completeness but
 * excluded from the buy/sell aggregates. Context, not advice.
 */
export function InsiderPanel({ ticker }: { ticker: string }) {
  const [expanded, setExpanded] = useState(false)
  const [openMarketOnly, setOpenMarketOnly] = useState(false)
  const { data, isPending, error } = useQuery({
    queryKey: ['insiders', ticker],
    queryFn: () => getInsiders(ticker),
    staleTime: 10 * 60 * 1000,
  })

  const txns = data?.transactions ?? []
  const filteredTxns = openMarketOnly
    ? txns.filter((t) => t.transaction_code === 'P' || t.transaction_code === 'S')
    : txns
  const shown = expanded ? filteredTxns : filteredTxns.slice(0, SHOWN_DEFAULT)

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-bold text-ink">
            Insider activity
          </div>
          <div className="mt-0.5 text-[0.78rem] text-muted">
            SEC Form 4 filings — open-market buys and sells carry the signal;
            awards and plan sales mostly don&apos;t. Context, not advice.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && txns.length > 0 && (
            <>
              {data.windows.map((w) => (
                <WindowChip key={w.months} w={w} />
              ))}
              <label className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[0.72rem] font-semibold text-muted hover:bg-surface-3">
                <input
                  type="checkbox"
                  checked={openMarketOnly}
                  onChange={(e) => {
                    setOpenMarketOnly(e.target.checked)
                    setExpanded(false)
                  }}
                  className="h-3 w-3 accent-indigo-600"
                />
                Open market only
              </label>
            </>
          )}
        </div>
      </div>

      {data && txns.length > 0 && data.windows[1] && (
        <InsiderVerdict w={data.windows[1]} />
      )}

      <div className="mt-3">
        {isPending ? (
          <p className="text-[0.85rem] text-subtle">Loading…</p>
        ) : error ? (
          <p className="text-[0.85rem] text-neg">
            Couldn’t load insider activity.
          </p>
        ) : txns.length === 0 ? (
          <p className="text-[0.85rem] text-subtle">
            No insider (Form 4) transactions on record for {ticker}. Foreign
            private issuers are exempt from Form 4; a recently-added domestic
            name may still be backfilling overnight.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line bg-surface-2">
                    {['Date', 'Insider', 'Type', 'Shares', 'Price', 'Value'].map(
                      (h) => (
                        <th
                          key={h}
                          className={`whitespace-nowrap px-3 py-2 text-[0.68rem] font-bold uppercase tracking-[0.06em] text-muted ${
                            h === 'Date' || h === 'Insider' || h === 'Type'
                              ? 'text-left'
                              : 'text-right'
                          }`}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t, i) => (
                    <tr key={i} className="border-b border-line">
                      <td className="whitespace-nowrap px-3 py-2 text-[0.8rem] text-muted">
                        {t.transaction_date ? fmtDate(t.transaction_date) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-[0.82rem] font-semibold text-ink">
                          {t.owner_name}
                        </div>
                        {role(t) && (
                          <div className="text-[0.7rem] text-subtle">
                            {role(t)}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <CodeBadge t={t} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-[0.8rem] tabular-nums text-ink">
                        {t.shares !== null ? t.shares.toLocaleString() : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-[0.8rem] tabular-nums text-ink">
                        {t.price ? `$${t.price.toFixed(2)}` : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-[0.8rem] font-semibold tabular-nums text-ink">
                        {t.value ? fmtUsd(t.value) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredTxns.length > SHOWN_DEFAULT && (
              <button
                type="button"
                onClick={() => setExpanded((x) => !x)}
                className="mt-2.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.78rem] font-semibold text-muted hover:bg-surface-2"
              >
                {expanded
                  ? 'Show fewer'
                  : `Show all ${filteredTxns.length} transactions`}
              </button>
            )}

            <p className="mt-2.5 text-[0.7rem] text-subtle">
              &ldquo;plan&rdquo; = filed as a pre-scheduled Rule 10b5-1 trade
              (post-2023 filings disclose this). Aggregates count open-market
              buys (P) and sells (S) only.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
