import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { SectorPill } from '@/components/screener/SectorPill'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { InfoTip } from '@/components/ui/InfoTip'
import { useToast } from '@/components/ui/Toast'
import { deletePortfolioTransaction } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { FACTOR_TIP, TABLE_HEAD_ROW } from '@/lib/constants'
import { fmtDate, fmtPctl, fmtPrice, fmtSignedMoney, fmtSignedPct } from '@/lib/format'
import type { PortfolioHolding, PortfolioTransactionRow } from '@/types/api'

type LedgerSortKey = 'trade_date' | 'txn_type' | 'ticker' | 'amount'

export function LedgerTable({ rows }: { rows: PortfolioTransactionRow[] }) {
  const [toDelete, setToDelete] = useState<PortfolioTransactionRow | null>(null)
  const [sort, setSort] = useState<{ key: LedgerSortKey; dir: 1 | -1 }>({
    key: 'trade_date',
    dir: -1,
  })
  const qc = useQueryClient()
  const toast = useToast()
  const mut = useMutation({
    mutationFn: deletePortfolioTransaction,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portfolio'] })
      toast('success', 'Transaction removed')
      setToDelete(null)
    },
    onError: (e: Error) => toast('error', e.message),
  })

  if (!rows.length)
    return <p className="text-sm text-gray-400">No transactions yet.</p>

  const sorted = [...rows].sort((a, b) => {
    const get = (r: PortfolioTransactionRow): string | number | null => {
      switch (sort.key) {
        case 'trade_date': return r.trade_date
        case 'txn_type': return r.txn_type
        case 'ticker': return r.ticker ?? ''
        case 'amount': return r.amount
      }
    }
    const av = get(a), bv = get(b)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string' && typeof bv === 'string')
      return av.localeCompare(bv) * sort.dir
    return ((av as number) - (bv as number)) * sort.dir
  })
  const toggle = (k: LedgerSortKey) =>
    setSort((s) =>
      s.key === k
        ? { key: k, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 }
        : { key: k, dir: k === 'amount' ? -1 : 1 },
    )
  const arrow = (k: LedgerSortKey) =>
    sort.key === k ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''
  const lth = (k: LedgerSortKey, label: string, right = false) => (
    <th
      key={k}
      onClick={() => toggle(k)}
      className={`cursor-pointer select-none py-2 pr-4 hover:text-slate-600 ${right ? 'text-right' : ''}`}
    >
      {label}{arrow(k)}
    </th>
  )

  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-[0.82rem]">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className={TABLE_HEAD_ROW}>
            {lth('trade_date', 'Date')}
            {lth('txn_type', 'Type')}
            {lth('ticker', 'Ticker')}
            <th className="py-2 pr-4 text-right">Shares</th>
            <th className="py-2 pr-4 text-right">Price</th>
            {lth('amount', 'Amount', true)}
            <th className="py-2 pr-4">Note</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-b border-slate-50">
              <td className="py-2 pr-4 tabular-nums text-slate-600">{fmtDate(r.trade_date)}</td>
              <td className="py-2 pr-4 font-semibold capitalize text-slate-800">{r.txn_type}</td>
              <td className="py-2 pr-4 font-bold text-slate-800">
                {r.ticker ? (
                  <Link
                    to={`/securities/${r.ticker}`}
                    className="rounded hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600/40"
                  >
                    {r.ticker}
                  </Link>
                ) : '—'}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{r.shares ?? '—'}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{r.price != null ? fmtPrice(r.price) : '—'}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{r.amount != null ? fmtPrice(r.amount) : '—'}</td>
              <td className="max-w-[180px] truncate py-2 pr-4 text-slate-400">{r.note ?? ''}</td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  onClick={() => setToDelete(r)}
                  className="rounded-md px-2 py-0.5 text-[0.72rem] font-bold text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600/40"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={toDelete !== null}
        title="Delete transaction?"
        message={
          toDelete
            ? `${toDelete.txn_type} ${toDelete.ticker ?? ''} on ${fmtDate(toDelete.trade_date)} — every derived number recomputes without it.`
            : ''
        }
        confirmLabel="Delete"
        danger
        pending={mut.isPending}
        onConfirm={() => toDelete && mut.mutate(toDelete.id)}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}

type HoldSortKey =
  | 'ticker' | 'sector' | 'shares' | 'avg_cost' | 'price'
  | 'day' | 'value' | 'weight' | 'upl' | 'score'

