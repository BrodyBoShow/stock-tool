import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { AddTransactionForm } from '@/components/portfolio/AddTransactionForm'
import { Icon } from '@/components/ui/Icon'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { addPortfolioTransactions, deletePortfolioTransaction } from '@/lib/api'
import { FORM_INPUT, TABLE_HEAD_ROW } from '@/lib/constants'
import { fmtDate, fmtPrice } from '@/lib/format'
import type {
  PortfolioTransactionCreate,
  PortfolioTransactionRow,
  PortfolioTxnType,
} from '@/types/api'

export interface TransactionsPanelProps {
  rows: PortfolioTransactionRow[]
  warnings: string[]
}

const TXN_TYPES: PortfolioTxnType[] = [
  'buy', 'sell', 'dividend', 'deposit', 'withdrawal', 'fee',
]

const TYPE_CHIP: Record<PortfolioTxnType, string> = {
  buy: 'bg-pos-soft text-pos',
  sell: 'bg-neg-soft text-neg',
  dividend: 'bg-info-soft text-info',
  deposit: 'bg-surface-3 text-muted',
  withdrawal: 'bg-surface-3 text-muted',
  fee: 'bg-surface-3 text-muted',
}

const NEEDS_TICKER: PortfolioTxnType[] = ['buy', 'sell', 'dividend']

// ---------------------------------------------------------------------------
// CSV parsing helpers (richer than AddTransactionForm's parseCsv: per-row
// status, dupe detection against the existing ledger, $/comma stripping,
// M/D/YYYY date normalizing).
// ---------------------------------------------------------------------------

type FieldKey = 'type' | 'date' | 'ticker' | 'shares' | 'price' | 'amount' | 'note'

const FIELDS: { key: FieldKey; label: string; required: boolean }[] = [
  { key: 'type', label: 'Type', required: true },
  { key: 'date', label: 'Date', required: true },
  { key: 'ticker', label: 'Ticker', required: false },
  { key: 'shares', label: 'Shares', required: false },
  { key: 'price', label: 'Price', required: false },
  { key: 'amount', label: 'Amount', required: false },
  { key: 'note', label: 'Note', required: false },
]

/** Header synonyms accepted when auto-detecting columns. */
const FIELD_ALIASES: Record<FieldKey, string[]> = {
  type: ['type', 'txn_type', 'transaction type', 'action'],
  date: ['date', 'trade_date', 'trade date'],
  ticker: ['ticker', 'symbol'],
  shares: ['shares', 'quantity', 'qty'],
  price: ['price', 'price / share', 'price per share'],
  amount: ['amount', 'total', 'value'],
  note: ['note', 'notes', 'description', 'memo'],
}

type Mapping = Record<FieldKey, number>

function parseCsvContent(text: string): { headers: string[]; rows: string[][] } | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return null
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const rows = lines.slice(1).map((l) => l.split(',').map((c) => c.trim()))
  return { headers, rows }
}

function autoDetectMapping(headers: string[]): Mapping {
  const mapping = {} as Mapping
  for (const f of FIELDS) {
    let idx = -1
    for (const alias of FIELD_ALIASES[f.key]) {
      const found = headers.indexOf(alias)
      if (found >= 0) { idx = found; break }
    }
    mapping[f.key] = idx
  }
  return mapping
}

/** Strip $ and commas; empty → null; unparsable → bad. */
function parseNum(raw: string): { value: number | null; bad: boolean } {
  const s = raw.replace(/[$,]/g, '').trim()
  if (s === '') return { value: null, bad: false }
  const n = Number(s)
  return Number.isFinite(n) ? { value: n, bad: false } : { value: null, bad: true }
}

/** Accept YYYY-MM-DD or M/D/YYYY; return normalized YYYY-MM-DD or null. */
function normalizeDate(raw: string): string | null {
  const s = raw.trim()
  let iso: string | null = null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    iso = s
  } else {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
    if (m) iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  if (iso === null) return null
  return Number.isNaN(new Date(`${iso}T00:00:00`).getTime()) ? null : iso
}

