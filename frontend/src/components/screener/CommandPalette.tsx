import { Circle, Folder, type LucideIcon, Search, Tag } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { Icon } from '@/components/ui/Icon'
import { getSavedViews } from '@/lib/savedViews'
import type { ScreenerRow } from '@/types/api'

interface Item {
  kind: 'ticker' | 'view' | 'sector'
  label: string
  sub?: string
  score?: number | null
  run: () => void
}

/**
 * ⌘K / Ctrl+K command palette. Searches the loaded screener rows (instant, no
 * round-trip), saved views, and sectors. ↑↓ to move, Enter to run, Esc to close.
 * A single portaled modal — mounted once on the screener page. */
export function CommandPalette({
  rows,
  sectors,
  onApplyQuery,
  onApplySector,
}: {
  rows: ScreenerRow[]
  sectors: string[]
  onApplyQuery: (query: string) => void
  onApplySector: (sector: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setQ('') // reset in the event callback (not the effect body)
        setSel(0)
        setOpen((o) => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [open])

  const items: Item[] = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out: Item[] = []
    // tickers
    const tickerHits = rows
      .filter(
        (r) =>
          !needle ||
          r.ticker.toLowerCase().includes(needle) ||
          (r.name ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 6)
    for (const r of tickerHits) {
      out.push({
        kind: 'ticker',
        label: `${r.ticker} — ${r.name ?? ''}`.trim(),
        sub: r.sector ?? undefined,
        score: r.composite,
        run: () => navigate(`/securities/${r.ticker}`),
      })
    }
    // saved views
    for (const v of getSavedViews()) {
      if (!needle || v.name.toLowerCase().includes(needle))
        out.push({
          kind: 'view',
          label: v.name,
          sub: 'Saved view',
          run: () => onApplyQuery(v.query),
        })
    }
    // sectors
    for (const s of sectors) {
      if (needle && s.toLowerCase().includes(needle))
        out.push({
          kind: 'sector',
          label: s,
          sub: 'Filter sector',
          run: () => onApplySector(s),
        })
    }
    return out
  }, [q, rows, sectors, navigate, onApplyQuery, onApplySector])

  if (!open) return null

  const close = () => setOpen(false)
  const activate = (i: number) => {
    items[i]?.run()
    close()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(sel)
    }
  }

  const ICON: Record<Item['kind'], LucideIcon> = { ticker: Circle, view: Folder, sector: Tag }

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-start justify-center bg-slate-900/50 backdrop-blur-[1px]"
      style={{ paddingTop: '14vh' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Icon icon={Search} size={16} className="text-subtle" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search tickers, saved views, sectors…"
            className="flex-1 text-[0.95rem] outline-none placeholder:text-subtle"
          />
          <span className="text-[0.66rem] text-subtle">esc</span>
        </div>
        <div className="max-h-[360px] overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-[0.82rem] text-subtle">
              No matches{q ? ` for “${q}”` : ''}.
            </div>
          ) : (
            items.map((it, i) => (
              <button
                key={`${it.kind}-${it.label}-${i}`}
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => activate(i)}
                className={
                  'flex w-full items-center gap-3 px-4 py-2 text-left ' +
                  (i === sel ? 'bg-accent-soft' : 'hover:bg-surface-2')
                }
              >
                <span className="flex w-5 justify-center text-subtle">
                  <Icon icon={ICON[it.kind]} size={it.kind === 'ticker' ? 12 : 14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.85rem] font-medium text-ink">
                    {it.label}
                  </span>
                  {it.sub && (
                    <span className="block truncate text-[0.7rem] text-subtle">{it.sub}</span>
                  )}
                </span>
                {it.score != null && (
                  <span className="numeric rounded bg-pos-soft px-2 py-0.5 text-[0.7rem] font-bold text-pos">
                    {it.score.toFixed(0)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-[0.68rem] text-subtle">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