export function HoldingsTable({
  holdings,
  quotes,
}: {
  holdings: PortfolioHolding[]
  quotes: Record<string, { price: number | null; change_pct: number | null }>
}) {
  const [sort, setSort] = useState<{ key: HoldSortKey; dir: 1 | -1 }>({
    key: 'value',
    dir: -1,
  })
  if (!holdings.length)
    return <p className="text-sm text-gray-400">No open positions.</p>
  // Weights are computed off the SAME (live-when-available) values shown in the
  // Value column, so the column reconciles with the live header total below.
  const liveTotal = holdings.reduce((acc, h) => {
    const live = h.ticker ? quotes[h.ticker]?.price ?? null : null
    return acc + (live != null ? live * h.shares : h.market_value ?? 0)
  }, 0)
  const derived = holdings.map((h) => {
    const q = h.ticker ? quotes[h.ticker] : undefined
    const live = q?.price ?? null
    const price = live ?? h.last_price
    const day = q?.change_pct != null ? q.change_pct / 100 : h.day_change_pct
    const value = live != null ? live * h.shares : h.market_value
    const weight = liveTotal > 0 && value != null ? value / liveTotal : h.weight
    const upl = value != null ? value - h.cost_basis : h.unrealized_pl
    const uplPct = upl != null && h.cost_basis > 0 ? upl / h.cost_basis : null
    return { h, price, day, value, weight, upl, uplPct }
  })
  type DRow = (typeof derived)[number]
  const keyOf = (r: DRow): number | string | null => {
    switch (sort.key) {
      case 'ticker': return r.h.ticker ?? ''
      case 'sector': return r.h.sector ?? ''
      case 'shares': return r.h.shares
      case 'avg_cost': return r.h.avg_cost
      case 'price': return r.price
      case 'day': return r.day
      case 'value': return r.value
      case 'weight': return r.weight
      case 'upl': return r.upl
      case 'score': return r.h.composite
    }
  }
  const sorted = [...derived].sort((a, b) => {
    const av = keyOf(a), bv = keyOf(b)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string' && typeof bv === 'string')
      return av.localeCompare(bv) * sort.dir
    return ((av as number) - (bv as number)) * sort.dir
  })
  const toggle = (k: HoldSortKey) =>
    setSort((sv) =>
      sv.key === k
        ? { key: k, dir: (sv.dir === 1 ? -1 : 1) as 1 | -1 }
        : { key: k, dir: k === 'ticker' || k === 'sector' ? 1 : -1 },
    )
  const arrow = (k: HoldSortKey) =>
    sort.key === k ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''
  const th = (k: HoldSortKey, label: string, left = false, tip?: string) => (
    <th
      key={k}
      onClick={() => toggle(k)}
      aria-sort={sort.key === k ? (sort.dir === -1 ? 'descending' : 'ascending') : 'none'}
      className={`cursor-pointer select-none py-2 pr-4 hover:text-slate-600 ${left ? '' : 'text-right'}`}
    >
      {label}{arrow(k)}
      {tip && (
        <span onClick={(e) => e.stopPropagation()}>
          <InfoTip text={tip} />
        </span>
      )}
    </th>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.84rem]">
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            {th('ticker', 'Ticker', true)}
            {th('sector', 'Sector', true)}
            {th('shares', 'Shares')}
            {th('avg_cost', 'Avg cost')}
            {th('price', 'Price')}
            {th('day', 'Day')}
            {th('value', 'Value')}
            {th('weight', 'Weight')}
            {th('upl', 'Unrealized P/L')}
            {th('score', 'Score', false, FACTOR_TIP.composite)}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ h, price, day, value, weight, upl, uplPct }) => (
            <tr key={h.security_id} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="py-2.5 pr-4">
                {h.ticker ? (
                  <Link
                    to={`/securities/${h.ticker}`}
                    className="rounded font-bold text-slate-800 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600/40"
                  >
                    {h.ticker}
                  </Link>
                ) : '—'}
                <div className="max-w-[180px] truncate text-[0.7rem] text-slate-400">
                  {h.name}
                </div>
              </td>
              <td className="py-2.5 pr-4"><SectorPill sector={h.sector} /></td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{h.shares}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{fmtPrice(h.avg_cost)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{fmtPrice(price)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: plColor(day) }}>
                {fmtSignedPct(day)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums font-semibold">
                {fmtPrice(value)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {weight != null ? `${(weight * 100).toFixed(1)}%` : '—'}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: plColor(upl) }}>
                {fmtSignedMoney(upl)}
                <span className="ml-1 text-[0.72rem]">({fmtSignedPct(uplPct)})</span>
              </td>
              <td
                className={`py-2.5 pr-4 text-right tabular-nums font-semibold ${
                  h.composite == null
                    ? 'text-slate-300'
                    : h.composite >= 50
                      ? 'text-indigo-600'
                      : 'text-slate-400'
                }`}
              >
                {fmtPctl(h.composite)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
