import { TONE_HEX } from './shared'
import type { Grade, Verdict } from './verdict'

// Theme-aware: soft tints + strong accents from the semantic tokens, so the
// banner reads on both light and dark. The chip fill is a strong semantic hue
// with var(--inverse) text (white on light, dark on the bright dark hue) so the
// uppercase label clears AA in both themes.
const GRADE_STYLE: Record<Grade, { bg: string; border: string; chip: string; label: string }> = {
  strong: { bg: 'var(--pos-soft)', border: 'var(--pos-border)', chip: 'var(--pos-strong)', label: 'STRONG SIGNAL' },
  moderate: { bg: 'var(--warn-soft)', border: 'color-mix(in srgb, var(--warn) 45%, transparent)', chip: 'var(--warn-strong)', label: 'MODERATE SIGNAL' },
  weak: { bg: 'var(--neg-soft)', border: 'var(--neg-border)', chip: 'var(--neg-strong)', label: 'WEAK / NO EDGE' },
  inverted: { bg: 'var(--neg-soft)', border: 'var(--neg-border)', chip: 'var(--neg-strong)', label: 'INVERTED' },
  unknown: { bg: 'var(--surface-2)', border: 'var(--border)', chip: 'var(--muted)', label: 'INSUFFICIENT DATA' },
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
          className="rounded-full px-2.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.1em]"
          style={{ background: s.chip, color: 'var(--inverse)' }}
        >
          {s.label}
        </span>
        <h2 className="text-[1.05rem] font-bold text-ink">{v.headline}</h2>
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {v.points.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-[0.82rem] text-ink">
            <span
              aria-hidden
              className="mt-[1px] font-bold"
              style={{ color: p.ok == null ? 'var(--muted)' : p.ok ? TONE_HEX.good : TONE_HEX.bad }}
            >
              {p.ok == null ? '–' : p.ok ? '✓' : '✕'}
            </span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-line pt-3 text-[0.84rem] font-semibold text-ink">
        <span className="text-muted">What to do: </span>
        {v.action}
      </p>
    </section>
  )
}
