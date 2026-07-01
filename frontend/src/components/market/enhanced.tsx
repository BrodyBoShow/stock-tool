import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { fmtMoney, fmtShortDate } from '@/lib/format'
import type {
  MarketFilingRow,
  MarketHeadline,
  MarketInsiderBuy,
  MarketMover,
} from '@/types/api'

import { MoverList } from './sections'
import { timeAgo } from './utils'

// ── shared chip primitives ────────────────────────────────────────────────────

const CHIP_BASE = 'rounded-full px-2.5 py-1 text-[0.7rem] font-semibold transition-colors'

function FilterChips<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`${CHIP_BASE} ${
            value === o.key
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── 4 · Mover filter chips ─────────────────────────────────────────────────────

type CapBucket = 'all' | 'mega' | 'large' | 'mid' | 'small'

const CAP_OPTIONS: { key: CapBucket; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mega', label: 'Mega' },
  { key: 'large', label: 'Large' },
  { key: 'mid', label: 'Mid' },
  { key: 'small', label: 'Small' },
]

function inCapBucket(cap: number | null, bucket: CapBucket): boolean {
  if (bucket === 'all') return true
  if (cap == null) return false
  if (bucket === 'mega') return cap >= 200e9
  if (bucket === 'large') return cap >= 10e9 && cap < 200e9
  if (bucket === 'mid') return cap >= 2e9 && cap < 10e9
  return cap < 2e9 // small
}

export function EnhancedMovers({ gainers, losers }: { gainers: MarketMover[]; losers: MarketMover[] }) {
  const [bucket, setBucket] = useState<CapBucket>('all')
  const g = gainers.filter((m) => inCapBucket(m.market_cap, bucket))
  const l = losers.filter((m) => inCapBucket(m.market_cap, bucket))
  return (
    <div>
      <FilterChips options={CAP_OPTIONS} value={bucket} onChange={setBucket} />
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          {g.length > 0
            ? <MoverList movers={g} title="Gainers" />
            : (
              <div>
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-slate-400">Gainers</div>
                <p className="mt-2 text-[0.78rem] text-slate-400">None in this range.</p>
              </div>
            )}
        </div>
        <div>
          {l.length > 0
            ? <MoverList movers={l} title="Losers" />
            : (
              <div>
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-slate-400">Losers</div>
                <p className="mt-2 text-[0.78rem] text-slate-400">None in this range.</p>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

// ── 5 · 8-K filings enhancements ───────────────────────────────────────────────

// Materiality scoring from a filing's plain-English labels + raw item codes.
// Conservative: only the clearly-heavy events score 3.
const MAT_HIGH = /merger|acquisition|acquire|m&a|bankrupt|chapter 11|delist|receivership|tender offer|going concern/i
const MAT_MED = /officer|executive|director|management|resign|appoint|departure|material agreement|amendment|restructur|impairment|guidance|dividend/i

function materiality(f: MarketFilingRow): 1 | 2 | 3 {
  const hay = [...f.labels, ...f.items].join(' ')
  if (MAT_HIGH.test(hay)) return 3
  if (MAT_MED.test(hay)) return 2
  return 1
}

function MaterialityDots({ level }: { level: 1 | 2 | 3 }) {
  const color = level === 3 ? '#b91c1c' : level === 2 ? '#b45309' : '#94a3b8'
  const title = level === 3 ? 'High-materiality event (M&A, bankruptcy, delisting)'
    : level === 2 ? 'Medium materiality (management change, material agreement)'
    : 'Routine 8-K item'
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 align-middle" title={title} aria-label={title}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: i <= level ? color : '#e2e8f0' }}
        />
      ))}
    </span>
  )
}

export function EnhancedFilings({ filings, watchlist }: { filings: MarketFilingRow[]; watchlist: Set<string> }) {
  const [label, setLabel] = useState<string>('all')
  const labelOptions = useMemo(() => {
    const set = new Set<string>()
    for (const f of filings) for (const l of f.labels) set.add(l)
    const opts: { key: string; label: string }[] = [{ key: 'all', label: 'All' }]
    for (const l of [...set].sort()) opts.push({ key: l, label: l })
    return opts
  }, [filings])

  const shown = label === 'all' ? filings : filings.filter((f) => f.labels.includes(label))

  return (
    <div>
      {labelOptions.length > 1 && <FilterChips options={labelOptions} value={label} onChange={setLabel} />}
      <div className="max-h-[460px] space-y-3 overflow-auto pr-1">
        {shown.length === 0 && <p className="text-sm text-gray-400">No high-signal filings in the window.</p>}
        {shown.map((f) => {
          const onWatch = f.ticker != null && watchlist.has(f.ticker)
          return (
            <div key={f.accession_no + f.security_id} className="flex items-start gap-3">
              <div className="w-[4.2rem] shrink-0 pt-0.5 text-[0.7rem] tabular-nums text-slate-400">
                {fmtShortDate(f.filed_date)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {onWatch && (
                    <span className="inline-block h-2 w-2 shrink-0 self-center rounded-full bg-indigo-500" title="On your watchlist" aria-label="On your watchlist" />
                  )}
                  {f.ticker && (
                    <Link to={`/securities/${f.ticker}`} className="font-bold text-slate-800 hover:text-indigo-600">{f.ticker}</Link>
                  )}
                  <span className="truncate text-[0.76rem] text-slate-400">
                    {f.name} {f.market_cap ? `· ${fmtMoney(f.market_cap)}` : ''}
                  </span>
                  <MaterialityDots level={materiality(f)} />
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {f.labels.slice(0, 3).map((l) => (
                    <span key={l} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[0.68rem] font-semibold text-indigo-600">{l}</span>
                  ))}
                  {f.primary_doc_url && (
                    <a href={f.primary_doc_url} target="_blank" rel="noreferrer"
                      className="rounded-full bg-slate-50 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-400 hover:text-indigo-600">SEC filing ↗</a>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 7 · Insider enhancements ───────────────────────────────────────────────────

// Compact sector labels for the heatmap strip so long sector names don't overflow.
function shortSector(sector: string | null): string {
  if (!sector) return '—'
  const map: Record<string, string> = {
    'Information Technology': 'Info Tech',
    'Communication Services': 'Comm Svcs',
    'Consumer Discretionary': 'Cons Disc',
    'Consumer Staples': 'Cons Stpl',
    'Health Care': 'Health',
    'Financials': 'Financials',
    'Industrials': 'Industrl',
    'Materials': 'Materials',
    'Real Estate': 'Real Est',
    'Utilities': 'Utilities',
    'Energy': 'Energy',
  }
  return map[sector] ?? sector
}

export function EnhancedInsider({ buys }: { buys: MarketInsiderBuy[] }) {
  const sectorTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const i of buys) {
      const v = i.total_value ?? 0
      if (v <= 0) continue
      const key = i.sector ?? 'Unknown'
      totals.set(key, (totals.get(key) ?? 0) + v)
    }
    const grand = [...totals.values()].reduce((a, b) => a + b, 0)
    return { rows: [...totals.entries()].sort((a, b) => b[1] - a[1]), grand }
  }, [buys])

  return (
    <div>
      {sectorTotals.rows.length > 0 && sectorTotals.grand > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {sectorTotals.rows.map(([sector, total]) => {
            const share = total / sectorTotals.grand
            const alpha = 0.14 + share * 0.5
            return (
              <span
                key={sector}
                title={`${sector} · ${fmtMoney(total)} (${(share * 100).toFixed(0)}% of insider $ this week)`}
                className="rounded-md px-2 py-1 text-[0.62rem] font-semibold text-emerald-900"
                style={{ background: `rgba(16,185,129,${alpha.toFixed(3)})` }}
              >
                {shortSector(sector)}
              </span>
            )
          })}
        </div>
      )}
      <div className="space-y-2.5">
        {buys.length === 0 && <p className="text-sm text-gray-400">No open-market buys filed this week.</p>}
        {buys.map((i) => (
          <div key={i.security_id} className="flex items-center gap-2.5 text-[0.84rem]">
            <Link to={`/securities/${i.ticker}`} className="w-16 shrink-0 font-bold text-slate-800 hover:text-indigo-600">{i.ticker}</Link>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[0.76rem] text-slate-400">
              <span className="truncate">{i.buyers} buyer{i.buyers !== 1 ? 's' : ''} · filed {fmtShortDate(i.last_filed)}</span>
              {i.buyers >= 3 && (
                <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-emerald-700" title="Cluster buy — 3+ distinct insiders">cluster</span>
              )}
            </span>
            <span className="shrink-0 font-bold tabular-nums text-emerald-600">{fmtMoney(i.total_value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 6 · Headlines enhancements ─────────────────────────────────────────────────

const MACRO_RE = /\b(fed|rate|rates|inflation|cpi|jobs|gdp|treasury|yield|yields)\b/i
const EARN_RE = /\b(earnings|profit|revenue|guidance|results|beats?|misses?)\b/i

type HeadlineFilter = 'all' | 'watchlist' | 'macro' | 'earnings'

const HEADLINE_OPTIONS: { key: HeadlineFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'watchlist', label: 'My watchlist' },
  { key: 'macro', label: 'Macro' },
  { key: 'earnings', label: 'Earnings' },
]

// Ticker symbols that are also common English words — matching these in a
// headline is almost always the word, not the company (C3.ai=AI, Gartner=IT,
// Allstate=ALL, Ford=F). Skip them so a "AI rally" headline never tags $AI.
const TICKER_STOPWORDS = new Set([
  'A', 'I', 'AI', 'IT', 'ON', 'OR', 'BE', 'BY', 'GO', 'SO', 'UP', 'US', 'AN', 'AT', 'AS', 'IS', 'IN', 'OF', 'TO', 'DO', 'WE', 'HE', 'ME', 'MY', 'NO', 'IF',
  'ALL', 'ARE', 'FOR', 'ONE', 'NEW', 'NOW', 'OUT', 'OWN', 'BIG', 'CEO', 'ETF', 'GDP', 'CPI', 'USA', 'AND', 'THE', 'ANY', 'CAN', 'HAS', 'HAD', 'WAS', 'ITS', 'BUY', 'PAY', 'TWO', 'TEN', 'SEE', 'GET', 'WHO', 'HOW', 'WHY', 'YOU', 'NET', 'KEY', 'RUN', 'TOP', 'LOW', 'HIT', 'CUT', 'WIN', 'END',
])

/** Whole-word ticker match against a known-on-page set (no arbitrary uppercase
 *  regex, and skipping symbols that are common English words). */
function tickersInTitle(title: string, known: Set<string>): string[] {
  if (known.size === 0) return []
  const words = title.split(/[^A-Za-z0-9.]+/)
  const hits = new Set<string>()
  for (const w of words) {
    const up = w.toUpperCase()
    if (known.has(up) && !TICKER_STOPWORDS.has(up)) hits.add(up)
  }
  return [...hits]
}

export function EnhancedHeadlines({ headlines, knownTickers, watchlist }: {
  headlines: MarketHeadline[]
  knownTickers: Set<string>
  watchlist: Set<string>
}) {
  const [filter, setFilter] = useState<HeadlineFilter>('all')
  const [comfortable, setComfortable] = useState(false)

  // Tag once; filtering + rendering both read the tags.
  const tagged = useMemo(
    () => headlines.map((h) => {
      const tickers = tickersInTitle(h.title, knownTickers)
      const onWatch = tickers.some((t) => watchlist.has(t))
      return { h, tickers, onWatch, macro: MACRO_RE.test(h.title), earnings: EARN_RE.test(h.title) }
    }),
    [headlines, knownTickers, watchlist],
  )

  const shown = tagged.filter((t) => {
    if (filter === 'watchlist') return t.onWatch
    if (filter === 'macro') return t.macro
    if (filter === 'earnings') return t.earnings
    return true
  })

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <FilterChips options={HEADLINE_OPTIONS} value={filter} onChange={setFilter} />
        <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-0.5">
          {([['Compact', false], ['Comfortable', true]] as const).map(([lab, val]) => (
            <button
              key={lab}
              type="button"
              onClick={() => setComfortable(val)}
              className={`rounded-md px-2.5 py-1 text-[0.7rem] font-semibold transition-colors ${
                comfortable === val ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {lab}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2.5">
        {headlines.length === 0 && (
          <p className="text-sm text-gray-400">Feeds unreachable right now — the rest of the page is unaffected.</p>
        )}
        {headlines.length > 0 && shown.length === 0 && (
          <p className="text-sm text-gray-400">No headlines match this filter right now.</p>
        )}
        {shown.map(({ h, tickers, onWatch }) => (
          // Ticker chips are their own links, so the headline can't be one big
          // anchor (nested <a> is invalid) — the title is the clickable element.
          <div
            key={h.url}
            className={`group ${onWatch ? 'border-l-2 border-indigo-500 pl-2.5' : ''}`}
          >
            {comfortable ? (
              <div>
                <a href={h.url} target="_blank" rel="noreferrer" className="block text-[0.9rem] font-medium leading-snug text-slate-700 no-underline hover:text-indigo-600">
                  {h.title}
                </a>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-slate-400">
                  <span className="font-semibold uppercase tracking-wide">{h.source}</span>
                  <span aria-hidden>·</span>
                  <span>{timeAgo(h.published_epoch)}</span>
                  {tickers.length > 0 && <TickerChips tickers={tickers} />}
                </div>
              </div>
            ) : (
              <div className="flex items-baseline gap-3">
                <span className="w-24 shrink-0 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-400">{h.source}</span>
                <a href={h.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[0.88rem] font-medium text-slate-700 no-underline hover:text-indigo-600">
                  {h.title}
                </a>
                {tickers.length > 0 && <span className="hidden shrink-0 sm:inline-flex"><TickerChips tickers={tickers} /></span>}
                <span className="shrink-0 text-[0.7rem] text-slate-400">{timeAgo(h.published_epoch)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TickerChips({ tickers }: { tickers: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tickers.map((t) => (
        <Link
          key={t}
          to={`/securities/${t}`}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.64rem] font-bold text-slate-600 hover:bg-indigo-50 hover:text-indigo-600"
        >
          {t}
        </Link>
      ))}
    </span>
  )
}
