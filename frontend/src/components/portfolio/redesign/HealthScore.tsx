import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '@/components/ui/Icon'
import { HEALTH_BAND_LABEL, type HealthScore as HealthScoreT } from '../portfolioUi'

const BAND_HEX: Record<string, string> = {
  needs_attention: 'var(--neg)',
  balanced: 'var(--warn)',
  resilient: 'var(--pos)',
}

/** Circular 0-100 gauge (SVG ring) + band chip + a click-to-expand dialog with
 *  the per-factor penalty breakdown (spec: HealthScore = circular score with
 *  click-to-expand factor breakdown). A diagnostic of measurable STRUCTURAL
 *  issues — not a rating of stock-picking, and not advice. */
export function HealthScore({ health }: { health: HealthScoreT; benchmark?: string }) {
  const [open, setOpen] = useState(false)

  if (health.status === 'insufficient_history' || health.score == null || health.band == null) {
    return (
      <div className="flex flex-col justify-center rounded-[var(--r-xl)] border border-line bg-surface p-4 shadow-[var(--sh-sm)]">
        <div className="text-micro font-semibold uppercase tracking-wide text-muted">
          Portfolio health
        </div>
        <p className="mt-1 text-[0.78rem] leading-snug text-muted">
          Add holdings to see a structural-resilience score.
        </p>
      </div>
    )
  }

  const { score, band } = health
  const color = BAND_HEX[band]
  const R = 32
  const C = 2 * Math.PI * R
  const dash = (score / 100) * C

  return (
    <div className="flex items-center gap-3 rounded-[var(--r-xl)] border border-line bg-surface p-4 shadow-[var(--sh-sm)]">
      <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0" aria-hidden="true">
        <circle cx="38" cy="38" r={R} fill="none" stroke="#eef2f7" strokeWidth="7" />
        <circle
          cx="38"
          cy="38"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C - dash}`}
          transform="rotate(-90 38 38)"
        />
        <text x="38" y="35" textAnchor="middle" className="numeric fill-ink text-[16px] font-bold">
          {score}
        </text>
        <text x="38" y="49" textAnchor="middle" className="fill-slate-400 text-[9px]">
          / 100
        </text>
      </svg>
      <div className="min-w-0">
        <div className="text-micro font-semibold uppercase tracking-wide text-muted">
          Portfolio health
        </div>
        <span
          className="mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[0.72rem] font-semibold"
          style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, white)` }}
        >
          {HEALTH_BAND_LABEL[band]}
        </span>
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[0.72rem] font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] focus-visible:ring-offset-2"
          >
            See breakdown →
          </button>
        </div>
      </div>
      {open && <BreakdownDialog health={health} color={color} onClose={() => setOpen(false)} />}
    </div>
  )
}

function BreakdownDialog({
  health,
  color,
  onClose,
}: {
  health: HealthScoreT
  color: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hits = health.factors.filter((f) => !f.ok)
  const passed = health.factors.filter((f) => f.ok)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Portfolio health breakdown"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--sh-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-h3 font-bold text-ink">
            Health {health.score}/100 · {HEALTH_BAND_LABEL[health.band!]}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 text-lg text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)]"
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-[0.72rem] text-muted">
          Measures structural resilience — concentration, drawdown, diversification — not whether
          you beat the market. Not investment advice.
        </p>

        <ul className="mt-3 space-y-2">
          {hits.map((f) => (
            <li key={f.key} className="flex items-start gap-2 text-[0.78rem]">
              <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="flex-1 text-ink">{f.reason}</span>
              <span className="numeric shrink-0 font-semibold" style={{ color }}>
                −{Math.round(f.penalty)} pts
              </span>
            </li>
          ))}
        </ul>

        {passed.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <div className="text-micro font-semibold uppercase tracking-wide text-muted">Passed</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {passed.map((f) => (
                <span key={f.key} className="inline-flex items-center gap-1 text-[0.7rem] text-muted">
                  <Icon icon={Check} size={11} className="text-pos" />
                  {f.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {health.notes.map((n, i) => (
          <p key={i} className="mt-2 text-[0.68rem] leading-snug text-muted">
            {n}
          </p>
        ))}
      </div>
    </div>,
    document.body,
  )
}
