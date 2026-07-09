import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { searchSecurities } from '@/lib/api'

/** Global ticker/company typeahead — jump to any operating company's deep-dive
 * from anywhere. Keyboard: ↑/↓ to move, Enter to open, Esc to close. */
export function HeaderSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const { data } = useQuery({
    queryKey: ['search', q.trim()],
    queryFn: () => searchSecurities(q.trim()),
    enabled: q.trim().length >= 1,
    staleTime: 60 * 1000,
  })
  const rows = data?.rows ?? []
  const sel = Math.min(active, Math.max(0, rows.length - 1))

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function go(ticker: string) {
    navigate(`/securities/${ticker}`)
    setQ('')
    setOpen(false)
    setActive(0)
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || rows.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (rows[sel]) go(rows[sel].ticker)
    }
  }

  return (
    <div ref={boxRef} className="relative flex-none">
      <input
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => q.trim() && setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search ticker…"
        aria-label="Search ticker or company"
        className="w-32 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[0.82rem] text-ink placeholder:text-muted focus:border-accent focus:bg-surface focus:outline-none lg:w-56"
      />
      {open && q.trim() && rows.length > 0 && (
        <div className="absolute right-0 z-50 mt-1 max-h-[360px] w-72 overflow-auto rounded-xl border border-line bg-surface py-1 shadow-[0_8px_28px_rgba(15,23,42,0.12)]">
          {rows.map((r, i) => (
            <button
              key={r.ticker}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.ticker)}
              className={
                'flex w-full items-baseline gap-2 px-3 py-1.5 text-left ' +
                (i === sel ? 'bg-accent-soft' : 'hover:bg-surface-2')
              }
            >
              <span className="w-14 flex-none font-bold text-ink">{r.ticker}</span>
              <span className="min-w-0 flex-1 truncate text-[0.8rem] text-muted">
                {r.name}
              </span>
              {r.sector && (
                <span className="flex-none text-[0.66rem] text-subtle">{r.sector}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {open && q.trim().length >= 1 && rows.length === 0 && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-xl border border-line bg-surface px-3 py-2.5 text-[0.8rem] text-muted shadow-[0_8px_28px_rgba(15,23,42,0.12)]">
          No matches for “{q.trim()}”.
        </div>
      )}
    </div>
  )
}
