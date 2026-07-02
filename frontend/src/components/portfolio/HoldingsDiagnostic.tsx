/**
 * Holdings Diagnostic Table — the Portfolio tab's richest table.
 *
 * Each holding row overlays live quotes (price/day/value/P&L recomputed
 * client-side when a quote is present), sorts/filters/groups locally, and
 * expands into a diagnostic sub-row: tax lots (LT/ST), thesis link,
 * correlation badges from the analytics matrix, and quick actions.
 *
 * Batch mode: checkbox-select rows → Rebalance… (opens the simulator),
 * Export CSV, Clear. No trade execution anywhere — measurement, not advice.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Sparkline } from '@/components/screener/Sparkline'
import { InfoTip } from '@/components/ui/InfoTip'
import { plColor } from '@/lib/colors'
import { FORM_INPUT, TABLE_HEAD_ROW } from '@/lib/constants'
import {
  DASH,
  fmtDate,
  fmtPrice,
  fmtSignedMoney,
  fmtSignedPct,
} from '@/lib/format'
import type {
  PortfolioAnalyticsResponse,
  PortfolioFlag,
  PortfolioHolding,
} from '@/types/api'
import {
  isLongTerm,
  sectorColor,
  sectorShort,
} from '@/components/portfolio/portfolioUi'

export interface HoldingsDiagnosticProps {
  holdings: PortfolioHolding[]
  quotes: Record<string, { price: number | null; change_pct: number | null }>
  analytics: PortfolioAnalyticsResponse | undefined
  flags: PortfolioFlag[]
  asOf: string
  onOpenSimulator: (ticker: string | null) => void
}

// ── Local types ─────────────────────────────────────────────────────────────

type SortKey = 'value' | 'weight' | 'pl' | 'day' | 'score' | 'ticker'
type SortDir = 1 | -1
type GroupBy = 'none' | 'sector' | 'ltst'

/** A holding with the live-quote overlay applied. */
interface Row {
  h: PortfolioHolding
  price: number | null
  live: boolean // price came from a live quote (vs last close)
  day: number | null // fraction
  value: number | null
  pl: number | null
  /** live value / live total — keeps Weight consistent with the live Value
   *  column (the nightly h.weight would sit stale next to a live value) */
  liveWeight: number | null
}

interface CorrBadge {
  ticker: string
  c: number
}

// ── Pure helpers (module top-level, per React Compiler rules) ───────────────

function buildRow(
  h: PortfolioHolding,
  quotes: HoldingsDiagnosticProps['quotes'],
): Row {
  const q = h.ticker ? quotes[h.ticker] : undefined
  const price = q?.price ?? h.last_price
  const day = q?.change_pct != null ? q.change_pct / 100 : h.day_change_pct
  const value = price != null ? price * h.shares : h.market_value
  const pl = value != null ? value - h.cost_basis : h.unrealized_pl
  return { h, price, live: q?.price != null, day, value, pl, liveWeight: null }
}

/** Fill Row.liveWeight from the live total (positions only). */
function withLiveWeights(rows: Row[]): Row[] {
  let total = 0
  for (const r of rows) total += r.value ?? 0
  return rows.map((r) => ({
    ...r,
    liveWeight: r.value != null && total > 0 ? r.value / total : r.h.weight,
  }))
}

function sortVal(r: Row, key: SortKey): number | null {
  switch (key) {
    case 'value':
      return r.value
    case 'weight':
      return r.liveWeight ?? r.h.weight
    case 'pl':
      return r.pl
    case 'day':
      return r.day
    case 'score':
      return r.h.composite
    default:
      return null
  }
}

/** Top-2 correlation partners + "diversifier" verdict from the NxN matrix. */
function corrBadges(
  ticker: string | null,
  analytics: PortfolioAnalyticsResponse | undefined,
): { top: CorrBadge[]; diversifier: boolean } {
  if (!ticker || !analytics?.tickers || !analytics.corr) {
    return { top: [], diversifier: false }
  }
  const idx = analytics.tickers.indexOf(ticker)
  const row = idx >= 0 ? analytics.corr[idx] : undefined
  if (!row) return { top: [], diversifier: false }
  const pairs: CorrBadge[] = []
  for (let j = 0; j < analytics.tickers.length; j++) {
    if (j === idx) continue
    const c = row[j]
    if (c == null) continue
    pairs.push({ ticker: analytics.tickers[j], c })
  }
  const sorted = [...pairs].sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
  return {
    top: sorted.slice(0, 2),
    diversifier: sorted.length > 0 && Math.abs(sorted[0].c) < 0.3,
  }
}

