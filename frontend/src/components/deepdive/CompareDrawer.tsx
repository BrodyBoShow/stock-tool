import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getSecurity, searchSecurities } from '@/lib/api'
import { rankColor } from '@/lib/colors'
import { DASH, fmtInput, fmtPctl, fmtPrice } from '@/lib/format'

export interface CompareDrawerProps {
  open: boolean
  onClose: () => void
  baseTicker: string
}

/** Row labels, in the exact DOM order every column must mirror. */
const ROW_LABELS = [
  'Ticker',
  'Price',
  'Composite',
  'Growth',
  'Value',
  'Quality',
  'Momentum',
  'P/E',
  'FCF yield',
  'D/E',
] as const

const CELL = 'flex h-9 items-center justify-end border-t border-slate-50 px-2 text-[0.76rem] tabular-nums'

/** Colored percentile pill for a factor cell (composite + the 4 factors). */
function RankPill({ value }: { value: number | null }): JSX.Element {
  const tint = rankColor(value)
  return (
    <span
      className="rounded px-1.5 text-[0.7rem] font-bold tabular-nums"
      style={{ backgroundColor: tint.bg, color: tint.fg }}
    >
      {fmtPctl(value)}
    </span>
  )
}

interface CompareColumnProps {
  ticker: string
  open: boolean
  onRemove?: () => void
}

/**
 * One ticker's column of values. Owns its own useQuery so the drawer can map a
 * variable-length ticker list to a fixed set of hook-owning components.
 */
function CompareColumn({ ticker, open, onRemove }: CompareColumnProps): JSX.Element {
  const upper = ticker.toUpperCase()
  const { data, isPending, isError } = useQuery({
    queryKey: ['security', upper, 90],
    queryFn: () => getSecurity(upper, 90),
    staleTime: 10 * 60 * 1000,
    enabled: open,
  })

  const header = data?.header ?? null
  const inputs = header?.details?.inputs ?? null

  const tickerCell = (
    <div className={`${CELL} gap-1 font-bold text-slate-800`}>
      <span className="truncate">{upper}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label={`Remove ${upper}`}
        >
          ×
        </button>
      )}
    </div>
  )

  if (isPending) {
    return (
      <>
        {tickerCell}
        {ROW_LABELS.slice(1).map((label) => (
          <div key={label} className={CELL}>
            <span className="h-5 w-12 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </>
    )
  }

  if (isError || !header) {
    return (
      <>
        {tickerCell}
        {ROW_LABELS.slice(1).map((label) => (
          <div key={label} className={`${CELL} text-slate-400`}>
            {DASH}
          </div>
        ))}
      </>
    )
  }

  return (
    <>
      {tickerCell}
      <div className={`${CELL} text-slate-700`}>{fmtPrice(header.last_price)}</div>
      <div className={CELL}>
        <RankPill value={header.composite} />
      </div>
      <div className={CELL}>
        <RankPill value={header.growth_pctl} />
      </div>
      <div className={CELL}>
        <RankPill value={header.value_pctl} />
      </div>
      <div className={CELL}>
        <RankPill value={header.quality_pctl} />
      </div>
      <div className={CELL}>
        <RankPill value={header.momentum_pctl} />
      </div>
      <div className={`${CELL} text-slate-700`}>{fmtInput('pe', inputs?.pe)}</div>
      <div className={`${CELL} text-slate-700`}>{fmtInput('fcf_yield', inputs?.fcf_yield)}</div>
      <div className={`${CELL} text-slate-700`}>{fmtInput('debt_to_equity', inputs?.debt_to_equity)}</div>
    </>
  )
}

const MAX_ADDED = 3

/** Right slide-in drawer: side-by-side factor + fundamentals comparison (§7.8). */
export function CompareDrawer({ open, onClose, baseTicker }: CompareDrawerProps): JSX.Element {
  const [added, setAdded] = useState<string[]>([])
  const [search, setSearch] = useState('')

  // Esc closes — listener wiring only, no state writes in the effect body.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const q = search.trim()
  const { data: results } = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchSecurities(q),
    enabled: open && q.length >= 1,
    staleTime: 60_000,
  })

  const base = baseTicker.toUpperCase()
  const full = added.length >= MAX_ADDED

  const addTicker = (raw: string): void => {
    const t = raw.toUpperCase()
    if (added.length >= MAX_ADDED || t === base || added.includes(t)) return
    setAdded((prev) => (prev.length >= MAX_ADDED || prev.includes(t) ? prev : [...prev, t]))
    setSearch('')
  }

  // Filter out the base ticker: `added` persists across J/K navigation, so the
  // user can land on a ticker they previously added (duplicate React key).
  const columns = [base, ...added.filter((t) => t !== base)]

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="fixed bottom-0 right-0 top-0 z-50 w-full max-w-[480px] overflow-y-auto bg-white shadow-2xl transition-transform duration-300"
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Compare securities"
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-white p-4">
          <div>
            <div className="text-sm font-semibold text-slate-800">Compare</div>
            <div className="text-[0.7rem] text-slate-500">
              Composite, factors and key fundamentals side-by-side
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close compare drawer"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="border-b p-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results?.rows[0]) addTicker(results.rows[0].ticker)
            }}
            disabled={full}
            placeholder="Add ticker (max 3)…"
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-[0.78rem] disabled:bg-slate-50 disabled:text-slate-400"
          />
          {full && (
            <div className="mt-1 text-[0.66rem] text-slate-400">Max 3 comparisons</div>
          )}
          {!full && q.length >= 1 && results && results.rows.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-lg border border-slate-100">
              {results.rows.slice(0, 6).map((row) => {
                const t = row.ticker.toUpperCase()
                const taken = t === base || added.includes(t)
                return (
                  <button
                    key={row.ticker}
                    type="button"
                    onClick={() => addTicker(row.ticker)}
                    disabled={taken}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.74rem] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="font-semibold text-slate-800">{t}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-500">
                      {row.name ?? ''}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Comparison grid — flex columns to keep DOM order per column simple */}
        <div className="p-4">
          <div className="flex">
            {/* Label column */}
            <div className="w-[120px] shrink-0">
              {ROW_LABELS.map((label) => (
                <div
                  key={label}
                  className="flex h-9 items-center border-t border-slate-50 pr-2 text-[0.72rem] font-medium text-slate-500"
                >
                  {label}
                </div>
              ))}
            </div>
            {/* One column per ticker */}
            {columns.map((t) => (
              <div key={t} className="min-w-0 flex-1">
                <CompareColumn
                  ticker={t}
                  open={open}
                  onRemove={
                    t === base
                      ? undefined
                      : () => setAdded((prev) => prev.filter((x) => x !== t))
                  }
                />
              </div>
            ))}
          </div>
          {added.length === 0 && (
            <div className="mt-3 text-[0.72rem] text-slate-400">
              Search above to add up to 3 tickers.
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="p-4 text-[0.66rem] text-slate-400">
          Factors are universe percentiles (100 = top). Fundamentals from the latest nightly
          snapshot.
        </div>
      </div>
    </>
  )
}
