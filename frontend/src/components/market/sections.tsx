import { Link } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'

import { InfoTip } from '@/components/ui/InfoTip'
import { plColor } from '@/lib/colors'
import { TABLE_HEAD_ROW } from '@/lib/constants'
import { fmtDate, fmtMoney, fmtSignedPct } from '@/lib/format'
import type {
  MarketAiBrief,
  MarketFactorDay,
  MarketMacroCard,
  MarketMover,
  MarketOverviewResponse,
  MarketRead,
  MarketSectorRow,
} from '@/types/api'

import { DivergeBar, MeterBar, Provenance, RiskGauge, SnapTile } from './shared'
import { cacheAgeLabel, FACTOR_LABEL, G, heat, TONE_C } from './utils'

export function SectorTable({ sectors }: { sectors: MarketSectorRow[] }) {
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
          <tr className={TABLE_HEAD_ROW}>
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

export function MacroCardBox({ card }: { card: MarketMacroCard }) {
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

export function MoverList({ movers, title }: { movers: MarketMover[]; title: string }) {
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

/** "What worked today" — factor top-quintile-minus-bottom-quintile 1d spread. */
export function FactorOfDay({ factors }: { factors: MarketFactorDay[] }) {
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
export function RegimeStrip({ d }: { d: MarketOverviewResponse }) {
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
export function FreshnessRow({ d }: { d: MarketOverviewResponse }) {
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

/** Regime hero — the verdict, a risk gauge, and a clean live-SPY tile. The
 * scannable "where does the market stand" read that leads the page. */
export function RegimeHero({ read, spyLive, spy1d, ewr1d, breadth, liveVsLast }: {
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

/** Session snapshot — the day's internals as instant mini-viz, so the data leads
 * the recap instead of being buried in prose. */
export function SessionSnapshot({ d }: { d: MarketOverviewResponse }) {
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
          {b.pct_above_ma200 == null ? ' ' : `${(b.pct_above_ma200 * 100).toFixed(0)}% above 200-day`}
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

export function AiBrief({ brief, computed, generating, asOf, stale }: {
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
