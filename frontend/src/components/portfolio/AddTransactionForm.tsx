import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { InfoTip } from '@/components/ui/InfoTip'
import { useToast } from '@/components/ui/Toast'
import { addPortfolioTransactions } from '@/lib/api'
import { FORM_INPUT } from '@/lib/constants'
import type { PortfolioTransactionCreate, PortfolioTxnType } from '@/types/api'

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

const emptyForm = {
  txn_type: 'buy' as PortfolioTxnType,
  ticker: '',
  trade_date: new Date().toISOString().slice(0, 10),
  shares: '',
  price: '',
  amount: '',
  note: '',
}

export function AddTransactionForm({ onDone }: { onDone?: () => void }) {
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

  // Disable Add until the fields this txn type requires are filled.
  const canSubmit =
    (!needsTicker || form.ticker.trim() !== '') &&
    (!needsShares || (form.shares.trim() !== '' && form.price.trim() !== '')) &&
    (!needsAmount || form.amount.trim() !== '')
  // Live "shares × price" preview shown in the optional Total field's placeholder.
  const totalHint =
    needsShares && form.shares.trim() !== '' && form.price.trim() !== ''
      ? `= ${(Number(form.shares) * Number(form.price)).toFixed(2)}`
      : 'shares × price'

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

  const inputCls = FORM_INPUT

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2.5">
      <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-muted">
        <span className="flex items-center">
          Type
          <InfoTip text="Buy / Sell move shares. Dividend (cash) logs income for a ticker. Deposit / Withdrawal are cash flows (used for return timing). Fee reduces returns." />
        </span>
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
        <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-muted">
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
      <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-muted">
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
          <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-muted">
            Shares
            <input
              type="number" step="any" min="0"
              value={form.shares}
              onChange={(e) => setForm({ ...form, shares: e.target.value })}
              required
              className={inputCls + ' w-24'}
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-muted">
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
      <label className="flex flex-col gap-1 text-[0.7rem] font-semibold text-muted">
        {needsShares ? 'Total $ (optional)' : 'Amount $'}
        <input
          type="number" step="any" min="0"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          required={needsAmount}
          placeholder={needsShares ? totalHint : ''}
          className={inputCls + ' w-32'}
        />
      </label>
      <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[0.7rem] font-semibold text-muted">
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
        disabled={mut.isPending || !canSubmit}
        className="rounded-lg bg-accent-solid px-4 py-2 text-[0.82rem] font-bold text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
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

export function CsvImportButton() {
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
    if (file.size > 5 * 1024 * 1024) {
      toast('error', 'CSV is larger than 5 MB — split it into smaller files.')
      return
    }
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
        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.78rem] font-bold text-muted transition-colors hover:bg-surface-2 disabled:opacity-60"
      >
        {mut.isPending ? 'Importing…' : 'Import CSV'}
      </button>
    </>
  )
}