/** Composite key for dupe detection: shares rounded to 1e-6, amount to 0.01. */
function dupKey(
  type: string,
  date: string,
  ticker: string | null,
  shares: number | null,
  amount: number | null,
): string {
  const sk = shares == null ? '' : shares.toFixed(6)
  const ak = amount == null ? '' : amount.toFixed(2)
  return `${type}|${date}|${(ticker ?? '').toUpperCase()}|${sk}|${ak}`
}

type RowStatus =
  | 'ok'
  | 'missing-ticker'
  | 'bad-date'
  | 'bad-number'
  | 'bad-type'
  | 'duplicate'

interface PreviewRow {
  txn: PortfolioTransactionCreate
  status: RowStatus
}

function buildPreview(
  rows: string[][],
  mapping: Mapping,
  existingKeys: Set<string>,
): PreviewRow[] {
  const cell = (r: string[], key: FieldKey): string => {
    const idx = mapping[key]
    return idx >= 0 ? (r[idx] ?? '') : ''
  }
  const out: PreviewRow[] = []
  for (const r of rows) {
    const rawType = cell(r, 'type').toLowerCase().trim()
    const type = rawType as PortfolioTxnType
    const date = normalizeDate(cell(r, 'date'))
    const ticker = cell(r, 'ticker').toUpperCase() || null
    const shares = parseNum(cell(r, 'shares'))
    const price = parseNum(cell(r, 'price'))
    const amount = parseNum(cell(r, 'amount'))
    const note = cell(r, 'note') || null

    const txn: PortfolioTransactionCreate = {
      txn_type: type,
      trade_date: date ?? cell(r, 'date'),
      ticker,
      shares: shares.value,
      price: price.value,
      amount: amount.value,
      note,
    }

    let status: RowStatus = 'ok'
    if (!TXN_TYPES.includes(type)) status = 'bad-type'
    else if (date === null) status = 'bad-date'
    else if (shares.bad || price.bad || amount.bad) status = 'bad-number'
    else if (NEEDS_TICKER.includes(type) && ticker === null) status = 'missing-ticker'
    else if (existingKeys.has(dupKey(type, date, ticker, shares.value, amount.value)))
      status = 'duplicate'
    out.push({ txn, status })
  }
  return out
}

const WARN_STATUSES: RowStatus[] = ['missing-ticker', 'bad-date', 'bad-number', 'bad-type']

// ---------------------------------------------------------------------------
// Import wizard modal
// ---------------------------------------------------------------------------

const STEP_CHIPS = ['Upload', 'Map', 'Preview', 'Commit']

