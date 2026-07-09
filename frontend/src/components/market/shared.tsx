import { InfoTip } from '@/components/ui/InfoTip'
import { fmtShortDate } from '@/lib/format'

/** Data-driven "latest filing" pill for the 8-K / insider sections. */
export function FilingFreshness({ date }: { date: string | null }) {
  if (!date) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 text-[0.7rem] font-semibold text-muted">
      <span className="text-subtle">Latest filing</span>
      <span className="tabular-nums text-muted">{fmtShortDate(date)}</span>
      <InfoTip text="The most recent day companies actually filed. SEC EDGAR is closed on weekends and federal holidays, so this can sit a few days back and still be current. Today's filings appear after the nightly refresh." />
    </span>
  )
}

/** Tiny provenance pill: what kind of freshness a block carries. */
export function Provenance({ kind }: { kind: 'live' | 'close' | 'fred' }) {
  const map = {
    live: { bg: 'var(--pos-soft)', fg: 'var(--pos)', label: 'live ~15m' },
    close: { bg: 'var(--surface-2)', fg: 'var(--muted)', label: 'last close' },
    fred: { bg: '#eff6ff', fg: '#1d4ed8', label: 'FRED · lagged' },
  }[kind]
  return (
    <span
      className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.06em]"
      style={{ background: map.bg, color: map.fg }}
    >
      {map.label}
    </span>
  )
}

export function BreadthBar({ label, pct, detail, tip }: {
  label: string
  pct: number | null
  detail?: string
  tip?: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[0.78rem]">
        <span className="flex items-center font-semibold text-muted">
          {label}
          {tip && <InfoTip text={tip} />}
        </span>
        <span className="font-bold tabular-nums text-ink">
          {pct == null ? <span className="text-subtle">no data</span> : `${(pct * 100).toFixed(0)}%`}
          {detail && pct != null && <span className="ml-1.5 font-normal text-subtle">{detail}</span>}
        </span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-neg-soft">
        {pct != null && (
          <div className="h-full rounded-full bg-pos-strong" style={{ width: `${pct * 100}%` }} />
        )}
      </div>
    </div>
  )
}

/** Risk-on ↔ risk-off gauge: a gradient bar with a marker placed by a blend of
 * breadth (60%) and the index move (40%) — the 2-second gestalt of the regime. */
export function RiskGauge({ score }: { score: number }) {
  const pct = Math.max(3, Math.min(97, score * 100))
  return (
    <div className="mt-3">
      <div className="relative h-2 rounded-full"
        style={{ background: 'linear-gradient(90deg,#f87171 0%,#fbbf24 50%,#34d399 100%)' }}>
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.45)]"
          style={{ left: `${pct}%` }} aria-hidden />
      </div>
      <div className="mt-1 flex justify-between text-[0.58rem] font-bold uppercase tracking-[0.08em] text-subtle">
        <span>Risk-off</span><span>Cautious</span><span>Risk-on</span>
      </div>
    </div>
  )
}

/** Diverging bar — green (left/positive) vs red (right/negative), sized by share. */
export function DivergeBar({ left, right }: { left: number; right: number }) {
  const total = left + right || 1
  const lp = Math.max(0, Math.min(100, (left / total) * 100))
  return (
    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-3">
      <div style={{ width: `${lp}%`, background: '#34d399' }} />
      <div style={{ width: `${100 - lp}%`, background: '#f87171' }} />
    </div>
  )
}

/** Fill meter colored by breadth thresholds (≥60 green, ≥40 amber, else red). */
export function MeterBar({ pct }: { pct: number | null }) {
  if (pct == null) return <div className="mt-2 h-2 rounded-full bg-surface-3" />
  const c = pct >= 0.6 ? '#34d399' : pct >= 0.4 ? '#fbbf24' : '#f87171'
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
      <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, pct * 100))}%`, background: c }} />
    </div>
  )
}

export function SnapTile({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-1 text-[0.6rem] font-bold uppercase tracking-[0.07em] text-subtle">
        {label}{tip && <InfoTip text={tip} />}
      </div>
      {children}
    </div>
  )
}