function corrTone(c: number): string {
  const a = Math.abs(c)
  if (a >= 0.6) return 'bg-red-50 text-red-700'
  if (a >= 0.35) return 'bg-amber-50 text-amber-800'
  return 'bg-green-50 text-green-700'
}

function warnFor(
  h: PortfolioHolding,
  flags: PortfolioFlag[],
): { tone: 'red' | 'amber'; title: string } | null {
  const conc = h.ticker
    ? flags.find((f) => f.kind === 'concentration' && f.ticker === h.ticker)
    : undefined
  if (conc) return { tone: 'red', title: conc.text }
  if (h.wash_sale_risk) {
    return { tone: 'amber', title: 'wash-sale risk if sold at a loss' }
  }
  return null
}

/** Shares to up to 4 dp with trailing zeros trimmed (toLocaleString trims). */
function fmtShares(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s
}

function ltstLabel(h: PortfolioHolding, asOf: string): string {
  return h.oldest_acquired && isLongTerm(h.oldest_acquired, asOf)
    ? 'Long-term (>1y)'
    : 'Short-term'
}

function buildCsv(rows: Row[]): string {
  const lines = ['ticker,shares,avg_cost,price,value,weight,pl']
  for (const r of rows) {
    lines.push(
      [
        r.h.ticker ?? '',
        r.h.shares,
        r.h.avg_cost ?? '',
        r.price ?? '',
        r.value ?? '',
        r.liveWeight ?? r.h.weight ?? '',
        r.pl ?? '',
      ].join(','),
    )
  }
  return lines.join('\n')
}

// ── Small presentational pieces (module top-level) ──────────────────────────

const SCORE_FACTORS: Array<
  [string, 'growth_pctl' | 'value_pctl' | 'quality_pctl' | 'momentum_pctl']
> = [
  ['Growth', 'growth_pctl'],
  ['Value', 'value_pctl'],
  ['Quality', 'quality_pctl'],
  ['Momentum', 'momentum_pctl'],
]

