import { TONE_HEX } from './shared'
import type { Grade, Verdict } from './verdict'

const GRADE_STYLE: Record<Grade, { bg: string; border: string; chip: string; label: string }> = {
  strong: { bg: '#f0fdf4', border: '#86efac', chip: '#16a34a', label: 'STRONG SIGNAL' },
  moderate: { bg: '#fffbeb', border: '#fde68a', chip: '#d97706', label: 'MODERATE SIGNAL' },
  weak: { bg: '#fef2f2', border: '#fecaca', chip: '#dc2626', label: 'WEAK / NO EDGE' },
  inverted: { bg: '#fef2f2', border: '#fecaca', chip: '#dc2626', label: 'INVERTED' },
  unknown: { bg: '#f8fafc', border: '#e2e8f0', chip: '#64748b', label: 'INSUFFICIENT DATA' },
}

export function VerdictBanner({ v }: { v: Verdict }) {
  const s = GRADE_STYLE[v.grade]
  return (
    <section
      className="rounded-card border p-5 shadow-card"
      style={{ background: s.bg, borderColor: s.border }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="rounded-full px-2.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-white"
          style={{ background: s.chip }}
        >
          {s.label}
        </span>
        <h2 className="text-[1.05rem] font-extrabold text-slate-900">{v.headline}</h2>
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {v.points.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-[0.82rem] text-slate-700">
            <span
              aria-hidden
              className="mt-[1px] font-bold"
              style={{ color: p.ok == null ? '#64748b' : p.ok ? TONE_HEX.good : TONE_HEX.bad }}
            >
              {p.ok == null ? '–' : p.ok ? '✓' : '✕'}
            </span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-black/5 pt-3 text-[0.84rem] font-semibold text-slate-900">
        <span className="text-slate-500">What to do: </span>
        {v.action}
      </p>
    </section>
  )
}
