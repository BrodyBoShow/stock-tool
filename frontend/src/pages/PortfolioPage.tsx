import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ErrorCard } from '@/components/ErrorCard'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/Toast'
import {
  addPortfolioTransactions,
  connectPortfolioLink,
  deletePortfolioLink,
  deletePortfolioTransaction,
  getPortfolio,
  getPortfolioLinks,
  getPortfolioTransactions,
  getProjection,
  getQuotes,
  syncPortfolioLink,
} from '@/lib/api'
import { plColor } from '@/lib/colors'
import { fmtDate, fmtPctl, fmtPrice, fmtRatio, fmtSignedPct } from '@/lib/format'
import type {
  PortfolioHolding,
  PortfolioResponse,
  PortfolioTransactionCreate,
  PortfolioTransactionRow,
  PortfolioTxnType,
} from '@/types/api'

const TXN_TYPES: { value: PortfolioTxnType; label: string }[] = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
  { value: 'dividend', label: 'Dividend (cash)' },
  { value: 'deposit', label: 'Cash deposit' },
  { value: 'withdrawal', label: 'Cash withdrawal' },
  { value: 'fee', label: 'Fee' },
]
const NEEDS_TICKER: PortfolioTxnType[] = ['buy', 'sell', 'dividend']
const NEEDS_SHARES: PortfolioTxnType[] = ['buy', 'sell']

const fmtSignedMoney = (x: number | null | undefined) =>
  x == null
    ? '—'
    : `${x < 0 ? '-' : '+'}$${Math.abs(x).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`