/** Composite value with a hover popover listing the four factor percentiles. */
function ScorePopover({ h }: { h: PortfolioHolding }) {
  if (h.composite == null) return <span className="text-slate-300">{DASH}</span>
  return (
    <span className="group relative inline-block cursor-default">
      <span className="font-semibold tabular-nums text-slate-700">
        {h.composite.toFixed(0)}
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 w-44 -translate-x-1/2 rounded-lg bg-slate-900 p-2 text-left text-[0.66rem] font-normal text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        <span className="mb-1 block font-semibold">Factor percentiles</span>
        {SCORE_FACTORS.map(([label, key]) => {
          const v = h[key]
          return (
            <span key={label} className="flex justify-between gap-2">
              <span className="text-slate-300">{label}</span>
              <span className="tabular-nums">
                {v == null ? DASH : v.toFixed(0)}
              </span>
            </span>
          )
        })}
      </span>
    </span>
  )
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align = 'left',
  children,
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; dir: SortDir }
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
  children?: ReactNode
}) {
  const active = sort.key === k
  return (
    <th
      className={`cursor-pointer select-none px-2 py-2 ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => onSort(k)}
      aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {children}
        <span
          aria-hidden
          className={active ? 'text-indigo-600' : 'text-slate-300'}
        >
          {active ? (sort.dir === -1 ? '▼' : '▲') : '↕'}
        </span>
      </span>
    </th>
  )
}

const N_COLS = 13

// ── Main component ──────────────────────────────────────────────────────────

export function HoldingsDiagnostic(props: HoldingsDiagnosticProps): JSX.Element {
  const { holdings, quotes, analytics, flags, asOf, onOpenSimulator } = props

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'value',
    dir: -1,
  })
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [filterSector, setFilterSector] = useState<string>('all')

  // ── Derived rows: live overlay → filter → sort → group ──
  const allRows = withLiveWeights(holdings.map((h) => buildRow(h, quotes)))
  const filtered =
    filterSector === 'all'
      ? allRows
      : allRows.filter((r) => r.h.sector === filterSector)

  const sorted = [...filtered].sort((a, b) => {
    if (sort.key === 'ticker') {
      return (a.h.ticker ?? '').localeCompare(b.h.ticker ?? '') * sort.dir
    }
    const va = sortVal(a, sort.key)
    const vb = sortVal(b, sort.key)
    if (va == null && vb == null) return 0
    if (va == null) return 1 // nulls last regardless of direction
    if (vb == null) return -1
    return (va - vb) * sort.dir
  })

  // Groups preserve the sorted order; labels appear in first-seen order.
  const groups: Array<{ label: string | null; rows: Row[] }> = []
  if (groupBy === 'none') {
    groups.push({ label: null, rows: sorted })
  } else {
    const byLabel = new Map<string, Row[]>()
    for (const r of sorted) {
      const label =
        groupBy === 'sector'
          ? (r.h.sector ?? 'Other')
          : ltstLabel(r.h, asOf)
      const bucket = byLabel.get(label)
      if (bucket) bucket.push(r)
      else byLabel.set(label, [r])
    }
    for (const [label, rows] of byLabel) groups.push({ label, rows })
  }

  const sectorSet = new Set<string>()
  for (const h of holdings) {
    if (h.sector) sectorSet.add(h.sector)
  }
  const sectors = [...sectorSet].sort()

  // Only rows with a ticker are selectable (CSV / batch actions need one).
  const selectableIds: number[] = []
  for (const r of sorted) {
    if (r.h.ticker) selectableIds.push(r.h.security_id)
  }
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  // ── Handlers ──
  const onSort = (k: SortKey) => {
    setSort((s) =>
      s.key === k
        ? { key: k, dir: (s.dir * -1) as SortDir }
        : { key: k, dir: k === 'ticker' ? 1 : -1 },
    )
  }

  const toggleExpanded = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(selectableIds))
  }

  const exportCsv = () => {
    const rows = sorted.filter(
      (r) => r.h.ticker && selected.has(r.h.security_id),
    )
    if (rows.length === 0) return
    const blob = new Blob([buildCsv(rows)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'holdings-selected.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ──
  return (
    <div className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="Group holdings by"
          className={`${FORM_INPUT} text-[0.72rem]`}
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
        >
          <option value="none">Group: None</option>
          <option value="sector">Group: Sector</option>
          <option value="ltst">Group: LT vs ST</option>
        </select>
        <select
          aria-label="Filter by sector"
          className={`${FORM_INPUT} text-[0.72rem]`}
          value={filterSector}
          onChange={(e) => setFilterSector(e.target.value)}
        >
          <option value="all">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {selected.size >= 1 && (
          <div className="ml-auto flex items-center gap-3 rounded-lg bg-slate-900 px-3 py-2 text-[0.72rem] text-white">
            <span className="font-semibold">☑ {selected.size} selected</span>
            <button
              type="button"
              className="rounded bg-indigo-600 px-2.5 py-1 font-semibold hover:bg-indigo-500"
              onClick={() => onOpenSimulator(null)}
            >
              Rebalance…
            </button>
            <button
              type="button"
              className="rounded border border-white/30 px-2.5 py-1 hover:bg-white/10"
              onClick={exportCsv}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="text-slate-300 hover:text-white"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[0.74rem]">
          <thead>
            <tr className={TABLE_HEAD_ROW}>
              <th className="w-7 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all holdings"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
              </th>
              <SortHeader label="Ticker" k="ticker" sort={sort} onSort={onSort} />
              <th className="px-2 py-2">30D</th>
              <th className="px-2 py-2">Sector</th>
              <th className="px-2 py-2 text-right">Shares</th>
              <th className="px-2 py-2 text-right">Avg cost</th>
              <th className="px-2 py-2 text-right">Price</th>
              <SortHeader label="Day" k="day" sort={sort} onSort={onSort} align="right" />
              <SortHeader label="Value" k="value" sort={sort} onSort={onSort} align="right" />
              <SortHeader label="Weight" k="weight" sort={sort} onSort={onSort} align="right" />
              <SortHeader label="Unrealized P/L" k="pl" sort={sort} onSort={onSort} align="right" />
              <SortHeader label="Score" k="score" sort={sort} onSort={onSort} align="right">
                <span onClick={(e) => e.stopPropagation()}>
                  <InfoTip text="Composite factor percentile — hover a value for the factor breakdown" />
                </span>
              </SortHeader>
              <th className="w-7 px-2 py-2">⚠</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={N_COLS}
                  className="px-2 py-6 text-center text-slate-400"
                >
                  No holdings match this filter.
                </td>
              </tr>
            )}
            {groups.map((g, gi) => (
              <GroupRows
                key={g.label ?? `all-${gi}`}
                group={g}
                analytics={analytics}
                flags={flags}
                asOf={asOf}
                quotes={quotes}
                expanded={expanded}
                selected={selected}
                onToggleExpanded={toggleExpanded}
                onToggleSelected={toggleSelected}
                onOpenSimulator={onOpenSimulator}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[0.66rem] text-slate-400">
        Score = composite factor percentile. Correlations are trailing-1Y daily
        returns. Price/day use live quotes when available (~15m delayed).
      </p>
    </div>
  )
}

// ── Row rendering (module top-level components) ─────────────────────────────

interface GroupRowsProps {
  group: { label: string | null; rows: Row[] }
  analytics: PortfolioAnalyticsResponse | undefined
  flags: PortfolioFlag[]
  asOf: string
  quotes: HoldingsDiagnosticProps['quotes']
  expanded: Set<number>
  selected: Set<number>
  onToggleExpanded: (id: number) => void
  onToggleSelected: (id: number) => void
  onOpenSimulator: (ticker: string | null) => void
}

function GroupRows({
  group,
  analytics,
  flags,
  asOf,
  quotes,
  expanded,
  selected,
  onToggleExpanded,
  onToggleSelected,
  onOpenSimulator,
}: GroupRowsProps) {
  return (
    <>
      {group.label != null && (
        <tr>
          <td
            colSpan={N_COLS}
            className="bg-slate-50 px-2 py-1 text-[0.66rem] font-bold uppercase text-slate-400"
          >
            {group.label}
          </td>
        </tr>
      )}
      {group.rows.map((r) => (
        <HoldingRow
          key={r.h.security_id}
          row={r}
          analytics={analytics}
          flags={flags}
          asOf={asOf}
          quotes={quotes}
          isExpanded={expanded.has(r.h.security_id)}
          isSelected={selected.has(r.h.security_id)}
          onToggleExpanded={onToggleExpanded}
          onToggleSelected={onToggleSelected}
          onOpenSimulator={onOpenSimulator}
        />
      ))}
    </>
  )
}

interface HoldingRowProps {
  row: Row
  analytics: PortfolioAnalyticsResponse | undefined
  flags: PortfolioFlag[]
  asOf: string
  quotes: HoldingsDiagnosticProps['quotes']
  isExpanded: boolean
  isSelected: boolean
  onToggleExpanded: (id: number) => void
  onToggleSelected: (id: number) => void
  onOpenSimulator: (ticker: string | null) => void
}

function HoldingRow({
  row,
  analytics,
  flags,
  asOf,
  isExpanded,
  isSelected,
  onToggleExpanded,
  onToggleSelected,
  onOpenSimulator,
}: HoldingRowProps) {
  const { h, price, live, day, value, pl } = row
  const interactive = h.ticker != null // null-ticker rows: display only
  const warn = warnFor(h, flags)
  const plPct = pl != null && h.cost_basis > 0 ? pl / h.cost_basis : null

  return (
    <>
      <tr
        className={`border-b border-[#f3f4f6] ${interactive ? 'cursor-pointer hover:bg-slate-50' : ''}`}
        onClick={interactive ? () => onToggleExpanded(h.security_id) : undefined}
      >
        <td className="px-2 py-2">
          <input
            type="checkbox"
            aria-label={`Select ${h.ticker ?? 'holding'}`}
            checked={isSelected}
            disabled={!interactive}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelected(h.security_id)}
          />
        </td>
        <td className="px-2 py-2 font-bold text-slate-800">
          {h.ticker ?? DASH}
        </td>
        <td className="px-2 py-2">
          <Sparkline
            data={h.ticker ? (analytics?.sparks?.[h.ticker] ?? null) : null}
            width={80}
            height={20}
            color={plColor(day)}
            title={`${h.ticker ?? ''} 30-session closes`}
          />
        </td>
        <td className="px-2 py-2">
          <span
            className="rounded px-1.5 py-0.5 text-[0.62rem] font-semibold text-white"
            style={{ background: sectorColor(h.sector) }}
          >
            {sectorShort(h.sector)}
          </span>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">
          {fmtShares(h.shares)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">
          {fmtPrice(h.avg_cost)}
        </td>
        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
          {fmtPrice(price)}
          {live && (
            <span
              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500"
              title="Live quote (~15m delayed)"
            />
          )}
        </td>
        <td
          className="px-2 py-2 text-right tabular-nums"
          style={{ color: plColor(day) }}
        >
          {fmtSignedPct(day)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{fmtPrice(value)}</td>
        <td className="px-2 py-2 text-right font-semibold tabular-nums">
          {row.liveWeight == null ? DASH : `${(row.liveWeight * 100).toFixed(1)}%`}
        </td>
        <td
          className="whitespace-nowrap px-2 py-2 text-right tabular-nums"
          style={{ color: plColor(pl) }}
        >
          {pl == null ? DASH : `${fmtSignedMoney(pl)} (${fmtSignedPct(plPct)})`}
        </td>
        <td className="px-2 py-2 text-right">
          <ScorePopover h={h} />
        </td>
        <td className="px-2 py-2 text-center">
          {warn && (
            <span
              title={warn.title}
              className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[0.62rem] font-bold ${
                warn.tone === 'red'
                  ? 'bg-red-100 text-red-600'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              !
            </span>
          )}
        </td>
      </tr>
      {interactive && isExpanded && (
        <SubRow row={row} analytics={analytics} asOf={asOf} onOpenSimulator={onOpenSimulator} />
      )}
    </>
  )
}

function SubRow({
  row,
  analytics,
  asOf,
  onOpenSimulator,
}: {
  row: Row
  analytics: PortfolioAnalyticsResponse | undefined
  asOf: string
  onOpenSimulator: (ticker: string | null) => void
}) {
  const { h } = row
  const ticker = h.ticker as string // SubRow is only rendered for ticker'd rows
  const { top, diversifier } = corrBadges(ticker, analytics)
  const hasLt = h.lots.some((l) => isLongTerm(l.acquired, asOf))
  const hasSt = h.lots.some((l) => !isLongTerm(l.acquired, asOf))

  return (
    <tr className="bg-slate-50">
      <td colSpan={N_COLS} className="px-9 py-2 text-[0.7rem] text-slate-500">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* Tax lots */}
          {h.lt_unrealized != null && hasLt && (
            <span className="rounded bg-green-100 px-1.5 text-[0.62rem] font-semibold text-green-700">
              LT {fmtSignedMoney(h.lt_unrealized)}
            </span>
          )}
          {h.st_unrealized != null && hasSt && (
            <span className="rounded bg-amber-100 px-1.5 text-[0.62rem] font-semibold text-amber-800">
              ST {fmtSignedMoney(h.st_unrealized)}
            </span>
          )}
          {h.oldest_acquired && <span>since {fmtDate(h.oldest_acquired)}</span>}
          {h.wash_sale_risk && (
            <span
              className="rounded bg-red-100 px-1.5 text-[0.62rem] font-semibold text-red-700"
              title="Bought within the last 30 days while at a loss — selling now may disallow the loss"
            >
              wash-sale risk
            </span>
          )}

          {/* Thesis */}
          {h.thesis ? (
            <span>
              Thesis:{' '}
              <Link to="/theses" className="text-indigo-600 hover:underline">
                &quot;{truncate(h.thesis.summary ?? 'View thesis', 60)}&quot;
              </Link>
            </span>
          ) : (
            <Link to="/theses" className="text-slate-400 hover:text-indigo-600">
              + add thesis
            </Link>
          )}

          {/* Correlations */}
          {(top.length > 0 || diversifier) && (
            <span className="inline-flex items-center gap-1.5">
              <span>Correl:</span>
              {top.map((b) => (
                <span
                  key={b.ticker}
                  className={`rounded px-1.5 text-[0.62rem] font-semibold tabular-nums ${corrTone(b.c)}`}
                >
                  {b.ticker} {b.c.toFixed(2)}
                </span>
              ))}
              {diversifier && (
                <span className="text-[0.62rem] font-semibold text-green-700">
                  diversifier ✓
                </span>
              )}
            </span>
          )}

          {/* Quick actions */}
          <span className="flex gap-1.5">
            <button
              type="button"
              className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[0.66rem] hover:border-indigo-400 hover:text-indigo-600"
              onClick={(e) => {
                e.stopPropagation()
                onOpenSimulator(ticker)
              }}
            >
              Simulate
            </button>
            <Link
              to={`/securities/${ticker}`}
              className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[0.66rem] hover:border-indigo-400 hover:text-indigo-600"
              onClick={(e) => e.stopPropagation()}
            >
              Deep-dive →
            </Link>
          </span>
        </div>
      </td>
    </tr>
  )
}
