import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/Toast'
import {
  addPortfolioTransactions,
  deletePortfolioTransaction,
  getPortfolio,
  getPortfolioTransactions,
  getQuotes,
} from '@/lib/api'
import { fmtDate, fmtPctl, fmtPrice } from '@/lib/format'
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

const fmtSignedPct = (x: number | null | undefined, dec = 1) =>
  x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(dec)}%`
const fmtSignedMoney = (x: number | null | undefined) =>
  x == null
    ? '—'
    : `${x < 0 ? '-' : '+'}$${Math.abs(x).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
const fmtCash = (x: number | null | undefined) =>
  x == null
    ? '—'
    : `$${x.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
const plColor = (x: number | null | undefined) =>
  x == null ? '#64748b' : x >= 0 ? '#059669' : '#dc2626'
const fmtRatio = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2))

function SectionCard({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="text-base font-bold text-[#111827]">{title}</div>
      {hint && <p className="mt-0.5 text-[0.78rem] text-[#9ca3af]">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

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
          formatter={(v: number, name: string) => [fmtCash(v), name]}
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
      <p className="text-sm text-[#9ca3af]">
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
          <div className="w-20 shrink-0 text-[0.78rem] font-semibold text-[#475569]">
            {r.label}
          </div>
          <div className="relative h-3.5 flex-1 rounded-full bg-[#f1f5f9]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#6366f1] to-[#4f46e5]"
              style={{ width: `${Math.max(2, r.v ?? 0)}%` }}
            />
            {/* universe-median marker */}
            <div className="absolute inset-y-[-3px] left-1/2 w-px bg-[#cbd5e1]" />
          </div>
          <div className="w-10 shrink-0 text-right text-[0.8rem] font-bold tabular-nums text-[#1e293b]">
            {fmtPctl(r.v)}
          </div>
        </div>
      ))}
      <p className="pt-1 text-[0.72rem] text-[#9ca3af]">
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
  if (!sectors.length) return <p className="text-sm text-[#9ca3af]">No positions.</p>
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
            <span className="flex-1 truncate text-[#475569]">{s.sector}</span>
            <span className="tabular-nums font-semibold text-[#1e293b]">
              {((s.weight ?? 0) * 100).toFixed(1)}%
            </span>
            <span className="w-24 text-right tabular-nums text-[#94a3b8]">
              {fmtCash(s.value)}
            </span>
          </div>
        ))}
        {data.allocation?.cash != null && (
          <div className="flex items-center gap-2.5 border-t border-[#f1f5f9] pt-1.5 text-[0.8rem]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#e2e8f0]" />
            <span className="flex-1 text-[#475569]">Cash</span>
            <span className="w-24 text-right tabular-nums text-[#94a3b8]">
              {fmtCash(data.allocation.cash)}
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
    <div className="rounded-card border border-[#e5e7eb] bg-white px-4 py-3.5 shadow-card">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
        {label}
      </div>
      <div
        className="mt-1 text-[1.25rem] font-extrabold tabular-nums leading-tight"
        style={{ color: color ?? '#0f172a' }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.72rem] text-[#94a3b8]">{sub}</div>}
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
    'rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[0.84rem] ' +
    'text-[#1e293b] focus:border-[#4f46e5] focus:outline-none'

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2.5">
      <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-[#64748b]">
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
        <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-[#64748b]">
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
      <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-[#64748b]">
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
          <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-[#64748b]">
            Shares
            <input
              type="number" step="any" min="0"
              value={form.shares}
              onChange={(e) => setForm({ ...form, shares: e.target.value })}
              required
              className={inputCls + ' w-24'}
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-[#64748b]">
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
      <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-[#64748b]">
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
      <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[0.7rem] font-semibold text-[#64748b]">
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
        className="rounded-lg bg-[#4f46e5] px-4 py-2 text-[0.82rem] font-bold text-white transition-colors hover:bg-[#4338ca] disabled:opacity-60"
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
        className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-1.5 text-[0.78rem] font-bold text-[#475569] transition-colors hover:bg-[#f8fafc] disabled:opacity-60"
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
    return <p className="text-sm text-[#9ca3af]">No transactions yet.</p>

  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-[0.82rem]">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-[#eef1f6] text-left text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
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
            <tr key={r.id} className="border-b border-[#f8fafc]">
              <td className="py-2 pr-4 tabular-nums text-[#475569]">{fmtDate(r.trade_date)}</td>
              <td className="py-2 pr-4 font-semibold capitalize text-[#1e293b]">{r.txn_type}</td>
              <td className="py-2 pr-4 font-bold text-[#1e293b]">
                {r.ticker ? (
                  <Link to={`/securities/${r.ticker}`} className="hover:text-[#4f46e5]">
                    {r.ticker}
                  </Link>
                ) : '—'}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{r.shares ?? '—'}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{r.price != null ? fmtPrice(r.price) : '—'}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{r.amount != null ? fmtCash(r.amount) : '—'}</td>
              <td className="max-w-[180px] truncate py-2 pr-4 text-[#94a3b8]">{r.note ?? ''}</td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  onClick={() => setToDelete(r)}
                  className="rounded-md px-2 py-0.5 text-[0.72rem] font-bold text-[#94a3b8] hover:bg-[#fef2f2] hover:text-[#dc2626]"
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
    return <p className="text-sm text-[#9ca3af]">No open positions.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.84rem]">
        <thead>
          <tr className="border-b border-[#eef1f6] text-left text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
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
            const upl = value != null ? value - h.cost_basis : h.unrealized_pl
            const uplPct = upl != null && h.cost_basis > 0 ? upl / h.cost_basis : null
            return (
              <tr key={h.security_id} className="border-b border-[#f8fafc]">
                <td className="py-2.5 pr-4">
                  {h.ticker ? (
                    <Link
                      to={`/securities/${h.ticker}`}
                      className="font-bold text-[#1e293b] hover:text-[#4f46e5]"
                    >
                      {h.ticker}
                    </Link>
                  ) : '—'}
                  <div className="max-w-[180px] truncate text-[0.7rem] text-[#94a3b8]">
                    {h.name}
                  </div>
                </td>
                <td className="py-2.5 pr-4 text-[#64748b]">{h.sector ?? '—'}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums">{h.shares}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums">{fmtPrice(h.avg_cost)}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums">{fmtPrice(price)}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: plColor(day) }}>
                  {fmtSignedPct(day)}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums font-semibold">
                  {fmtCash(value)}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums">
                  {h.weight != null ? `${(h.weight * 100).toFixed(1)}%` : '—'}
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
        <div className="rounded-card border border-[#e5e7eb] bg-white p-10 text-center shadow-card">
          <h1 className="text-xl font-extrabold text-[#0f172a]">Portfolio</h1>
          <p className="mx-auto mt-3 max-w-[560px] text-sm text-[#64748b]">
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
          <div className="mt-4 flex items-center gap-3 border-t border-[#f1f5f9] pt-4">
            <CsvImportButton />
            <span className="text-[0.74rem] text-[#9ca3af]">
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

  return (
    <div className="space-y-5">
      {/* header */}
      <header className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
        <div className="h-1 bg-gradient-to-r from-[#2563eb] via-[#4f46e5] to-[#0ea5e9]" />
        <div className="px-7 pb-5 pt-6">
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
            <span className="text-[#4f46e5]">StockBud</span>
            <span className="text-[#d1d5db]">/</span>
            <span className="text-[#94a3b8]">Portfolio</span>
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-[#0f172a]">
                {fmtCash(s.total_value)}
              </h1>
              <p className="mt-1 text-[0.9rem] text-[#64748b]">
                <span style={{ color: plColor(s.day_change) }} className="font-semibold">
                  {fmtSignedMoney(s.day_change)} ({fmtSignedPct(s.day_change_pct, 2)})
                </span>{' '}
                today · since {fmtDate(s.first_date)} · as of {fmtDate(s.as_of)}
                {data.cash_tracking === false && ' · positions only (no cash ledger)'}
              </p>
            </div>
          </div>
        </div>
      </header>

      {data.warnings.map((w) => (
        <div
          key={w}
          className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-[0.82rem] text-amber-800"
        >
          {w}
        </div>
      ))}

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
          value={fmtSignedMoney(s.unrealized_pl)}
          sub={`cost basis ${fmtCash(s.cost_basis)}`}
          color={plColor(s.unrealized_pl)}
        />
        <StatCard
          label="Realized + dividends"
          value={fmtSignedMoney(s.realized_pl + s.dividends_received)}
          sub={`${fmtSignedMoney(s.realized_pl)} realized · ${fmtCash(s.dividends_received)} divs`}
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
          sub={data.cash_tracking ? `cash ${fmtCash(s.cash)}` : `net invested ${fmtCash(s.net_invested)}`}
          color="#dc2626"
        />
      </div>

      {/* action center */}
      {data.flags.length > 0 && (
        <div className="rounded-card border border-[#e5e7eb] bg-white p-4 shadow-card">
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
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
                <span className="text-[#475569]">{f.text}</span>
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
            <StatCard label="Received (TTM)" value={fmtCash(data.income.ttm_received)} />
            <StatCard label="Projected next 12M" value={fmtCash(data.income.forward_12m)} />
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
        <div className="mt-3 flex items-center gap-3 border-b border-[#f1f5f9] pb-4">
          <CsvImportButton />
          <span className="text-[0.74rem] text-[#9ca3af]">
            CSV header: type, date (+ ticker, shares, price, amount, note as needed)
          </span>
        </div>
        <div className="mt-4">
          <LedgerTable rows={ledgerRows} />
        </div>
      </SectionCard>

      <p className="pb-2 text-center text-xs text-[#9ca3af]">
        Tracking and analytics over your own ledger — measurements, not investment
        advice. Dividends/splits from nightly market data; figures may differ
        slightly from your broker.
      </p>
    </div>
  )
}
