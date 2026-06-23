import { fmtDate } from '@/lib/format'

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
