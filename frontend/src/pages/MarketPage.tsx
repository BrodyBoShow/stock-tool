import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'

import { ErrorCard } from '@/components/ErrorCard'
import { InfoTip } from '@/components/ui/InfoTip'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { generateMarketBrief, getMarketOverview, getQuotes } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { fmtDate, fmtMoney, fmtShortDate, fmtSignedPct } from '@/lib/format'
import type {
  MarketAiBrief,
  MarketFactorDay,
  MarketMacroCard,
  MarketMover,
  MarketOverviewResponse,
  MarketRead,
  MarketSectorRow,
} from '@/types/api'

// Plain-language glossary, reused for tooltips — definition + the directional read.
const G = {
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

/** Heat-cell background: green/red, intensity scaled to the column's range,
 * with a small floor so even tiny real moves are visible. */
function heat(v: number | null, scale: number): React.CSSProperties {
  if (v == null) return {}
  const a = (0.08 + Math.min(Math.abs(v) / scale, 1) * 0.34)
  return { background: v >= 0 ? `rgba(16,185,129,${a})` : `rgba(239,68,68,${a})`, color: '#0f172a' }
}

/** Newest ISO date (YYYY-MM-DD) in a list — ISO strings sort lexically. */
function maxIsoDate(dates: (string | null | undefined)[]): string | null {
  return dates.reduce<string | null>((mx, d) => (d && (!mx || d > mx) ? d : mx), null)
}

/** Data-driven "latest filing" pill for the 8-K / insider sections. Reads the
 * newest filed date straight from the rows, so it advances on its own as fresh
 * filings land; the tooltip explains why a Thursday/Friday date is still current
 * on a later day (SEC EDGAR is closed on weekends and federal holidays). */
function FilingFreshness({ date }: { date: string | null }) {
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
function Provenance({ kind }: { kind: 'live' | 'close' | 'fred' }) {
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

function SectorTable({ sectors }: { sectors: MarketSectorRow[] }) {
  const cols: { key: keyof MarketSectorRow; label: string; scale: number }[] = [
    { key: 'r1d', label: '1D', scale: 0.025 },
    { key: 'r1w', label: '1W', scale: 0.05 },
    { key: 'r1m', label: '1M', scale: 0.08 },
    { key: 'r3m', label: '3M', scale: 0.15 },
    { key: 'rytd', label: 'YTD', scale: 0.25 },
  ]
  if (sectors.length === 0) {
    return <p className="text-sm text-gray-400">No sector data for this session — prices may still be loading.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.84rem]">
        <thead>
          <tr className="border-b border-[#eef1f6] text-left text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-slate-400">
            <th className="py-2 pr-4">Sector</th>
            <th className="py-2 pr-3 text-right">Names</th>
            {cols.map((c) => (
              <th key={c.key} className="px-2 py-2 text-right">{c.label}</th>
            ))}
            <th className="py-2 pl-3 text-right">Breadth 1D</th>
          </tr>
        </thead>
        <tbody>
          {sectors.map((s) => (
            <tr key={s.sector} className="border-b border-slate-50">
              <td className="py-2 pr-4 font-bold text-slate-800">{s.sector}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-slate-400">{s.n}</td>
              {cols.map((c) => {
                const v = s[c.key] as number | null
                return (
                  <td key={c.key} className="px-2 py-2 text-right font-semibold tabular-nums" style={heat(v, c.scale)}>
                    {fmtSignedPct(v)}
                  </td>
                )
              })}
              <td className="py-2 pl-3 text-right tabular-nums text-slate-500">
                {s.adv_pct == null ? '—' : `${(s.adv_pct * 100).toFixed(0)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BreadthBar({ label, pct, detail, tip }: {
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

function MacroCardBox({ card }: { card: MarketMacroCard }) {
  const points = card.spark_values.map((v, i) => ({ i, v }))
  const hasData = Number.isFinite(card.latest)
  const trendUp = card.spark_values.length >= 2 && card.spark_values[card.spark_values.length - 1] >= card.spark_values[0]
  const deltaStr = card.delta == null ? '' : `${card.delta > 0 ? '+' : ''}${card.delta.toFixed(card.dec)}`
  return (
    <div className="rounded-card border border-gray-200 bg-white px-4 py-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-slate-400">{card.label}</div>
          {hasData ? (
            <div className="mt-0.5 text-[1.15rem] font-extrabold tabular-nums text-slate-900">
              {card.latest.toFixed(card.dec)}{card.unit}
              {deltaStr && (
                // Rates/yields: direction only, neutral color (a move isn't "good" or "bad").
                <span className="ml-1.5 text-[0.74rem] font-semibold text-slate-500">
                  {card.delta! > 0 ? '▲' : card.delta! < 0 ? '▼' : ''}{deltaStr}
                </span>
              )}
            </div>
          ) : (
            <div className="mt-0.5 text-[0.9rem] font-semibold text-slate-400">no recent reading</div>
          )}
        </div>
        {points.length > 1 && (
          <div className="h-10 w-24 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <Line type="monotone" dataKey="v" stroke={trendUp ? '#0ea5e9' : '#94a3b8'} strokeWidth={1.4}
                  dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="mt-1 text-[0.68rem] text-slate-400">as of {fmtDate(card.as_of)}</div>
    </div>
  )
}

function MoverList({ movers, title }: { movers: MarketMover[]; title: string }) {
  return (
    <div>
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-slate-400">{title}</div>
      <div className="mt-2 space-y-1.5">
        {movers.map((m) => (
          <div key={m.security_id} className="flex items-center gap-2.5 text-[0.82rem]">
            <Link to={`/securities/${m.ticker}`} className="w-14 shrink-0 font-bold text-slate-800 hover:text-indigo-600">
              {m.ticker}
            </Link>
            <span className="min-w-0 flex-1 truncate text-slate-400">{m.name}</span>
            <span className="shrink-0 tabular-nums text-slate-400">{fmtMoney(m.market_cap)}</span>
            <span className="w-16 shrink-0 text-right font-bold tabular-nums" style={{ color: plColor(m.r1d) }}>
              {fmtSignedPct(m.r1d)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function timeAgo(epoch: number): string {
  if (!epoch) return ''
  const mins = Math.max(0, Math.round((Date.now() / 1000 - epoch) / 60))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`
}

function cacheAgeLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

const FACTOR_LABEL: Record<string, string> = {
  growth: 'Growth', value: 'Value', quality: 'Quality', momentum: 'Momentum',
}

/** "What worked today" — factor top-quintile-minus-bottom-quintile 1d spread. */
function FactorOfDay({ factors }: { factors: MarketFactorDay[] }) {
  if (!factors.length) return null
  const max = Math.max(...factors.map((f) => Math.abs(f.spread)), 0.001)
  return (
    <div className="space-y-2.5">
      {factors.map((f) => {
        const pos = f.spread >= 0
        return (
          <div key={f.factor} className="flex items-center gap-3 text-[0.82rem]">
            <span className="w-20 shrink-0 font-semibold text-slate-600">{FACTOR_LABEL[f.factor]}</span>
            <div className="relative flex h-3 flex-1 items-center">
              <div className="absolute left-1/2 h-full w-px bg-gray-200" />
              <div
                className="absolute h-2 rounded-sm"
                style={{
                  width: `${(Math.abs(f.spread) / max) * 50}%`,
                  [pos ? 'left' : 'right']: '50%',
                  background: pos ? '#10b981' : '#ef4444',
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-bold tabular-nums" style={{ color: plColor(f.spread) }}>
              {fmtSignedPct(f.spread)}
            </span>
          </div>
        )
      })}
      <p className="pt-1 text-[0.72rem] text-slate-400">
        Top fifth minus bottom fifth, by 1-day return. The leader is the style the market rewarded today.
      </p>
    </div>
  )
}

/** Regime strip — quick signals, each with a non-color glyph + a tooltip. */
function RegimeStrip({ d }: { d: MarketOverviewResponse }) {
  const spy1d = d.market.spy_r1d
  const breadth = d.breadth.pct_above_ma50
  const vixCard = d.macro.cards.find((c) => c.id === 'VIXCLS')
  const dgs10Card = d.macro.cards.find((c) => c.id === 'DGS10')
  const vix = vixCard?.latest ?? null
  const r10 = dgs10Card?.latest ?? null
  const r10d = dgs10Card?.delta ?? null
  const topSector = [...d.sectors].sort((a, b) => (b.r1d ?? -Infinity) - (a.r1d ?? -Infinity))[0]
  const part = d.breadth.divergence

  type Chip = { label: string; value: string; glyph: string; color: string; bg: string; tip: string }
  const chips: Chip[] = [
    {
      label: 'Risk', glyph: spy1d == null ? '–' : spy1d >= 0.005 ? '▲' : spy1d <= -0.005 ? '▼' : '■',
      value: spy1d == null ? '—' : spy1d >= 0.005 ? 'Risk-On' : spy1d <= -0.005 ? 'Risk-Off' : 'Neutral',
      color: spy1d == null ? '#94a3b8' : spy1d >= 0.005 ? '#047857' : spy1d <= -0.005 ? '#b91c1c' : '#64748b',
      bg: spy1d == null ? '#f1f5f9' : spy1d >= 0.005 ? '#ecfdf5' : spy1d <= -0.005 ? '#fef2f2' : '#f8fafc',
      tip: 'Risk appetite from the index move last session. Up ≈ buyers in control, down ≈ sellers.',
    },
    {
      label: 'Breadth', glyph: breadth == null ? '–' : breadth >= 0.6 ? '▲' : breadth >= 0.4 ? '■' : '▼',
      value: breadth == null ? '—' : breadth >= 0.6 ? `Healthy ${(breadth * 100).toFixed(0)}%` : breadth >= 0.4 ? `Moderate ${(breadth * 100).toFixed(0)}%` : `Narrow ${(breadth * 100).toFixed(0)}%`,
      color: breadth == null ? '#94a3b8' : breadth >= 0.6 ? '#047857' : breadth >= 0.4 ? '#b45309' : '#b91c1c',
      bg: breadth == null ? '#f1f5f9' : breadth >= 0.6 ? '#ecfdf5' : breadth >= 0.4 ? '#fffbeb' : '#fef2f2',
      tip: G.ma50,
    },
    {
      label: 'Rates', glyph: r10d == null ? '–' : r10d > 0.01 ? '▲' : r10d < -0.01 ? '▼' : '■',
      value: r10 == null ? '—' : `10Y ${r10.toFixed(2)}%`,
      color: '#475569', bg: '#f8fafc', tip: G.rates,
    },
    {
      label: 'VIX', glyph: vix == null ? '–' : vix < 18 ? '▼' : vix < 25 ? '■' : '▲',
      value: vix == null ? '—' : vix < 18 ? `Low ${vix.toFixed(1)}` : vix < 25 ? `Moderate ${vix.toFixed(1)}` : `Elevated ${vix.toFixed(1)}`,
      color: vix == null ? '#94a3b8' : vix < 18 ? '#047857' : vix < 25 ? '#b45309' : '#b91c1c',
      bg: vix == null ? '#f1f5f9' : vix < 18 ? '#ecfdf5' : vix < 25 ? '#fffbeb' : '#fef2f2',
      tip: G.vix,
    },
    {
      label: 'Participation',
      glyph: part?.state === 'narrow' ? '▼' : part?.state === 'resilient' ? '▲' : '■',
      value: part?.state === 'narrow' ? 'Narrow' : part?.state === 'resilient' ? 'Resilient' : 'Aligned',
      color: part?.state === 'narrow' ? '#b45309' : part?.state === 'resilient' ? '#047857' : '#64748b',
      bg: part?.state === 'narrow' ? '#fffbeb' : part?.state === 'resilient' ? '#ecfdf5' : '#f8fafc',
      tip: part?.detail || G.breadth,
    },
    {
      label: 'Leading',
      glyph: topSector?.r1d != null && topSector.r1d >= 0 ? '▲' : '▼',
      value: topSector ? `${topSector.sector} ${fmtSignedPct(topSector.r1d)}` : '—',
      color: topSector?.r1d != null && topSector.r1d >= 0 ? '#047857' : '#b91c1c',
      bg: topSector?.r1d != null && topSector.r1d >= 0 ? '#ecfdf5' : '#fef2f2',
      tip: 'The sector with the strongest average move last session.',
    },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-slate-400">Last close</span>
      {chips.map((s) => (
        <div key={s.label} className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5" style={{ background: s.bg }}>
          <span aria-hidden style={{ color: s.color }}>{s.glyph}</span>
          <span className="text-[0.66rem] font-bold uppercase tracking-[0.07em] text-slate-600">{s.label}</span>
          <span className="text-[0.78rem] font-bold" style={{ color: s.color }}>{s.value}</span>
          <InfoTip text={s.tip} />
        </div>
      ))}
    </div>
  )
}

/** Honest freshness banner driven by session-staleness, not cache age. */
function FreshnessRow({ d }: { d: MarketOverviewResponse }) {
  const f = d.freshness
  const cov = d.coverage
  const cache = `internals computed ${cacheAgeLabel(d.cache_age_seconds)}`
  // Only a real prior session counts as a "shrink" — priced_prev is 0 when there
  // is no prior session, which must not render as "down from 0".
  const covShrunk = cov && cov.priced_prev > 0 && cov.priced < cov.priced_prev * 0.95

  let tone: 'calm' | 'info' | 'warn' = 'calm'
  let msg: React.ReactNode = (
    <span><span className="font-bold text-gray-700">Up to date</span> through {fmtDate(d.as_of)} (latest US session)</span>
  )
  if (f && f.tier === 'lagging') {
    tone = 'info'
    msg = f.pre_close ? (
      <span><span className="font-bold">Showing {fmtDate(d.as_of)}.</span> The {fmtDate(f.expected_session)} session posts after tonight's ingest.</span>
    ) : (
      <span><span className="font-bold">1 session behind:</span> latest US close was {fmtDate(f.expected_session)}; this page reflects {fmtDate(d.as_of)}.</span>
    )
  } else if (f && f.tier === 'stale') {
    tone = 'warn'
    msg = (
      <span>
        <span className="font-bold">Data is {f.sessions_behind} sessions behind.</span> Latest US close was{' '}
        {fmtDate(f.expected_session)}, but this page reflects {fmtDate(d.as_of)} — treat "last session" and 1-day moves as of {fmtDate(d.as_of)}.
      </span>
    )
  }
  const styles = {
    calm: 'border-gray-200 bg-gray-50 text-gray-500',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
    warn: 'border-amber-300 bg-amber-50 text-amber-700',
  }[tone]
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-[0.74rem] ${styles}`}>
      <span className="flex items-center">
        {tone === 'warn' && <span aria-hidden className="mr-1.5">⚠</span>}
        {msg}
        <InfoTip text={G.freshness} />
      </span>
      {cov && (
        <span className={covShrunk ? 'font-semibold text-amber-700' : 'text-gray-400'}>
          Priced {cov.priced.toLocaleString()} of {cov.active.toLocaleString()} active names
          {covShrunk && ` (down from ${cov.priced_prev.toLocaleString()} last session — ingest catching up)`}
        </span>
      )}
      <span className="text-gray-400">{cache}</span>
    </div>
  )
}

const TONE_C: Record<string, { border: string; bg: string; fg: string }> = {
  good: { border: '#86efac', bg: '#f0fdf4', fg: '#047857' },
  warn: { border: '#fde68a', bg: '#fffbeb', fg: '#b45309' },
  bad: { border: '#fecaca', bg: '#fef2f2', fg: '#b91c1c' },
  neutral: { border: '#e2e8f0', bg: '#f8fafc', fg: '#475569' },
}

/** Risk-on ↔ risk-off gauge: a gradient bar with a marker placed by a blend of
 * breadth (60%) and the index move (40%) — the 2-second gestalt of the regime. */
function RiskGauge({ score }: { score: number }) {
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

/** Regime hero — the verdict, a risk gauge, and a clean live-SPY tile. The
 * scannable "where does the market stand" read that leads the page. */
function RegimeHero({ read, spyLive, spy1d, ewr1d, breadth, liveVsLast }: {
  read: MarketRead | null
  spyLive: { price: number | null; change_pct: number | null } | undefined
  spy1d: number | null
  ewr1d: number | null
  breadth: number | null
  liveVsLast: string | null
}) {
  const c = TONE_C[read?.tone ?? 'neutral']
  const bScore = breadth ?? 0.5
  const mScore = Math.max(0, Math.min(1, 0.5 + (spy1d ?? 0) / 0.04))
  const riskScore = 0.6 * bScore + 0.4 * mScore
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_260px]">
      <div className="rounded-xl border px-4 py-3.5" style={{ borderColor: c.border, background: c.bg }}>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.fg }} aria-hidden />
          <span className="text-[1.15rem] font-extrabold tracking-tight" style={{ color: c.fg }}>
            {read?.state ?? 'Market'}
          </span>
          <InfoTip text="Plain-English read of the last session's tape — from the index move, breadth, and sector rotation. Not advice." />
        </div>
        {read?.text && <p className="mt-1 text-[0.92rem] leading-snug text-slate-700">{read.text}</p>}
        <RiskGauge score={riskScore} />
      </div>
      <div className="flex flex-col justify-center rounded-xl border border-gray-200 bg-white px-4 py-3.5">
        {spyLive?.price != null ? (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-slate-400">SPY</span>
            <span className="text-[1.35rem] font-extrabold tabular-nums text-slate-900">${spyLive.price.toFixed(2)}</span>
            <span className="text-[0.95rem] font-bold tabular-nums" style={{ color: plColor(spyLive.change_pct) }}>
              {spyLive.change_pct == null ? '' : `${spyLive.change_pct > 0 ? '+' : ''}${spyLive.change_pct.toFixed(2)}%`}
            </span>
            <Provenance kind="live" />
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-slate-400">SPY</span>
            <span className="text-[0.82rem] text-slate-400">market closed</span>
          </div>
        )}
        {liveVsLast && <div className="mt-0.5 text-[0.7rem] text-slate-400">Live SPY is {liveVsLast}</div>}
        <div className="mt-2 border-t border-slate-100 pt-2 text-[0.76rem]">
          <span className="text-slate-400">Last close </span>
          <span className="font-bold tabular-nums" style={{ color: plColor(spy1d) }}>SPY {fmtSignedPct(spy1d)}</span>
          <span className="mx-1 text-gray-300">·</span>
          <span className="font-bold tabular-nums" style={{ color: plColor(ewr1d) }}>avg {fmtSignedPct(ewr1d)}</span>
        </div>
      </div>
    </div>
  )
}

/** Diverging bar — green (left/positive) vs red (right/negative), sized by share. */
function DivergeBar({ left, right }: { left: number; right: number }) {
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
function MeterBar({ pct }: { pct: number | null }) {
  if (pct == null) return <div className="mt-2 h-2 rounded-full bg-slate-100" />
  const c = pct >= 0.6 ? '#34d399' : pct >= 0.4 ? '#fbbf24' : '#f87171'
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, pct * 100))}%`, background: c }} />
    </div>
  )
}

function SnapTile({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-1 text-[0.6rem] font-bold uppercase tracking-[0.07em] text-slate-400">
        {label}{tip && <InfoTip text={tip} />}
      </div>
      {children}
    </div>
  )
}

/** Session snapshot — the day's internals as instant mini-viz, so the data leads
 * the recap instead of being buried in prose. */
function SessionSnapshot({ d }: { d: MarketOverviewResponse }) {
  const b = d.breadth
  const advTotal = b.advancers + b.decliners
  const advPct = advTotal > 0 ? b.advancers / advTotal : 0.5
  const spy = d.market.spy_r1d
  const avg = d.market.universe_ew_r1d
  const barW = (v: number | null) => Math.max(4, Math.min(100, (Math.abs(v ?? 0) / 0.03) * 100))
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SnapTile label="Advancers · decliners" tip="Active names that rose vs fell last session — the broad participation read.">
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[1.25rem] font-extrabold tabular-nums" style={{ color: advPct >= 0.5 ? '#047857' : '#b91c1c' }}>{(advPct * 100).toFixed(0)}%</span>
          <span className="text-[0.7rem] text-slate-400">advancing</span>
        </div>
        <DivergeBar left={b.advancers} right={b.decliners} />
        <div className="mt-1.5 flex justify-between text-[0.7rem] tabular-nums">
          <span className="font-semibold text-emerald-700">{b.advancers.toLocaleString()} up</span>
          <span className="font-semibold text-red-700">{b.decliners.toLocaleString()} down</span>
        </div>
      </SnapTile>

      <SnapTile label="Above 50-day avg" tip={G.ma50}>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[1.25rem] font-extrabold tabular-nums text-slate-900">{b.pct_above_ma50 == null ? '—' : `${(b.pct_above_ma50 * 100).toFixed(0)}%`}</span>
          <span className="text-[0.7rem] text-slate-400">in uptrend</span>
        </div>
        <MeterBar pct={b.pct_above_ma50} />
        <div className="mt-1.5 text-[0.7rem] tabular-nums text-slate-400">
          {b.pct_above_ma200 == null ? ' ' : `${(b.pct_above_ma200 * 100).toFixed(0)}% above 200-day`}
        </div>
      </SnapTile>

      <SnapTile label="New 52-wk highs · lows" tip="Stocks at fresh 1-year highs vs lows — the momentum extremes of the tape.">
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[1.25rem] font-extrabold tabular-nums text-emerald-700">{b.new_highs}</span>
          <span className="text-[0.7rem] text-slate-400">highs ·</span>
          <span className="text-[1.05rem] font-bold tabular-nums text-red-700">{b.new_lows}</span>
          <span className="text-[0.7rem] text-slate-400">lows</span>
        </div>
        <DivergeBar left={b.new_highs} right={b.new_lows} />
        <div className="mt-1.5 text-[0.7rem] text-slate-400">{b.new_highs >= b.new_lows ? 'highs leading' : 'lows leading'}</div>
      </SnapTile>

      <SnapTile label="Index vs typical stock" tip={G.equalWeight}>
        <div className="mt-1.5 space-y-2">
          {[{ k: 'SPY', v: spy }, { k: 'Avg stock', v: avg }].map((row) => (
            <div key={row.k} className="flex items-center gap-2">
              <span className="w-[3.6rem] shrink-0 text-[0.66rem] font-semibold text-slate-500">{row.k}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{ width: `${barW(row.v)}%`, background: (row.v ?? 0) >= 0 ? '#34d399' : '#f87171' }} />
              </div>
              <span className="w-12 shrink-0 text-right text-[0.72rem] font-bold tabular-nums" style={{ color: plColor(row.v) }}>{fmtSignedPct(row.v)}</span>
            </div>
          ))}
        </div>
        {b.divergence?.state === 'narrow' && (
          <div className="mt-1.5 text-[0.64rem] font-bold uppercase tracking-wide text-amber-700">Narrow — index ≠ typical stock</div>
        )}
        {b.divergence?.state === 'resilient' && (
          <div className="mt-1.5 text-[0.64rem] font-bold uppercase tracking-wide text-emerald-700">Resilient — stocks holding up</div>
        )}
      </SnapTile>
    </div>
  )
}

function AiBrief({ brief, computed, generating, asOf, stale }: {
  brief: MarketAiBrief | null
  computed: string[]
  generating: boolean
  asOf: string
  stale: boolean
}) {
  return (
    <div>
      {!brief ? (
        <div>
          {generating && (
            <div className="mb-3 flex items-center gap-2 text-[0.78rem] font-semibold text-indigo-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-600" />
              Writing today's market summary…
            </div>
          )}
          <ul className="space-y-2">
            {computed.map((s) => (
              <li key={s} className="flex items-start gap-2.5 text-[0.9rem] leading-relaxed text-slate-700">
                <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-indigo-600">
              {brief.regime.label}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.66rem] font-semibold text-slate-500">
              based on the {fmtDate(asOf)} close
            </span>
            <span className="text-[0.72rem] text-slate-400">{brief.regime.rationale}</span>
          </div>
          {stale && (
            <p className="mt-2 text-[0.74rem] font-medium text-amber-700">
              Note: this brief reflects the {fmtDate(asOf)} session — newer closes aren't in the data yet.
            </p>
          )}
          <p className="mt-3 border-l-[3px] border-indigo-200 pl-3.5 text-[1.18rem] font-bold leading-snug text-slate-900">
            {brief.headline}
          </p>
          {brief.watch.length > 0 && (
            <div className="mt-4">
              <div className="text-[0.66rem] font-bold uppercase tracking-[0.09em] text-slate-400">What to watch next</div>
              <div className="mt-2 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {brief.watch.map((w) => (
                  <div key={w} className="rounded-xl border border-[#eef1f6] bg-slate-50 p-3 text-[0.82rem] leading-relaxed text-slate-600">
                    <span className="mr-1.5 font-bold text-indigo-600">→</span>{w}
                  </div>
                ))}
              </div>
            </div>
          )}
          {brief.narrative.length > 0 && (
            <details className="group mt-4">
              <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[0.8rem] font-semibold text-indigo-600 hover:text-indigo-700">
                <svg className="h-3.5 w-3.5 transition-transform group-open:rotate-90" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clipRule="evenodd" />
                </svg>
                Read the full recap
              </summary>
              <div className="mt-2.5 space-y-2.5">
                {brief.narrative.map((p) => (
                  <p key={p} className="text-[0.9rem] leading-relaxed text-slate-700">{p}</p>
                ))}
              </div>
            </details>
          )}
          <details className="mt-3 border-t border-slate-100 pt-2.5">
            <summary className="cursor-pointer select-none text-[0.72rem] font-semibold text-gray-400 hover:text-slate-500">
              By the numbers
            </summary>
            <ul className="mt-1.5 space-y-1 pl-1">
              {computed.map((s) => (
                <li key={s} className="flex items-start gap-2 text-[0.78rem] text-slate-500">
                  <span className="mt-[0.4rem] h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                  {s}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  )
}

function marketStatus(asOf: string | null): { openNow: boolean; title: string; note: string | null } {
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

export function MarketPage() {
  const qc = useQueryClient()
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['market', 'overview'], queryFn: getMarketOverview, staleTime: 5 * 60 * 1000, retry: 1,
  })
  const { data: quotesData } = useQuery({ queryKey: ['quotes'], queryFn: getQuotes, staleTime: 5 * 60 * 1000 })

  const briefMut = useMutation({
    mutationFn: generateMarketBrief,
    onSuccess: (res) => { if (res.ai_brief) void qc.invalidateQueries({ queryKey: ['market', 'overview'] }) },
  })
  const attempted = useRef(false)
  const aiBrief = data?.ai_brief ?? null
  useEffect(() => {
    if (data && !aiBrief && !attempted.current) { attempted.current = true; briefMut.mutate() }
  }, [data, aiBrief, briefMut])

  if (isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-[150px] w-full rounded-card" />
        <div className="text-center text-xs text-gray-400">
          Computing market internals across ~5,500 stocks — first load after a server start can take half a minute…
        </div>
        <Skeleton className="h-[360px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  const d: MarketOverviewResponse = data
  const spyLive = quotesData?.quotes?.SPY
  const b = d.breadth
  const dd = b.drawdown
  const mkt = marketStatus(d.as_of)
  const stale = (d.freshness?.sessions_behind ?? 0) >= 2
  // live vs last-session synthesis (market hours only)
  const liveVsLast =
    mkt.openNow && spyLive?.change_pct != null && d.market.spy_r1d != null
      ? (Math.sign(spyLive.change_pct) === Math.sign(d.market.spy_r1d)
          ? 'extending last session' : 'reversing last session')
      : null

  return (
    <div className="space-y-5">
      <header className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
        <div className="h-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500" />
        <div className="px-7 pb-5 pt-6">
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
            <span className="text-indigo-600">StockBud</span>
            <span className="text-gray-300">/</span>
            <span className="text-slate-400">Market</span>
          </div>
          <h1 className="mt-2 text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-slate-900">
            Market overview
          </h1>
          <p className="mt-1 text-[0.8rem] text-slate-400">
            Equal-weight internals across our active universe — the 2-second read first, the full story below.
          </p>
          <RegimeHero
            read={d.read ?? null}
            spyLive={spyLive}
            spy1d={d.market.spy_r1d}
            ewr1d={d.market.universe_ew_r1d}
            breadth={b.pct_above_ma50}
            liveVsLast={liveVsLast}
          />
        </div>
        {/* Freshness FIRST — the trust signal leads, and gets prominence when stale. */}
        <div className={`px-7 py-2.5 ${stale ? 'bg-amber-50' : 'border-t border-slate-100'}`}>
          <FreshnessRow d={d} />
        </div>
        <div className="border-t border-slate-100 px-7 py-3">
          <RegimeStrip d={d} />
        </div>
      </header>

      <SectionCard
        title={mkt.title}
        hint={aiBrief
          ? 'AI-written once per day from the numbers on this page (Haiku) — grounded only in this data, not advice.'
          : 'Assembled from the numbers on this page. The AI narrative writes once when you open the tab.'}
      >
        {mkt.note && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[0.78rem] font-medium text-slate-600">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            {mkt.note}
          </div>
        )}
        <SessionSnapshot d={d} />
        <div className="mt-4 border-t border-slate-100 pt-4">
          <AiBrief brief={aiBrief} computed={d.brief} generating={briefMut.isPending} asOf={d.as_of} stale={stale} />
        </div>
      </SectionCard>

      <SectionCard
        title="Sector performance"
        tip={G.equalWeight}
        hint="Equal-weight average return of every active name in the sector — what the typical stock did, not just the mega-caps."
      >
        {d.rotation && d.rotation.state !== 'mixed' && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[0.8rem] font-medium"
            style={d.rotation.state === 'risk_on'
              ? { borderColor: '#a7f3d0', background: '#f0fdf4', color: '#047857' }
              : { borderColor: '#fde68a', background: '#fffbeb', color: '#b45309' }}>
            {d.rotation.state === 'risk_on'
              ? `Risk-on rotation — cyclicals (${fmtSignedPct(d.rotation.cyc_r1d)}) leading defensives (${fmtSignedPct(d.rotation.def_r1d)}).`
              : `Defensive rotation — defensives (${fmtSignedPct(d.rotation.def_r1d)}) leading cyclicals (${fmtSignedPct(d.rotation.cyc_r1d)}).`}
            <InfoTip text={G.rotation} />
          </div>
        )}
        <SectorTable sectors={d.sectors} />
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Market internals"
          tip={G.breadth}
          hint="Breadth and trend health across all names — rallies on narrow breadth are fragile."
        >
          <div className="space-y-4">
            <BreadthBar label="Advancers (last session)"
              pct={b.advancers / Math.max(b.advancers + b.decliners, 1)}
              detail={`${b.advancers.toLocaleString()} up · ${b.decliners.toLocaleString()} down`} />
            <BreadthBar label="Above 50-day average" pct={b.pct_above_ma50} tip={G.ma50} />
            <BreadthBar label="Above 200-day average" pct={b.pct_above_ma200} tip={G.ma200} />
            <div className="flex gap-6 border-t border-slate-100 pt-3 text-[0.84rem]">
              <span>
                <span className="font-extrabold tabular-nums text-emerald-600">{b.new_highs}</span>{' '}
                <span className="text-slate-500">new 52-week highs</span>
              </span>
              <span className="flex items-center">
                <span className="font-extrabold tabular-nums text-red-600">{b.new_lows}</span>{' '}
                <span className="ml-1 text-slate-500">new 52-week lows</span>
                <InfoTip text={G.highsLows} />
              </span>
            </div>
            {dd && (
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Distance from 52-week highs<InfoTip text={G.drawdown} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {[
                    { k: 'near', label: 'within 5%', v: dd.near_high_pct, c: '#047857' },
                    { k: 'corr', label: 'in a correction (10%+)', v: dd.correction_pct, c: '#b45309' },
                    { k: 'bear', label: '20%+ off highs', v: dd.bear_pct, c: '#b91c1c' },
                  ].map((x) => (
                    <div key={x.k} className="rounded-lg bg-slate-50 px-2 py-2">
                      <div className="text-[1.05rem] font-extrabold tabular-nums" style={{ color: x.c }}>
                        {(x.v * 100).toFixed(0)}%
                      </div>
                      <div className="text-[0.66rem] text-slate-400">{x.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Macro dashboard" hint="Rates, volatility and inflation context — 90-day trend in each sparkline.">
          <div className="mb-2"><Provenance kind="fred" /></div>
          <div className="grid grid-cols-2 gap-3">
            {d.macro.cards.map((c) => <MacroCardBox key={c.id} card={c} />)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[0.8rem] text-slate-500">
            {d.macro.curve_bps != null && (
              <span className="flex items-center">
                2s10s curve{' '}
                <strong className="ml-1 tabular-nums text-slate-800">
                  {d.macro.curve_bps > 0 ? '+' : ''}{d.macro.curve_bps.toFixed(0)}bps
                </strong>
                {d.macro.curve_bps < 0 && ' (inverted)'}
                <InfoTip text={G.curve} />
              </span>
            )}
            {d.macro.cpi_yoy != null && (
              <span>
                CPI <strong className="tabular-nums text-slate-800">{fmtSignedPct(d.macro.cpi_yoy)}</strong>{' '}
                YoY {d.macro.cpi_as_of && `(as of ${fmtDate(d.macro.cpi_as_of)})`}
              </span>
            )}
          </div>
        </SectionCard>
      </div>

      {/* what worked today (factors) + movers */}
      <div className="grid gap-5 lg:grid-cols-5">
        {d.factor_day && d.factor_day.length > 0 && (
          <div className="lg:col-span-2">
            <SectionCard title="What worked today — by factor" tip={G.factorDay}
              hint="Which style the market rewarded, from the factor scores that drive the screener.">
              <FactorOfDay factors={d.factor_day} />
            </SectionCard>
          </div>
        )}
        <div className={d.factor_day && d.factor_day.length > 0 ? 'lg:col-span-3' : 'lg:col-span-5'}>
          <SectionCard title={`Biggest movers — ${fmtDate(d.as_of)} session`}
            hint="Names above $250M market cap only (micro-cap noise excluded). Click through for the full deep-dive.">
            <div className="grid gap-6 md:grid-cols-2">
              <MoverList movers={d.movers.gainers} title="Gainers" />
              <MoverList movers={d.movers.losers} title="Losers" />
            </div>
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-5">
        <div className="md:col-span-2 lg:col-span-3">
          <SectionCard
            title="Company news from the source — high-signal 8-Ks"
            hint="Material-event filings across all ~5,500 companies in the last few days: M&A, executive changes, results, delistings."
            right={<FilingFreshness date={maxIsoDate(d.filings.map((f) => f.filed_date))} />}
          >
            <div className="max-h-[460px] space-y-3 overflow-auto pr-1">
              {d.filings.length === 0 && <p className="text-sm text-gray-400">No high-signal filings in the window.</p>}
              {d.filings.map((f) => (
                <div key={f.accession_no + f.security_id} className="flex items-start gap-3">
                  <div className="w-[4.2rem] shrink-0 pt-0.5 text-[0.7rem] tabular-nums text-slate-400">
                    {fmtShortDate(f.filed_date)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {f.ticker && (
                        <Link to={`/securities/${f.ticker}`} className="font-bold text-slate-800 hover:text-indigo-600">{f.ticker}</Link>
                      )}
                      <span className="truncate text-[0.76rem] text-slate-400">
                        {f.name} {f.market_cap ? `· ${fmtMoney(f.market_cap)}` : ''}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {f.labels.slice(0, 3).map((l) => (
                        <span key={l} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[0.68rem] font-semibold text-indigo-600">{l}</span>
                      ))}
                      {f.primary_doc_url && (
                        <a href={f.primary_doc_url} target="_blank" rel="noreferrer"
                          className="rounded-full bg-slate-50 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-400 hover:text-indigo-600">SEC filing ↗</a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
        <div className="md:col-span-2 lg:col-span-2">
          <SectionCard title="Insider buying pulse"
            hint="Largest open-market insider purchases filed in the last 7 days (Form 4, code P). Context only."
            right={<FilingFreshness date={maxIsoDate(d.insider_buys.map((i) => i.last_filed))} />}>
            <div className="space-y-2.5">
              {d.insider_buys.length === 0 && <p className="text-sm text-gray-400">No open-market buys filed this week.</p>}
              {d.insider_buys.map((i) => (
                <div key={i.security_id} className="flex items-center gap-2.5 text-[0.84rem]">
                  <Link to={`/securities/${i.ticker}`} className="w-16 shrink-0 font-bold text-slate-800 hover:text-indigo-600">{i.ticker}</Link>
                  <span className="min-w-0 flex-1 truncate text-[0.76rem] text-slate-400">
                    {i.buyers} buyer{i.buyers !== 1 ? 's' : ''} · filed {fmtShortDate(i.last_filed)}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-emerald-600">{fmtMoney(i.total_value)}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Headlines" hint="Top stories from public feeds (CNBC, MarketWatch, Yahoo Finance) — refreshed ~15 min.">
        <div className="space-y-2.5">
          {d.headlines.length === 0 && (
            <p className="text-sm text-gray-400">Feeds unreachable right now — the rest of the page is unaffected.</p>
          )}
          {d.headlines.map((h) => (
            <a key={h.url} href={h.url} target="_blank" rel="noreferrer" className="group flex items-baseline gap-3 no-underline">
              <span className="w-24 shrink-0 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-400">{h.source}</span>
              <span className="min-w-0 flex-1 truncate text-[0.88rem] font-medium text-slate-700 group-hover:text-indigo-600">{h.title}</span>
              <span className="shrink-0 text-[0.7rem] text-slate-400">{timeAgo(h.published_epoch)}</span>
            </a>
          ))}
        </div>
      </SectionCard>

      <p className="pb-2 text-center text-xs text-gray-400">
        Whole-market context from nightly data, SEC filings and public feeds — not investment advice.
      </p>
    </div>
  )
}