function ImportWizard({
  existingRows,
  onClose,
}: {
  existingRows: PortfolioTransactionRow[]
  onClose: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [pasted, setPasted] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Mapping>(autoDetectMapping([]))
  const [dupMode, setDupMode] = useState<'skip' | 'import'>('skip')
  const qc = useQueryClient()
  const toast = useToast()

  const mut = useMutation({
    mutationFn: addPortfolioTransactions,
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['portfolio'] })
      void qc.invalidateQueries({ queryKey: ['portfolio', 'transactions'] })
      toast('success', `Imported ${res.inserted} transactions`)
      onClose()
    },
    onError: (e: Error) => toast('error', e.message),
  })

  // Esc closes (listener only — the handler does the closing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const existingKeys = useMemo(() => {
    const set = new Set<string>()
    for (const r of existingRows)
      set.add(dupKey(r.txn_type, r.trade_date, r.ticker, r.shares, r.amount))
    return set
  }, [existingRows])

  const handleContent = (text: string) => {
    const parsed = parseCsvContent(text)
    if (!parsed) {
      toast('error', 'CSV needs a header row plus at least one data row')
      return
    }
    setHeaders(parsed.headers)
    setDataRows(parsed.rows)
    setMapping(autoDetectMapping(parsed.headers))
    setStep(2)
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast('error', 'CSV is larger than 5 MB — split it into smaller files.')
      return
    }
    void file.text().then(handleContent)
  }

  const preview = useMemo(
    () => (step === 3 ? buildPreview(dataRows, mapping, existingKeys) : []),
    [step, dataRows, mapping, existingKeys],
  )
  let clean = 0, warn = 0, dup = 0
  for (const p of preview) {
    if (p.status === 'ok') clean += 1
    else if (p.status === 'duplicate') dup += 1
    else warn += 1
  }
  const commitCount = clean + (dupMode === 'import' ? dup : 0)

  const commit = () => {
    const txns: PortfolioTransactionCreate[] = []
    for (const p of preview) {
      if (p.status === 'ok' || (dupMode === 'import' && p.status === 'duplicate'))
        txns.push(p.txn)
    }
    if (txns.length > 0) mut.mutate(txns)
  }

  const effStep = mut.isPending ? 4 : step
  const chipCls = (idx: number) => {
    if (idx < effStep) return 'bg-pos-soft text-pos'
    if (idx === effStep) return 'bg-accent-solid text-accent-ink'
    return 'bg-surface-3 text-muted'
  }

  const canContinueMap = mapping.type >= 0 && mapping.date >= 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="max-h-[85vh] w-[680px] overflow-auto rounded-xl bg-surface p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-[0.95rem] font-bold text-ink">Import CSV</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-0.5 text-muted hover:bg-surface-2 hover:text-muted"
          >
            <Icon icon={X} size={16} />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {STEP_CHIPS.map((label, i) => (
            <span
              key={label}
              className={`rounded-full px-2.5 py-1 text-[0.68rem] font-semibold ${chipCls(i + 1)}`}
            >
              {i + 1}. {label}
            </span>
          ))}
        </div>

        {step === 1 && (
          <div className="mt-4 space-y-3">
            <label className="block cursor-pointer rounded-lg border-2 border-dashed border-line p-8 text-center text-[0.78rem] text-muted transition-colors hover:border-accent hover:text-muted">
              Click to choose a .csv file
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={onFile}
              />
            </label>
            <div>
              <div className="mb-1 text-[0.7rem] font-semibold text-muted">
                or paste CSV text
              </div>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={'type,date,ticker,shares,price\nbuy,2026-06-01,AAPL,10,195.20'}
                className={`${FORM_INPUT} h-24 w-full font-mono text-[0.7rem]`}
              />
              <button
                type="button"
                disabled={pasted.trim() === ''}
                onClick={() => handleContent(pasted)}
                className="mt-1.5 rounded-lg bg-accent-solid px-3 py-1.5 text-[0.74rem] font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Use pasted text →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4">
            <p className="text-[0.72rem] text-muted">
              Match your CSV columns to fields. Type and Date are required — the rest
              are optional depending on the transaction type.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5">
              {FIELDS.map((f) => (
                <label
                  key={f.key}
                  className="flex items-center justify-between gap-3 text-[0.72rem] font-semibold text-muted"
                >
                  <span>
                    {f.label}
                    {f.required && <span className="text-neg"> *</span>}
                  </span>
                  <select
                    value={mapping[f.key]}
                    onChange={(e) =>
                      setMapping({ ...mapping, [f.key]: Number(e.target.value) })}
                    className={`${FORM_INPUT} w-44 text-[0.72rem]`}
                  >
                    <option value={-1}>—</option>
                    {headers.map((h, i) => (
                      <option key={`${i}-${h}`} value={i}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.74rem] font-semibold text-muted hover:bg-surface-2"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={!canContinueMap}
                onClick={() => setStep(3)}
                className="rounded-lg bg-accent-solid px-3 py-1.5 text-[0.74rem] font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Preview {dataRows.length} rows →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-4">
            <div className="overflow-auto">
              <table className="w-full text-[0.72rem]">
                <thead>
                  <tr className={TABLE_HEAD_ROW}>
                    <th className="py-1.5 pr-3">Status</th>
                    <th className="py-1.5 pr-3">Type</th>
                    <th className="py-1.5 pr-3">Date</th>
                    <th className="py-1.5 pr-3">Ticker</th>
                    <th className="py-1.5 pr-3 text-right">Shares</th>
                    <th className="py-1.5 pr-3 text-right">Price</th>
                    <th className="py-1.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 12).map((p, i) => (
                    <tr
                      key={`${i}-${p.txn.trade_date}-${p.txn.ticker ?? ''}`}
                      className={
                        'border-b border-line ' +
                        (p.status === 'duplicate'
                          ? 'bg-neg-soft'
                          : WARN_STATUSES.includes(p.status)
                            ? 'bg-warn-soft'
                            : '')
                      }
                    >
                      <td className="py-1.5 pr-3 font-semibold text-muted">{p.status}</td>
                      <td className="py-1.5 pr-3 capitalize">{p.txn.txn_type || '—'}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{p.txn.trade_date || '—'}</td>
                      <td className="py-1.5 pr-3 font-bold">{p.txn.ticker ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{p.txn.shares ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {p.txn.price != null ? fmtPrice(p.txn.price) : '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {p.txn.amount != null ? fmtPrice(p.txn.amount) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 12 && (
                <div className="py-1.5 text-[0.68rem] text-muted">
                  … {preview.length - 12} more
                </div>
              )}
            </div>

            <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[0.72rem] text-muted">
              <span className="font-semibold text-ink">{clean}</span> clean rows
              will be committed · <span className="font-semibold">{warn}</span> skipped
              (fix and re-import) · <span className="font-semibold">{dup}</span> duplicates
            </div>

            {dup > 0 && (
              <div className="mt-2 flex gap-4 text-[0.72rem] text-muted">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="dup-mode"
                    checked={dupMode === 'skip'}
                    onChange={() => setDupMode('skip')}
                  />
                  Skip duplicates
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="dup-mode"
                    checked={dupMode === 'import'}
                    onChange={() => setDupMode('import')}
                  />
                  Import anyway
                </label>
              </div>
            )}

            <div className="mt-5 flex justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.74rem] font-semibold text-muted hover:bg-surface-2"
              >
                ← Back
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.74rem] font-semibold text-muted hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={commitCount === 0 || mut.isPending}
                  onClick={commit}
                  className="rounded-lg bg-accent-solid px-3 py-1.5 text-[0.74rem] font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mut.isPending ? 'Committing…' : `Commit ${commitCount} rows →`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Transactions panel
// ---------------------------------------------------------------------------

export function TransactionsPanel(props: TransactionsPanelProps): JSX.Element {
  const { rows, warnings } = props
  const [filter, setFilter] = useState<'all' | PortfolioTxnType>('all')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [toDelete, setToDelete] = useState<PortfolioTransactionRow | null>(null)
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const qc = useQueryClient()
  const toast = useToast()

  const delMut = useMutation({
    mutationFn: deletePortfolioTransaction,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portfolio'] })
      toast('success', 'Transaction removed')
      setToDelete(null)
    },
    onError: (e: Error) => toast('error', e.message),
  })

  const bulkMut = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) await deletePortfolioTransaction(id)
      return ids.length
    },
    onSuccess: (n) => {
      void qc.invalidateQueries({ queryKey: ['portfolio'] })
      toast('success', `Deleted ${n} transactions`)
      setSelected(new Set())
      setBulkConfirm(false)
    },
    onError: (e: Error) => {
      // Some deletes may have landed before the failure — refresh either way.
      void qc.invalidateQueries({ queryKey: ['portfolio'] })
      toast('error', e.message)
      setBulkConfirm(false)
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (filter === 'all' || r.txn_type === filter) &&
        (q === '' ||
          (r.ticker ?? '').toLowerCase().includes(q) ||
          (r.note ?? '').toLowerCase().includes(q)),
    )
  }, [rows, filter, search])

  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  const toggleAll = () => {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev)
        for (const r of filtered) next.delete(r.id)
        return next
      }
      const next = new Set(prev)
      for (const r of filtered) next.add(r.id)
      return next
    })
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[0.95rem] font-bold text-ink">Transactions</h2>
          <p className="mt-0.5 text-[0.72rem] text-muted">
            The ledger everything above is computed from — splits are applied
            automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | PortfolioTxnType)}
            className={`${FORM_INPUT} text-[0.72rem]`}
          >
            <option value="all">All</option>
            {TXN_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticker or note…"
            className={`${FORM_INPUT} w-48`}
          />
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.74rem] font-semibold text-muted transition-colors hover:bg-surface-2"
          >
            {showAdd ? '− Close' : '+ Add'}
          </button>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="rounded-lg bg-accent-solid px-3 py-1.5 text-[0.74rem] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Import CSV
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
          <AddTransactionForm onDone={() => setShowAdd(false)} />
        </div>
      )}

      <div className="mt-3 text-[0.66rem] text-muted">
        Showing {filtered.length} of {rows.length}
      </div>

      {selected.size > 0 && (
        <div className="mt-2 flex items-center gap-3 rounded-lg bg-ink px-3 py-2 text-[0.72rem] text-inverse">
          <span className="font-semibold">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => setBulkConfirm(true)}
            className="rounded bg-red-600 px-2.5 py-1 font-semibold transition-colors hover:bg-red-700"
          >
            Delete selected
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded px-2 py-1 opacity-80 transition-opacity hover:opacity-100"
          >
            Clear
          </button>
        </div>
      )}

      <div className="mt-2 max-h-[420px] overflow-auto">
        <table className="w-full text-[0.82rem]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className={TABLE_HEAD_ROW}>
              <th className="w-8 py-2 pr-2">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAll}
                  aria-label="Select all shown transactions"
                />
              </th>
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
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-line">
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleRow(r.id)}
                    aria-label={`Select ${r.txn_type} ${r.ticker ?? ''} ${r.trade_date}`}
                  />
                </td>
                <td className="py-2 pr-4 tabular-nums text-muted">
                  {fmtDate(r.trade_date)}
                </td>
                <td className="py-2 pr-4">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[0.66rem] font-semibold capitalize ${TYPE_CHIP[r.txn_type]}`}
                  >
                    {r.txn_type}
                  </span>
                </td>
                <td className="py-2 pr-4 font-bold text-ink">{r.ticker ?? '—'}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{r.shares ?? '—'}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {r.price != null ? fmtPrice(r.price) : '—'}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {r.amount != null ? fmtPrice(r.amount) : '—'}
                </td>
                <td className="max-w-[220px] truncate py-2 pr-4 text-muted">
                  {r.note ?? ''}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setToDelete(r)}
                    className="rounded-md px-2 py-0.5 text-[0.72rem] font-bold text-muted transition-colors hover:bg-neg-soft hover:text-neg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600/40"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="py-4 text-center text-[0.78rem] text-muted">
            {rows.length === 0
              ? 'No transactions yet — add one above or import a CSV.'
              : 'No transactions match the current filter.'}
          </p>
        )}
      </div>

      {warnings.length > 0 && (
        <details className="mt-3 border-t border-line pt-2.5">
          <summary className="cursor-pointer select-none text-[0.72rem] font-semibold text-muted hover:text-muted">
            Data notes ({warnings.length}) — minor ledger gaps, e.g. broker reinvest
            rows not imported
          </summary>
          <ul className="mt-1.5 space-y-1 pl-4 text-[0.72rem] text-muted">
            {warnings.map((w, i) => (
              <li key={`${i}-${w}`} className="list-disc">{w}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-3 text-[0.66rem] text-muted">
        CSV header: type, date (+ ticker, shares, price, amount, note) · type = buy /
        sell / dividend / deposit / withdrawal / fee · column order free.
      </p>

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
        pending={delMut.isPending}
        onConfirm={() => toDelete && delMut.mutate(toDelete.id)}
        onCancel={() => setToDelete(null)}
      />

      <ConfirmDialog
        open={bulkConfirm}
        title={`Delete ${selected.size} transactions?`}
        message="Every derived number above recomputes without them. This cannot be undone."
        confirmLabel="Delete all"
        danger
        pending={bulkMut.isPending}
        onConfirm={() => bulkMut.mutate([...selected])}
        onCancel={() => setBulkConfirm(false)}
      />

      {wizardOpen && (
        <ImportWizard existingRows={rows} onClose={() => setWizardOpen(false)} />
      )}
    </div>
  )
}
