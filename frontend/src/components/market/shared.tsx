import { InfoTip } from '@/components/ui/InfoTip'
import { fmtDate, fmtShortDate } from '@/lib/format'

// Plain-language glossary, reused for tooltips — definition + the directional read.
export const G = {
  breadth:
    'Breadth = how many stocks are participating. When the index rises but most stocks fall, a few giants are masking weakness — narrow rallies tend to be fragile.',
  ma50: 'Share of stocks trading above their ~50-day (≈2-month) average price. >50% = most stocks in a short-term uptrend.',
  ma200: 'Share of stocks above their ~200-day (≈10-month) average. The big-picture trend gauge; <40% means most stocks are in downtrends.',
  highsLows: 'New 52-week highs vs lows across the universe. Highs >> lows is healthy; a surge in new lows is a warning even if the index holds.',
  curve: '10-year minus 2-year Treasury yield. Negative ("inverted") has historically preceded recessions, though the timing is loose.',
  vix: "The market's expected S&P swing over the next 30 days. <18 = calm, 18–25 = nervous, >25 = fearful.",
  equalWeight:
    'Equal-weight = every stock counts the same, so this is what the TYPICAL stock did — not just the mega-caps that dominate the index.',
  drawdown: 'How far each stock sits below its own 52-week high — a truer gauge of damage beneath the surface than the index alone.',
  factorDay:
    "Each factor's top-ranked fifth of stocks vs its bottom fifth, today. A positive spread means that style worked today (e.g. momentum led).",
  rotation: 'Cyclical sectors (tech, financials, energy…) vs defensive ones (utilities, staples, health care). Cyclicals leading = risk-on; defensives leading = cautious.',
  rates: 'Direction only — a higher or lower yield is not inherently "good" or "bad" for stocks; it just shifts the backdrop.',
  freshness:
    'Last close = the most recent completed trading session in our nightly data. Live = a market quote right now, ~15 min delayed. FRED = official government series, which publish on a lag.',
} as const

export const FACTOR_LABEL: Record<string, string> = {
  growth: 'Growth', value: 'Value', quality: 'Quality', momentum: 'Momentum',
}

export const TONE_C: Record<string, { border: string; bg: string; fg: string }> = {
  good: { border: '#86efac', bg: '#f0fdf4', fg: '#047857' },
  warn: { border: '#fde68a', bg: '#fffbeb', fg: '#b45309' },
  bad: { border: '#fecaca', bg: '#fef2f2', fg: '#b91c1c' },
  neutral: { border: '#e2e8f0', bg: '#f8fafc', fg: '#475569' },
}

/** Heat-cell background: green/red, intensity scaled to the column's range,
 * with a small floor so even tiny real moves are visible. */
export function heat(v: number | null, scale: number): React.CSSProperties {
  if (v == null) return {}
  const a = (0.08 + Math.min(Math.abs(v) / scale, 1) * 0.34)
  return { background: v >= 0 ? `rgba(16,185,129,${a})` : `rgba(239,68,68,${a})`, color: '#0f172a' }
}

/** Newest ISO date (YYYY-MM-DD) in a list — ISO strings sort lexically. */
export function maxIsoDate(dates: (string | null | undefined)[]): string | null {
  return dates.reduce<string | null>((mx, d) => (d && (!mx || d > mx) ? d : mx), null)
}

export function timeAgo(epoch: number): string {
  if (!epoch) return ''
  const mins = Math.max(0, Math.round((Date.now() / 1000 - epoch) / 60))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`
}

export function cacheAgeLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

export function marketStatus(asOf: string | null): { openNow: boolean; title: string; note: string | null } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  })
  const o: Record<string, string> = {}
  for (const p of fmt.formatToParts(new Date())) o[p.type] = p.value
  if (o.hour === '24') o.hour = '00'
  const weekend = o.weekday === 'Sat' || o.weekday === 'Sun'
  const minutes = Number(o.hour) * 60 + Number(o.minute)
  const openNow = !weekend && minutes >= 570 && minutes < 960
  const todayET = `${o.year}-${o.month}-${o.day}`
  const sessionToday = asOf === todayET
  const session = asOf ? ` — ${fmtDate(asOf)}` : ''
  if (openNow) return { openNow, title: 'Market brief', note: null }
  if (weekend) return { openNow, title: 'Weekend recap', note: `Markets are closed for the weekend. This recaps the most recent session${session}.` }
  if (sessionToday) return { openNow, title: "Today's session recap", note: `Regular trading is closed for the day. Recapping today's session${session}.` }
  return { openNow, title: 'Latest session recap', note: `Markets are closed right now. Latest completed session${session}.` }
}

/** Data-driven "latest filing" pill for the 8-K / insider sections. */
export function FilingFreshness({ date }: { date: string | null }) {
  if (!date) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[0.7rem] font-semibold text-slate-500">
      <span className="text-slate-400">Latest filing</span>
      <span className="tabular-nums text-slate-600">{fmtShortDate(date)}</span>
      <InfoTip text="The most recent day companies actually filed. SEC EDGAR is closed on weekends and federal holidays, so this can sit a few days back and still be current. Today's filings appear after the nightly refresh." />
    </span>
  )
}

/** Tiny provenance pill: what kind of freshness a block carries. */
export function Provenance({ kind }: { kind: 'live' | 'close' | 'fred' }) {
  const map = {
    live: { bg: '#ecfdf5', fg: '#047857', label: 'live ~15m' },
    close: { bg: '#f1f5f9', fg: '#475569', label: 'last close' },
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
        <span className="flex items-center font-semibold text-slate-600">
          {label}
          {tip && <InfoTip text={tip} />}
        </span>
        <span className="font-bold tabular-nums text-slate-800">
          {pct == null ? <span className="text-slate-400">no data</span> : `${(pct * 100).toFixed(0)}%`}
          {detail && pct != null && <span className="ml-1.5 font-normal text-slate-400">{detail}</span>}
        </span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-red-100">
        {pct != null && (
          <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${pct * 100}%` }} />
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
      <div className="mt-1 flex justify-between text-[0.58rem] font-bold uppercase tracking-[0.08em] text-slate-400">
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
    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100">
      <div style={{ width: `${lp}%`, background: '#34d399' }} />
      <div style={{ width: `${100 - lp}%`, background: '#f87171' }} />
    </div>
  )
}

/** Fill meter colored by breadth thresholds (≥60 green, ≥40 amber, else red). */
export function MeterBar({ pct }: { pct: number | null }) {
  if (pct == null) return <div className="mt-2 h-2 rounded-full bg-slate-100" />
  const c = pct >= 0.6 ? '#34d399' : pct >= 0.4 ? '#fbbf24' : '#f87171'
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, pct * 100))}%`, background: c }} />
    </div>
  )
}

export function SnapTile({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-1 text-[0.6rem] font-bold uppercase tracking-[0.07em] text-slate-400">
        {label}{tip && <InfoTip text={tip} />}
      </div>
      {children}
    </div>
  )
}
