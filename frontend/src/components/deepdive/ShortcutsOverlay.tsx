import { useEffect } from 'react'

/** Keyboard-shortcuts overlay (?). Esc or backdrop click closes. */
export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!open) return null

  const rows: Array<[string, string]> = [
    ['J / K', 'Next / previous ticker (screener order)'],
    ['g then b', 'Go to Brief'],
    ['g then o / s / c', 'Overview · Story · Chart'],
    ['g then r / f / v', 'Score · Factors · Value'],
    ['g then n / l / i', 'Financials · Filings · Insiders'],
    ['?', 'Toggle this overlay'],
    ['Esc', 'Close overlays'],
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onClick={onClose}
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-[420px] max-w-[92vw] rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[0.9rem] font-bold text-slate-900">Keyboard shortcuts</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-1.5 text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <ul className="space-y-1.5">
          {rows.map(([keys, desc]) => (
            <li key={keys} className="flex items-center gap-3 text-[0.78rem]">
              <span className="w-28 shrink-0">
                <kbd className="rounded border border-gray-300 border-b-2 bg-white px-1.5 py-0.5 font-mono text-[0.66rem] text-slate-600">
                  {keys}
                </kbd>
              </span>
              <span className="text-slate-600">{desc}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[0.66rem] text-slate-400">
          Shortcuts are suppressed while typing in a field.
        </p>
      </div>
    </div>
  )
}
