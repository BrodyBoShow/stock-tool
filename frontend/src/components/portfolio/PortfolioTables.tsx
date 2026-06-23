import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { deletePortfolioTransaction } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { TABLE_HEAD_ROW } from '@/lib/constants'
import { fmtDate, fmtPctl, fmtPrice, fmtSignedMoney, fmtSignedPct } from '@/lib/format'
import type { PortfolioHolding, PortfolioTransactionRow } from '@/types/api'

export function LedgerTable({ rows }: { rows: PortfolioTransactionRow[] }) {
  const [toDelete, setToDelete] = useState<PortfolioTransactionRow | null>(null)
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

  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-[0.82rem]">
        <thead className="sticky top-0 bg-white">
          <tr className={TABLE_HEAD_ROW}>
            <th className="py-2 pr-4">Date</th>
            <th className="py-2 pr-4">Type</th>
            <th className="py-2 pr-4">Ticker</th>
            <th className="py-2 pr-4 text-right">Shares</th>
            <th className="py-2 pr-4 text-right">Price</th>
            <th className="py-2 pr-4 text-right">Amount</th>
            <th className="py-2 pr-4">Note</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-50">
              <td className="py-2 pr-4 tabular-nums text-slate-600">{fmtDate(r.trade_date)}</td>
              <td className="py-2 pr-4 font-semibold capitalize text-slate-800">{r.txn_type}</td>
              <td className="py-2 pr-4 font-bold text-slate-800">
                {r.ticker ? (
                  <Link to={`/securities/${r.ticker}`} className="hover:text-indigo-600">
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
                  className="rounded-md px-2 py-0.5 text-[0.72rem] font-bold text-slate-400 hover:bg-red-50 hover:text-red-600"
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

export function HoldingsTable({
  holdings,
  quotes,
}: {
  holdings: PortfolioHolding[]
  quotes: Record<string, { price: number | null; change_pct: number | null }>
}) {
  if (!holdings.length)
    return <p className="text-sm text-gray-400">No open positions.</p>
  // Weights are computed off the SAME (live-when-available) values shown in the
  // Value column, so the column reconciles with the live header total below.
  const liveTotal = holdings.reduce((acc, h) => {
    const live = h.ticker ? quotes[h.ticker]?.price ?? null : null
    return acc + (live != null ? live * h.shares : h.market_value ?? 0)
  }, 0)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.84rem]">
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className="py-2 pr-4">Ticker</th>
            <th className="py-2 pr-4">Sector</th>
            <th className="py-2 pr-4 text-right">Shares</th>
            <th className="py-2 pr-4 text-right">Avg cost</th>
            <th className="py-2 pr-4 text-right">Price</th>
            <th className="py-2 pr-4 text-right">Day</th>
            <th className="py-2 pr-4 text-right">Value</th>
            <th className="py-2 pr-4 text-right">Weight</th>
            <th className="py-2 pr-4 text-right">Unrealized P/L</th>
            <th className="py-2 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const q = h.ticker ? quotes[h.ticker] : undefined
            const live = q?.price ?? null
            const price = live ?? h.last_price
            const day = q?.change_pct != null ? q.change_pct / 100 : h.day_change_pct
            const value = live != null ? live * h.shares : h.market_value
            const weight =
              liveTotal > 0 && value != null ? value / liveTotal : h.weight
            const upl = value != null ? value - h.cost_basis : h.unrealized_pl
            const uplPct = upl != null && h.cost_basis > 0 ? upl / h.cost_basis : null
            return (
              <tr key={h.security_id} className="border-b border-slate-50">
                <td className="py-2.5 pr-4">
                  {h.ticker ? (
                    <Link
                      to={`/securities/${h.ticker}`}
                      className="font-bold text-slate-800 hover:text-indigo-600"
                    >
                      {h.ticker}
                    </Link>
                  ) : '—'}
                  <div className="max-w-[180px] truncate text-[0.7rem] text-slate-400">
                    {h.name}
                  </div>
                </td>
                <td className="py-2.5 pr-4 text-slate-500">{h.sector ?? '—'}</td>
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
                <td className="py-2.5 text-right tabular-nums font-semibold">
                  {fmtPctl(h.composite)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