/** Growth of $1 (time-weighted, deposits stripped out) vs SPY. */
function TwrChart({ data }: { data: PortfolioResponse }) {
  const points = useMemo(() => {
    const p = data.performance
    if (!p) return []
    return p.dates.map((d, i) => ({
      date: d,
      portfolio: p.twr_curve[i] ?? null,
      spy: p.spy_curve[i] ?? null,
    }))
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          minTickGap={48}
          tickFormatter={(d: string) => d.slice(0, 7)}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickFormatter={(v: number) => `${v.toFixed(2)}x`}
          domain={['auto', 'auto']}
          width={52}
        />
        <Tooltip
          labelFormatter={(d) => fmtDate(String(d))}
          formatter={(v: number, name: string) => [`${v?.toFixed(3)}x`, name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="portfolio" name="Portfolio (TWR)"
          stroke="#4f46e5" strokeWidth={2.2} dot={false} connectNulls />
        <Line type="monotone" dataKey="spy" name="S&P 500 (SPY)"
          stroke="#0ea5e9" strokeWidth={1.8} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Market value vs the cash you actually put in — flows separated from growth. */
function ValueChart({ data }: { data: PortfolioResponse }) {
  const points = useMemo(() => {
    const p = data.performance
    if (!p) return []
    return p.dates.map((d, i) => ({
      date: d,
      value: p.value[i] ?? null,
      invested: p.net_invested[i] ?? null,
    }))
  }, [data])

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          minTickGap={48}
          tickFormatter={(d: string) => d.slice(0, 7)}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickFormatter={(v: number) =>
            Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
            : Math.abs(v) >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${v.toFixed(0)}`}
          domain={['auto', 'auto']}
          width={56}
        />
        <Tooltip
          labelFormatter={(d) => fmtDate(String(d))}
          formatter={(v: number, name: string) => [fmtPrice(v), name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="value" name="Market value"
          stroke="#4f46e5" strokeWidth={2} fill="url(#pf-fill)" />
        <Line type="stepAfter" dataKey="invested" name="Net invested"
          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** Horizontal 0-100 percentile bars with a universe-median marker at 50. */
function TiltBars({ data }: { data: PortfolioResponse }) {
  const tilt = data.factor_tilt
  if (!tilt || tilt.composite == null) {
    return (
      <p className="text-sm text-gray-400">
        None of the current holdings have factor scores yet.
      </p>
    )
  }
  const rows: { label: string; v: number | undefined }[] = [
    { label: 'Composite', v: tilt.composite },
    { label: 'Growth', v: tilt.growth_pctl },
    { label: 'Value', v: tilt.value_pctl },
    { label: 'Quality', v: tilt.quality_pctl },
    { label: 'Momentum', v: tilt.momentum_pctl },
  ]
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <div className="w-20 shrink-0 text-[0.78rem] font-semibold text-slate-600">
            {r.label}
          </div>
          <div className="relative h-3.5 flex-1 rounded-full bg-slate-100">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600"
              style={{ width: `${Math.max(2, r.v ?? 0)}%` }}
            />
            {/* universe-median marker */}
            <div className="absolute inset-y-[-3px] left-1/2 w-px bg-slate-300" />
          </div>
          <div className="w-10 shrink-0 text-right text-[0.8rem] font-bold tabular-nums text-slate-800">
            {fmtPctl(r.v)}
          </div>
        </div>
      ))}
      <p className="pt-1 text-[0.72rem] text-gray-400">
        Market-value-weighted percentile of your holdings (50 = universe median).
        Coverage: {(tilt.coverage * 100).toFixed(0)}% of position value is scored.
      </p>
    </div>
  )
}

const SECTOR_COLORS = [
  '#4f46e5', '#0ea5e9', '#059669', '#d97706', '#dc2626',
  '#7c3aed', '#0d9488', '#be185d', '#65a30d', '#475569', '#94a3b8',
]

function AllocationBars({ data }: { data: PortfolioResponse }) {
  const sectors = data.allocation?.sectors ?? []
  if (!sectors.length) return <p className="text-sm text-gray-400">No positions.</p>
  return (
    <div className="space-y-2.5">
      {/* stacked strip */}
      <div className="flex h-4 w-full overflow-hidden rounded-full">
        {sectors.map((s, i) => (
          <div
            key={s.sector}
            title={`${s.sector} ${(s.weight! * 100).toFixed(1)}%`}
            style={{
              width: `${(s.weight ?? 0) * 100}%`,
              background: SECTOR_COLORS[i % SECTOR_COLORS.length],
            }}
          />
        ))}
      </div>
      <div className="space-y-1.5 pt-1">
        {sectors.map((s, i) => (
          <div key={s.sector} className="flex items-center gap-2.5 text-[0.8rem]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: SECTOR_COLORS[i % SECTOR_COLORS.length] }}
            />
            <span className="flex-1 truncate text-slate-600">{s.sector}</span>
            <span className="tabular-nums font-semibold text-slate-800">
              {((s.weight ?? 0) * 100).toFixed(1)}%
            </span>
            <span className="w-24 text-right tabular-nums text-slate-400">
              {fmtPrice(s.value)}
            </span>
          </div>
        ))}
        {data.allocation?.cash != null && (
          <div className="flex items-center gap-2.5 border-t border-slate-100 pt-1.5 text-[0.8rem]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-slate-200" />
            <span className="flex-1 text-slate-600">Cash</span>
            <span className="w-24 text-right tabular-nums text-slate-400">
              {fmtPrice(data.allocation.cash)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-card border border-gray-200 bg-white px-4 py-3.5 shadow-card">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-slate-400">
        {label}
      </div>
      <div
        className="mt-1 text-[1.25rem] font-extrabold tabular-nums leading-tight"
        style={{ color: color ?? '#0f172a' }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.72rem] text-slate-400">{sub}</div>}
    </div>
  )
}

// ── transaction entry ─────────────────────────────────────────────────────────

const emptyForm = {
  txn_type: 'buy' as PortfolioTxnType,
  ticker: '',
  trade_date: new Date().toISOString().slice(0, 10),
  shares: '',
  price: '',
  amount: '',
  note: '',
}

function AddTransactionForm({ onDone }: { onDone?: () => void }) {
  const [form, setForm] = useState(emptyForm)
  const qc = useQueryClient()
  const toast = useToast()

  const mut = useMutation({
    mutationFn: (t: PortfolioTransactionCreate) => addPortfolioTransactions([t]),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portfolio'] })
      toast('success', 'Transaction added')
      setForm((f) => ({ ...emptyForm, txn_type: f.txn_type, trade_date: f.trade_date }))
      onDone?.()
    },
    onError: (e: Error) => toast('error', e.message),
  })

  const needsTicker = NEEDS_TICKER.includes(form.txn_type)
  const needsShares = NEEDS_SHARES.includes(form.txn_type)
  const needsAmount = !needsShares
  const num = (s: string) => (s.trim() === '' ? null : Number(s))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    mut.mutate({
      txn_type: form.txn_type,
      trade_date: form.trade_date,
      ticker: needsTicker ? form.ticker.trim().toUpperCase() : null,
      shares: needsShares ? num(form.shares) : null,
      price: needsShares ? num(form.price) : null,
      amount: num(form.amount),
      note: form.note.trim() || null,
    })
  }

  const inputCls =
    'rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[0.84rem] ' +
    'text-slate-800 focus:border-indigo-600 focus:outline-none'

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2.5">
      <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-slate-500">
        Type
        <select
          value={form.txn_type}
          onChange={(e) =>
            setForm({ ...form, txn_type: e.target.value as PortfolioTxnType })}
          className={inputCls}
        >
          {TXN_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>
      {needsTicker && (
        <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-slate-500">
          Ticker
          <input
            value={form.ticker}
            onChange={(e) => setForm({ ...form, ticker: e.target.value })}
            placeholder="AAPL"
            required
            className={inputCls + ' w-24 uppercase'}
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-slate-500">
        Date
        <input
          type="date"
          value={form.trade_date}
          onChange={(e) => setForm({ ...form, trade_date: e.target.value })}
          required
          className={inputCls}
        />
      </label>
      {needsShares && (
        <>
          <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-slate-500">
            Shares
            <input
              type="number" step="any" min="0"
              value={form.shares}
              onChange={(e) => setForm({ ...form, shares: e.target.value })}
              required
              className={inputCls + ' w-24'}
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-slate-500">
            Price / share
            <input
              type="number" step="any" min="0"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
              className={inputCls + ' w-28'}
            />
          </label>
        </>
      )}
      <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-slate-500">
        {needsShares ? 'Total $ (optional)' : 'Amount $'}
        <input
          type="number" step="any" min="0"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          required={needsAmount}
          placeholder={needsShares ? 'shares × price' : ''}
          className={inputCls + ' w-32'}
        />
      </label>
      <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[0.7rem] font-semibold text-slate-500">
        Note
        <input
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          placeholder="optional"
          className={inputCls}
        />
      </label>
      <button
        type="submit"
        disabled={mut.isPending}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-[0.82rem] font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
      >
        {mut.isPending ? 'Adding…' : 'Add'}
      </button>
    </form>
  )
}

/** CSV import: ticker,type,date,shares,price,amount,note (header required;
 *  column order free; extra columns ignored). */
function parseCsv(text: string): { txns: PortfolioTransactionCreate[]; error?: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return { txns: [], error: 'CSV needs a header row + data rows' }
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  const iType = col('type'), iDate = col('date')
  if (iType < 0 || iDate < 0)
    return { txns: [], error: 'CSV header must include at least: type, date' }
  const iTicker = col('ticker'), iShares = col('shares'),
        iPrice = col('price'), iAmount = col('amount'), iNote = col('note')
  const num = (v: string | undefined) => {
    const s = (v ?? '').replace(/[$,]/g, '').trim()
    return s === '' ? null : Number(s)
  }
  const txns: PortfolioTransactionCreate[] = []
  for (const line of lines.slice(1)) {
    const c = line.split(',').map((x) => x.trim())
    txns.push({
      txn_type: (c[iType] ?? '').toLowerCase() as PortfolioTxnType,
      trade_date: c[iDate] ?? '',
      ticker: iTicker >= 0 ? c[iTicker] || null : null,
      shares: iShares >= 0 ? num(c[iShares]) : null,
      price: iPrice >= 0 ? num(c[iPrice]) : null,
      amount: iAmount >= 0 ? num(c[iAmount]) : null,
      note: iNote >= 0 ? c[iNote] || null : null,
    })
  }
  return { txns }
}

function CsvImportButton() {
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const mut = useMutation({
    mutationFn: addPortfolioTransactions,
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['portfolio'] })
      toast('success', `Imported ${res.inserted} transactions`)
    },
    onError: (e: Error) => toast('error', e.message),
  })

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    void file.text().then((text) => {
      const { txns, error } = parseCsv(text)
      if (error) return toast('error', error)
      if (!txns.length) return toast('error', 'No rows found in the CSV')
      mut.mutate(txns)
    })
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={mut.isPending}
        title="Header: type,date plus ticker,shares,price,amount,note as needed"
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[0.78rem] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
      >
        {mut.isPending ? 'Importing…' : 'Import CSV'}
      </button>
    </>
  )
}

function LedgerTable({ rows }: { rows: PortfolioTransactionRow[] }) {
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
          <tr className="border-b border-[#eef1f6] text-left text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-slate-400">
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

function HoldingsTable({
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
          <tr className="border-b border-[#eef1f6] text-left text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-slate-400">
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

// ── page ──────────────────────────────────────────────────────────────────────

/** Forward Monte Carlo cone for the current holdings (correlated, real
 * covariance). Display-only; a projection, not a forecast. */
function ProjectionSection() {
  const [years, setYears] = useState(10)
  const [monthly, setMonthly] = useState(0)
  const [feePct, setFeePct] = useState(0)
  const [stress, setStress] = useState(false)
  const [params, setParams] = useState({ years: 10, monthly: 0, annual_fee: 0, stress: false })
  const { data, isFetching, error } = useQuery({
    queryKey: ['projection', params],
    queryFn: () => getProjection(params),
    staleTime: 5 * 60 * 1000,
  })

  const fmtMoney = (v: number | null | undefined) =>
    v == null
      ? '—'
      : Math.abs(v) >= 1000
        ? `$${Math.round(v / 1000).toLocaleString()}k`
        : `$${Math.round(v)}`

  const coneData = useMemo(() => {
    if (!data?.cone) return []
    return data.cone.years.map((y, i) => ({
      year: `Y${y}`,
      p10: data.cone!.p10[i],
      p50: data.cone!.p50[i],
      p90: data.cone!.p90[i],
      band: [data.cone!.p10[i], data.cone!.p90[i]] as [number, number],
    }))
  }, [data])

  const run = () => setParams({ years, monthly, annual_fee: feePct / 100, stress })

  return (
    <SectionCard
      title="Projection — Monte Carlo cone"
      hint="Simulates your current holdings forward, drawn correlated (Cholesky) so positions move together in stress. Volatility & correlation are trailing; expected returns are shrunk toward a market prior. A projection, not a forecast."
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-[0.72rem] font-semibold text-slate-600">
          Years
          <input
            type="number" min={1} max={40} value={years}
            onChange={(e) => setYears(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
            className="ml-2 w-16 rounded-lg border border-gray-200 px-2 py-1 text-[0.8rem]"
          />
        </label>
        <label className="text-[0.72rem] font-semibold text-slate-600">
          Monthly $
          <input
            type="number" min={0} step={50} value={monthly}
            onChange={(e) => setMonthly(Math.max(0, Number(e.target.value) || 0))}
            className="ml-2 w-24 rounded-lg border border-gray-200 px-2 py-1 text-[0.8rem]"
          />
        </label>
        <label className="text-[0.72rem] font-semibold text-slate-600">
          Fee %/yr
          <input
            type="number" min={0} max={10} step={0.1} value={feePct}
            onChange={(e) => setFeePct(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
            className="ml-2 w-16 rounded-lg border border-gray-200 px-2 py-1 text-[0.8rem]"
          />
        </label>
        <button
          type="button" onClick={() => setStress((s) => !s)} aria-pressed={stress}
          className={
            'rounded-lg border px-2.5 py-1 text-[0.74rem] font-semibold transition-colors ' +
            (stress ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-slate-500 hover:bg-slate-50')
          }
        >
          Stress regime
        </button>
        <button
          type="button" onClick={run} disabled={isFetching}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-[0.78rem] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
        >
          {isFetching ? 'Running…' : 'Run'}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-600">Couldn&rsquo;t run the projection.</p>
      ) : !data ? (
        <Skeleton className="h-[260px] w-full rounded-card" />
      ) : !data.has_portfolio ? (
        <p className="text-sm text-slate-500">Add holdings to project your portfolio forward.</p>
      ) : data.insufficient_history ? (
        <p className="text-sm text-slate-500">
          Not enough price history for your holdings to project yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={`Median in ${data.params?.years}y`} value={fmtMoney(data.terminal?.p50)} />
            <StatCard
              label="Range (P10–P90)"
              value={`${fmtMoney(data.terminal?.p10)} – ${fmtMoney(data.terminal?.p90)}`}
            />
            <StatCard label="You contribute" value={fmtMoney(data.contributed)} />
            <StatCard
              label="Typical worst drawdown"
              value={data.max_drawdown ? `${Math.round(data.max_drawdown.p50 * 100)}%` : '—'}
            />
          </div>
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={coneData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={56} tickFormatter={(v: number) => fmtMoney(v)} />
                <Tooltip
                  formatter={(value: number | number[], name) =>
                    Array.isArray(value)
                      ? [`${fmtMoney(value[0])} – ${fmtMoney(value[1])}`, 'P10–P90']
                      : [fmtMoney(value), name === 'p50' ? 'Median' : String(name)]
                  }
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
                />
                <Area dataKey="band" stroke="none" fill="#c7d2fe" fillOpacity={0.45} isAnimationActive={false} />
                <Line dataKey="p90" stroke="#a5b4fc" strokeWidth={1} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
                <Line dataKey="p10" stroke="#a5b4fc" strokeWidth={1} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
                <Line dataKey="p50" stroke="#4f46e5" strokeWidth={2.2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {data.prob_gain != null && (
            <p className="mt-2 text-[0.78rem] text-slate-600">
              In {Math.round(data.prob_gain * 100)}% of simulations the portfolio ends above what
              you put in{data.excluded && data.excluded.length > 0
                ? ` · excluded (too little history): ${data.excluded.join(', ')}`
                : ''}.
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[0.72rem] font-semibold text-slate-500">
              Assumptions — portfolio {Math.round((data.portfolio_assumptions?.ann_return ?? 0) * 100)}%/yr
              return, {Math.round((data.portfolio_assumptions?.ann_vol ?? 0) * 100)}% vol
              {data.stress ? ' · STRESS regime' : ''}
            </summary>
            <table className="mt-2 w-full text-[0.74rem]">
              <thead>
                <tr className="text-left text-[0.6rem] uppercase tracking-wide text-slate-400">
                  <th className="py-1">Holding</th>
                  <th className="py-1">Weight</th>
                  <th className="py-1">Return (used)</th>
                  <th className="py-1">Return (trailing)</th>
                  <th className="py-1">Vol</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings_assumptions?.map((a) => (
                  <tr key={a.ticker} className="border-t border-slate-50">
                    <td className="py-1 font-semibold text-slate-800">{a.ticker}</td>
                    <td className="py-1 tabular-nums">{Math.round(a.weight * 100)}%</td>
                    <td className="py-1 tabular-nums">{Math.round(a.ann_return * 100)}%</td>
                    <td className="py-1 tabular-nums text-gray-400">{Math.round(a.ann_return_trailing * 100)}%</td>
                    <td className="py-1 tabular-nums">{Math.round(a.ann_vol * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="mt-2 text-[0.7rem] text-gray-400">{data.disclaimer}</p>
        </>
      )}
    </SectionCard>
  )
}

/** Connect-a-brokerage card. "Connect" opens the SnapTrade portal (you log in
 * at Schwab there — read-only, we never see your password); "Sync now" pulls
 * trades/dividends into the ledger above, so the whole tab updates itself.
 * Re-syncing is duplicate-safe (de-duped by provider transaction id). */
function LinkedAccountsSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data } = useQuery({
    queryKey: ['portfolio', 'links'],
    queryFn: getPortfolioLinks,
    staleTime: 60 * 1000,
  })
  const providers = data?.providers ?? []
  const accounts = data?.accounts ?? []

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['portfolio', 'links'] })
    void qc.invalidateQueries({ queryKey: ['portfolio'] })
    void qc.invalidateQueries({ queryKey: ['portfolio', 'transactions'] })
  }

  const connectM = useMutation({
    mutationFn: (provider: string) => connectPortfolioLink(provider),
    onSuccess: (res) => {
      if (res.status === 'authorize' && res.authorize_url) {
        // Standard OAuth: leave to SnapTrade to authorize, return via the callback.
        window.location.href = res.authorize_url
      } else {
        toast('error', res.detail ?? 'That provider isn’t available yet.')
      }
    },
    onError: (e: Error) => toast('error', e.message),
  })

  // Surface the OAuth callback result (we return to /portfolio?linked=ok|error).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const linked = p.get('linked')
    if (!linked) return
    if (linked === 'ok') {
      toast('success', 'Brokerage linked! Click "Sync now" to import your transactions.')
    } else {
      toast('error', 'Linking failed or was cancelled — try Connect again.')
    }
    void qc.invalidateQueries({ queryKey: ['portfolio', 'links'] })
    p.delete('linked')
    const qs = p.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const syncM = useMutation({
    mutationFn: (id: number) => syncPortfolioLink(id),
    onSuccess: (res) => {
      if (res.pending) {
        toast('success', 'Still linking — finish in the SnapTrade window, then click Sync again.')
      } else {
        const skip = res.skipped_count ? ` (${res.skipped_count} skipped)` : ''
        toast('success', `Synced — ${res.inserted} new transaction${res.inserted === 1 ? '' : 's'} imported${skip}.`)
      }
      refresh()
    },
    onError: (e: Error) => toast('error', e.message),
  })

  const unlinkM = useMutation({
    mutationFn: (id: number) => deletePortfolioLink(id),
    onSuccess: () => {
      toast('success', 'Account unlinked — imported history kept.')
      refresh()
    },
    onError: (e: Error) => toast('error', e.message),
  })

  const busy = connectM.isPending || syncM.isPending || unlinkM.isPending

  return (
    <SectionCard
      title="Connect a brokerage — auto-sync"
      hint="Link a broker to pull trades & dividends into the ledger above, so the tab updates itself. Strictly read-only: you log in at the broker — StockBud never sees your password and never places trades."
    >
      {accounts.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[0.84rem]"
            >
              <span className="font-semibold text-slate-800">
                {a.display_name ?? a.provider}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500">
                {a.status}
                {a.last_synced_at ? ` · ${fmtDate(a.last_synced_at.slice(0, 10))}` : ''}
              </span>
              {a.last_error && (
                <span className="text-[0.7rem] text-red-600">{a.last_error}</span>
              )}
              <span className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => syncM.mutate(a.id)}
                  className="rounded-full bg-indigo-50 px-3 py-1 text-[0.72rem] font-semibold text-indigo-600 disabled:opacity-50"
                >
                  {syncM.isPending ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => unlinkM.mutate(a.id)}
                  className="rounded-full px-3 py-1 text-[0.72rem] font-semibold text-slate-400 hover:text-red-600 disabled:opacity-50"
                >
                  Unlink
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {providers.map((p) => {
          const ready = p.implemented && p.configured
          const label = !p.implemented
            ? 'Coming soon'
            : p.configured
              ? 'Ready to connect'
              : 'Add API keys to .env'
          return (
            <div
              key={p.key}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-[#fafbff] px-4 py-3"
            >
              <div>
                <div className="text-[0.9rem] font-bold text-slate-800">{p.label}</div>
                <div className="text-[0.72rem] text-slate-400">{label}</div>
              </div>
              <button
                type="button"
                disabled={!ready || busy}
                onClick={() => connectM.mutate(p.key)}
                className={
                  'rounded-full px-3.5 py-1.5 text-[0.74rem] font-semibold transition-shadow ' +
                  (ready
                    ? 'bg-indigo-600 text-white hover:shadow-[0_2px_10px_rgba(79,70,229,0.4)] disabled:opacity-50'
                    : 'cursor-not-allowed bg-slate-100 text-gray-400')
                }
              >
                {!p.implemented ? 'Soon' : connectM.isPending ? 'Opening…' : 'Connect'}
              </button>
            </div>
          )
        })}
      </div>

      {data && !data.ready && (
        <p className="mt-3 text-[0.72rem] text-gray-400">
          Setup pending — apply migration 0021_linked_accounts to enable account linking.
        </p>
      )}
      <p className="mt-2 text-[0.7rem] text-gray-400">
        Read-only. After connecting, click "Sync now" to import — it can take a moment
        after you finish the broker login while data populates. Re-syncing never
        double-imports.
      </p>
    </SectionCard>
  )
}

export function PortfolioPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['portfolio'],
    queryFn: getPortfolio,
    staleTime: 60 * 1000,
  })
  const { data: txnData } = useQuery({
    queryKey: ['portfolio', 'transactions'],
    queryFn: getPortfolioTransactions,
    staleTime: 60 * 1000,
  })
  const { data: quotesData } = useQuery({
    queryKey: ['quotes'],
    queryFn: getQuotes,
    staleTime: 5 * 60 * 1000,
    enabled: !!data?.has_transactions,
  })
  const [chartMode, setChartMode] = useState<'twr' | 'value'>('twr')

  if (isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-[120px] w-full rounded-card" />
        <Skeleton className="h-[380px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  const ledgerRows = txnData?.rows ?? []

  if (!data.has_transactions) {
    return (
      <div className="space-y-5">
        <div className="rounded-card border border-gray-200 bg-white p-10 text-center shadow-card">
          <h1 className="text-xl font-extrabold text-slate-900">Portfolio</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-sm text-slate-500">
            Log your real buys and sells and StockBud derives everything else from
            its own nightly price, dividend, and factor data: time-weighted returns
            vs the S&amp;P 500, risk stats, factor tilt, sector concentration, and
            automatic dividend income. Start by adding your first transaction below
            — splits and dividends are handled for you.
          </p>
        </div>
        <SectionCard
          title="Add your first transaction"
          hint="Enter the shares and price as they were on the trade date — later splits are applied automatically."
        >
          <AddTransactionForm />
          <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
            <CsvImportButton />
            <span className="text-[0.74rem] text-gray-400">
              or bulk-import a CSV with header columns: type, date, ticker, shares,
              price, amount, note
            </span>
          </div>
        </SectionCard>
      </div>
    )
  }

  const s = data.summary!
  const quotes = quotesData?.quotes ?? {}

  // Live-adjust the headline figures so the big number, "today", unrealized P/L
  // and weights reconcile with the live-quote overlay shown on the holdings rows
  // (otherwise the header reads the Jun-17 close while the table shows live Jun-18
  // prices — the same total computed two different ways). Returns, risk, drawdown
  // and realized/dividends stay end-of-day: they're derived from the close series
  // and can't be computed intraday. Falls back to the backend summary when no live
  // quote is available (nights/weekends), so the header matches the table then too.
  const anyLive = data.holdings.some((h) => h.ticker && quotes[h.ticker]?.price != null)
  const liveTotal = data.holdings.reduce((acc, h) => {
    const live = h.ticker ? quotes[h.ticker]?.price ?? null : null
    return acc + (live != null ? live * h.shares : h.market_value ?? 0)
  }, 0)
  const liveDayPL = data.holdings.reduce((acc, h) => {
    const q = h.ticker ? quotes[h.ticker] : undefined
    const live = q?.price ?? null
    const value = live != null ? live * h.shares : h.market_value
    const day = q?.change_pct != null ? q.change_pct / 100 : h.day_change_pct
    if (value == null || day == null) return acc
    return acc + (value * day) / (1 + day)
  }, 0)
  const view = anyLive
    ? {
        live: true,
        total_value: liveTotal,
        day_change: liveDayPL,
        day_change_pct:
          liveTotal - liveDayPL !== 0 ? liveDayPL / (liveTotal - liveDayPL) : 0,
        unrealized_pl: liveTotal - s.cost_basis,
      }
    : {
        live: false,
        total_value: s.total_value,
        day_change: s.day_change,
        day_change_pct: s.day_change_pct,
        unrealized_pl: s.unrealized_pl,
      }

  return (
    <div className="space-y-5">
      {/* header */}
      <header className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
        <div className="h-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500" />
        <div className="px-7 pb-5 pt-6">
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
            <span className="text-indigo-600">StockBud</span>
            <span className="text-gray-300">/</span>
            <span className="text-slate-400">Portfolio</span>
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-slate-900">
                {fmtPrice(view.total_value)}
              </h1>
              <p className="mt-1 text-[0.9rem] text-slate-500">
                <span style={{ color: plColor(view.day_change) }} className="font-semibold">
                  {fmtSignedMoney(view.day_change)} ({fmtSignedPct(view.day_change_pct, 2)})
                </span>{' '}
                today · since {fmtDate(s.first_date)} ·{' '}
                {view.live
                  ? `live (~15m delayed) · returns as of ${fmtDate(s.as_of)}`
                  : `as of ${fmtDate(s.as_of)}`}
                {data.cash_tracking === false && ' · positions only (no cash ledger)'}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* summary stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Time-weighted return"
          value={fmtSignedPct(s.twr_total)}
          sub={`${fmtSignedPct(s.twr_cagr)} / yr · SPY ${fmtSignedPct(s.spy_total)}`}
          color={plColor(s.twr_total)}
        />
        <StatCard
          label="Money-weighted (IRR)"
          value={fmtSignedPct(s.mwr)}
          sub="your dollars, your timing"
          color={plColor(s.mwr)}
        />
        <StatCard
          label="Unrealized P/L"
          value={fmtSignedMoney(view.unrealized_pl)}
          sub={`cost basis ${fmtPrice(s.cost_basis)}`}
          color={plColor(view.unrealized_pl)}
        />
        <StatCard
          label="Realized + dividends"
          value={fmtSignedMoney(s.realized_pl + s.dividends_received)}
          sub={`${fmtSignedMoney(s.realized_pl)} realized · ${fmtPrice(s.dividends_received)} divs`}
          color={plColor(s.realized_pl + s.dividends_received)}
        />
        <StatCard
          label="Risk"
          value={`β ${fmtRatio(s.beta)}`}
          sub={`Sharpe ${fmtRatio(s.sharpe)} · Sortino ${fmtRatio(s.sortino)} · vol ${fmtSignedPct(s.volatility).replace('+', '')}`}
        />
        <StatCard
          label="Max drawdown"
          value={fmtSignedPct(s.max_drawdown)}
          sub={data.cash_tracking ? `cash ${fmtPrice(s.cash)}` : `net invested ${fmtPrice(s.net_invested)}`}
          color="#dc2626"
        />
      </div>

      {/* action center */}
      {data.flags.length > 0 && (
        <div className="rounded-card border border-gray-200 bg-white p-4 shadow-card">
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-slate-400">
            Things to review
          </div>
          <ul className="mt-2 space-y-1.5">
            {data.flags.map((f) => (
              <li key={f.kind + f.text} className="flex items-start gap-2 text-[0.84rem]">
                <span
                  className={
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full ' +
                    (f.level === 'warn' ? 'bg-amber-400' : 'bg-sky-400')
                  }
                />
                <span className="text-slate-600">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* performance chart */}
      <SectionCard
        title="Performance"
        hint="TWR strips out deposit/withdrawal timing — it's your picking skill, directly comparable to SPY. The value view shows your actual dollars vs what you put in."
      >
        <div className="mb-3 flex gap-[5px]">
          {(
            [
              ['twr', 'Growth of $1 vs SPY'],
              ['value', 'Value vs invested'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setChartMode(mode)}
              className="rounded-full px-[11px] py-[3px] text-[0.72rem] font-semibold transition-shadow"
              style={
                chartMode === mode
                  ? { background: '#eef2ff', color: '#4f46e5', boxShadow: 'inset 0 0 0 1.5px #4f46e5' }
                  : { background: '#ffffff', color: '#64748b', boxShadow: 'inset 0 0 0 1px #e5e7eb' }
              }
            >
              {label}
            </button>
          ))}
        </div>
        {chartMode === 'twr' ? <TwrChart data={data} /> : <ValueChart data={data} />}
      </SectionCard>

      {/* forward projection */}
      <ProjectionSection />

      {/* holdings */}
      <SectionCard
        title="Holdings"
        hint="Price and day change use live quotes when available (~15m delayed), otherwise the nightly close. Score = composite factor percentile."
      >
        <HoldingsTable holdings={data.holdings} quotes={quotes} />
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Factor tilt"
          hint="What your portfolio is actually made of, in the model's terms — catches accidental style bets (e.g. all momentum, no value)."
        >
          <TiltBars data={data} />
        </SectionCard>
        <SectionCard
          title="Allocation"
          hint="Sector weights of current positions."
        >
          <AllocationBars data={data} />
        </SectionCard>
      </div>

      {/* income */}
      {data.income && (
        <SectionCard
          title="Dividend income"
          hint="Credited automatically from ex-dividend data for the shares you held — no manual entry needed. Forward estimate = trailing 12-month rate × current shares."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Received (TTM)" value={fmtPrice(data.income.ttm_received)} />
            <StatCard label="Projected next 12M" value={fmtPrice(data.income.forward_12m)} />
            <StatCard
              label="Yield on cost"
              value={fmtSignedPct(data.income.yield_on_cost, 2).replace('+', '')}
            />
            <StatCard
              label="Current yield"
              value={fmtSignedPct(data.income.yield_on_value, 2).replace('+', '')}
            />
          </div>
        </SectionCard>
      )}

      {/* ledger */}
      <SectionCard
        title="Transactions"
        hint="The ledger everything above is computed from. Enter shares/prices as they were on the trade date — splits are applied automatically."
      >
        <AddTransactionForm />
        <div className="mt-3 flex items-center gap-3 border-b border-slate-100 pb-4">
          <CsvImportButton />
          <span className="text-[0.74rem] text-gray-400">
            CSV header: type, date (+ ticker, shares, price, amount, note as needed)
          </span>
        </div>
        <div className="mt-4">
          <LedgerTable rows={ledgerRows} />
        </div>
        {data.warnings.length > 0 && (
          <details className="mt-3 border-t border-slate-100 pt-2.5">
            <summary className="cursor-pointer select-none text-[0.72rem] font-semibold text-gray-400 hover:text-slate-500">
              Data notes ({data.warnings.length}) — minor ledger gaps, e.g.
              broker reinvest rows not imported
            </summary>
            <ul className="mt-1.5 space-y-1 pl-4 text-[0.72rem] text-gray-400">
              {data.warnings.map((w) => (
                <li key={w} className="list-disc">{w}</li>
              ))}
            </ul>
          </details>
        )}
      </SectionCard>

      {/* linked brokerage accounts (scaffold) */}
      <LinkedAccountsSection />

      <p className="pb-2 text-center text-xs text-gray-400">
        Tracking and analytics over your own ledger — measurements, not investment
        advice. Dividends/splits from nightly market data; figures may differ
        slightly from your broker.
      </p>
    </div>
  )
}
