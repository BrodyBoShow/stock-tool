import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'

import { ErrorCard } from '@/components/ErrorCard'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { generateMarketBrief, getMarketOverview, getQuotes } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { fmtDate, fmtMoney, fmtSignedPct } from '@/lib/format'
import type {
  MarketAiBrief,
  MarketMacroCard,
  MarketMover,
  MarketOverviewResponse,
  MarketSectorRow,
} from '@/types/api'

/** Heat-cell background: green/red, intensity scaled to the column's range. */
function heat(v: number | null, scale: number): React.CSSProperties {
  if (v == null) return {}
  const a = Math.min(Math.abs(v) / scale, 1) * 0.38
  return {
    background: v >= 0 ? `rgba(16,185,129,${a})` : `rgba(239,68,68,${a})`,
  }
}

function SectorTable({ sectors }: { sectors: MarketSectorRow[] }) {
  const cols: { key: keyof MarketSectorRow; label: string; scale: number }[] = [
    { key: 'r1d', label: '1D', scale: 0.025 },
    { key: 'r1w', label: '1W', scale: 0.05 },
    { key: 'r1m', label: '1M', scale: 0.08 },
    { key: 'r3m', label: '3M', scale: 0.15 },
    { key: 'rytd', label: 'YTD', scale: 0.25 },
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.84rem]">
        <thead>
          <tr className="border-b border-[#eef1f6] text-left text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
            <th className="py-2 pr-4">Sector</th>
            <th className="py-2 pr-3 text-right">Names</th>
            {cols.map((c) => (
              <th key={c.key} className="px-2 py-2 text-right">{c.label}</th>
            ))}
            <th className="py-2 pl-3 text-right" title="% of the sector's names up in the last session">
              Breadth 1D
            </th>
          </tr>
        </thead>
        <tbody>
          {sectors.map((s) => (
            <tr key={s.sector} className="border-b border-[#f8fafc]">
              <td className="py-2 pr-4 font-bold text-[#1e293b]">{s.sector}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-[#94a3b8]">{s.n}</td>
              {cols.map((c) => {
                const v = s[c.key] as number | null
                return (
                  <td
                    key={c.key}
                    className="px-2 py-2 text-right font-semibold tabular-nums"
                    style={heat(v, c.scale)}
                  >
                    {fmtSignedPct(v)}
                  </td>
                )
              })}
              <td className="py-2 pl-3 text-right tabular-nums text-[#64748b]">
                {s.adv_pct == null ? '—' : `${(s.adv_pct * 100).toFixed(0)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BreadthBar({
  label,
  pct,
  detail,
}: {
  label: string
  pct: number | null
  detail?: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[0.78rem]">
        <span className="font-semibold text-[#475569]">{label}</span>
        <span className="font-bold tabular-nums text-[#1e293b]">
          {pct == null ? '—' : `${(pct * 100).toFixed(0)}%`}
          {detail && <span className="ml-1.5 font-normal text-[#94a3b8]">{detail}</span>}
        </span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-[#fee2e2]">
        <div
          className="h-full rounded-full bg-emerald-500/80"
          style={{ width: `${(pct ?? 0) * 100}%` }}
        />
      </div>
    </div>
  )
}

function MacroCardBox({ card }: { card: MarketMacroCard }) {
  const points = card.spark_values.map((v, i) => ({ i, v }))
  const deltaStr =
    card.delta == null ? '' : `${card.delta > 0 ? '+' : ''}${card.delta.toFixed(card.dec)}`
  return (
    <div className="rounded-card border border-[#e5e7eb] bg-white px-4 py-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
            {card.label}
          </div>
          <div className="mt-0.5 text-[1.15rem] font-extrabold tabular-nums text-[#0f172a]">
            {card.latest.toFixed(card.dec)}{card.unit}
            {deltaStr && (
              <span
                className="ml-1.5 text-[0.74rem] font-semibold"
                style={{ color: card.delta! > 0 ? '#dc2626' : '#059669' }}
              >
                {deltaStr}
              </span>
            )}
          </div>
        </div>
        <div className="h-10 w-24">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Line type="monotone" dataKey="v" stroke="#4f46e5" strokeWidth={1.4}
                dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="mt-1 text-[0.68rem] text-[#cbd5e1]">as of {fmtDate(card.as_of)}</div>
    </div>
  )
}

function MoverList({ movers, title }: { movers: MarketMover[]; title: string }) {
  return (
    <div>
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
        {title}
      </div>
      <div className="mt-2 space-y-1.5">
        {movers.map((m) => (
          <div key={m.security_id} className="flex items-center gap-2.5 text-[0.82rem]">
            <Link
              to={`/securities/${m.ticker}`}
              className="w-14 shrink-0 font-bold text-[#1e293b] hover:text-[#4f46e5]"
            >
              {m.ticker}
            </Link>
            <span className="min-w-0 flex-1 truncate text-[#94a3b8]">{m.name}</span>
            <span className="shrink-0 tabular-nums text-[#94a3b8]">{fmtMoney(m.market_cap)}</span>
            <span
              className="w-16 shrink-0 text-right font-bold tabular-nums"
              style={{ color: plColor(m.r1d) }}
            >
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

/** Regime strip — 5 quick signals derived from existing market data. */
function RegimeStrip({
  d,
}: {
  d: MarketOverviewResponse
}) {
  const spy1d = d.market.spy_r1d
  const breadth = d.breadth.pct_above_ma50

  // find VIX and 10Y from macro cards
  const vixCard = d.macro.cards.find((c) => c.id === 'VIXCLS')
  const dgs10Card = d.macro.cards.find((c) => c.id === 'DGS10')
  const vix = vixCard?.latest ?? null
  const rates10yDelta = dgs10Card?.delta ?? null

  // top sector by 1D return
  const topSector = [...d.sectors].sort((a, b) => (b.r1d ?? -Infinity) - (a.r1d ?? -Infinity))[0]

  const signals: Array<{ label: string; value: string; color: string; bg: string }> = [
    {
      label: 'Risk',
      value: spy1d == null ? '—' : spy1d >= 0.005 ? 'Risk-On' : spy1d <= -0.005 ? 'Risk-Off' : 'Neutral',
      color: spy1d == null ? '#94a3b8' : spy1d >= 0.005 ? '#059669' : spy1d <= -0.005 ? '#dc2626' : '#64748b',
      bg: spy1d == null ? '#f1f5f9' : spy1d >= 0.005 ? '#ecfdf5' : spy1d <= -0.005 ? '#fef2f2' : '#f8fafc',
    },
    {
      label: 'Breadth',
      value: breadth == null ? '—' : breadth >= 0.6 ? `Healthy (${(breadth * 100).toFixed(0)}%)` : breadth >= 0.4 ? `Moderate (${(breadth * 100).toFixed(0)}%)` : `Narrow (${(breadth * 100).toFixed(0)}%)`,
      color: breadth == null ? '#94a3b8' : breadth >= 0.6 ? '#059669' : breadth >= 0.4 ? '#d97706' : '#dc2626',
      bg: breadth == null ? '#f1f5f9' : breadth >= 0.6 ? '#ecfdf5' : breadth >= 0.4 ? '#fffbeb' : '#fef2f2',
    },
    {
      label: 'Rates',
      value: rates10yDelta == null ? '—' : rates10yDelta > 0.05 ? `Rising (${dgs10Card!.latest.toFixed(2)}%)` : rates10yDelta < -0.05 ? `Falling (${dgs10Card!.latest.toFixed(2)}%)` : `Stable (${dgs10Card!.latest.toFixed(2)}%)`,
      color: rates10yDelta == null ? '#94a3b8' : Math.abs(rates10yDelta) <= 0.05 ? '#059669' : '#d97706',
      bg: rates10yDelta == null ? '#f1f5f9' : Math.abs(rates10yDelta) <= 0.05 ? '#ecfdf5' : '#fffbeb',
    },
    {
      label: 'VIX',
      value: vix == null ? '—' : vix < 18 ? `Low (${vix.toFixed(1)})` : vix < 25 ? `Moderate (${vix.toFixed(1)})` : `Elevated (${vix.toFixed(1)})`,
      color: vix == null ? '#94a3b8' : vix < 18 ? '#059669' : vix < 25 ? '#d97706' : '#dc2626',
      bg: vix == null ? '#f1f5f9' : vix < 18 ? '#ecfdf5' : vix < 25 ? '#fffbeb' : '#fef2f2',
    },
    {
      label: 'Leading',
      value: topSector?.sector ?? '—',
      color: topSector?.r1d != null && topSector.r1d >= 0 ? '#059669' : '#dc2626',
      bg: topSector?.r1d != null && topSector.r1d >= 0 ? '#ecfdf5' : '#fef2f2',
    },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {signals.map((s) => (
        <div
          key={s.label}
          className="flex items-center gap-2 rounded-full border border-[#e5e7eb] px-3 py-1.5"
          style={{ background: s.bg }}
        >
          <span className="text-[0.67rem] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">
            {s.label}
          </span>
          <span className="text-[0.78rem] font-bold" style={{ color: s.color }}>
            {s.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Freshness row — summarizes when all the page data was last computed. */
function FreshnessRow({ d }: { d: MarketOverviewResponse }) {
  const age = d.cache_age_seconds
  const isStale = age > 600 // > 10 min
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-[0.72rem] ${
      isStale
        ? 'border-[#fde68a] bg-[#fffbeb] text-[#b45309]'
        : 'border-[#e5e7eb] bg-[#f9fafb] text-[#6b7280]'
    }`}>
      <span>
        <span className={`font-bold ${isStale ? 'text-[#d97706]' : 'text-[#374151]'}`}>
          Internals cached {cacheAgeLabel(age)}
        </span>
        {isStale && ' — may be stale, refresh the page to re-compute'}
      </span>
      <span className="text-[#9ca3af]">Closes through {fmtDate(d.as_of)}</span>
    </div>
  )
}

/** AI market brief — the narrative read. Falls back to the computed bullets
 *  (shown by the caller) when it's not yet generated. */
function AiBrief({
  brief,
  computed,
  generating,
}: {
  brief: MarketAiBrief | null
  computed: string[]
  generating: boolean
}) {
  if (!brief) {
    return (
      <div>
        {generating && (
          <div className="mb-3 flex items-center gap-2 text-[0.78rem] font-semibold text-[#4f46e5]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#4f46e5]" />
            Writing today's market summary…
          </div>
        )}
        <ul className="space-y-2">
          {computed.map((s) => (
            <li key={s} className="flex items-start gap-2.5 text-[0.9rem] leading-relaxed text-[#334155]">
              <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#94a3b8]" />
              {s}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#eef2ff] px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-[#4f46e5]">
          {brief.regime.label}
        </span>
        <span className="text-[0.72rem] text-[#94a3b8]">{brief.regime.rationale}</span>
      </div>
      <p className="mt-2.5 text-[1.05rem] font-bold leading-snug text-[#0f172a]">
        {brief.headline}
      </p>
      <div className="mt-3 space-y-2.5">
        {brief.narrative.map((p) => (
          <p key={p} className="text-[0.9rem] leading-relaxed text-[#334155]">{p}</p>
        ))}
      </div>
      {brief.watch.length > 0 && (
        <div className="mt-4 rounded-lg border border-[#eef1f6] bg-[#f8fafc] p-3.5">
          <div className="text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
            What to watch next
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {brief.watch.map((w) => (
              <li key={w} className="flex items-start gap-2 text-[0.84rem] leading-relaxed text-[#475569]">
                <span className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#4f46e5]" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="mt-3 border-t border-[#f1f5f9] pt-2.5">
        <summary className="cursor-pointer select-none text-[0.72rem] font-semibold text-[#9ca3af] hover:text-[#64748b]">
          By the numbers
        </summary>
        <ul className="mt-1.5 space-y-1 pl-1">
          {computed.map((s) => (
            <li key={s} className="flex items-start gap-2 text-[0.78rem] text-[#64748b]">
              <span className="mt-[0.4rem] h-1 w-1 shrink-0 rounded-full bg-[#cbd5e1]" />
              {s}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

/**
 * Market-closure awareness for the brief framing.
 *
 * The brief recaps the latest *session* (d.as_of), but the page can be opened on
 * a day the market never traded — a weekend or holiday — or outside RTH. Compute
 * the real ET status so the heading + a one-line note say "recap" (and why it's
 * closed) instead of presenting a stale session as if it were live. Pure
 * wall-clock + the session date; no data claim, costs nothing, and never
 * triggers an AI regen (the brief stays cached per data date).
 */
function marketStatus(asOf: string | null): {
  openNow: boolean
  title: string
  note: string | null
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const o: Record<string, string> = {}
  for (const p of fmt.formatToParts(new Date())) o[p.type] = p.value
  if (o.hour === '24') o.hour = '00'
  const weekend = o.weekday === 'Sat' || o.weekday === 'Sun'
  const minutes = Number(o.hour) * 60 + Number(o.minute)
  const openNow = !weekend && minutes >= 570 && minutes < 960 // 09:30–16:00 ET
  const todayET = `${o.year}-${o.month}-${o.day}`
  const sessionToday = asOf === todayET
  const session = asOf ? ` — ${fmtDate(asOf)}` : ''

  if (openNow) return { openNow, title: 'Market brief', note: null }
  if (weekend)
    return {
      openNow,
      title: 'Weekend recap',
      note: `Markets are closed for the weekend. This recaps the most recent session${session}.`,
    }
  if (sessionToday)
    return {
      openNow,
      title: "Today's session recap",
      note: `Regular trading is closed for the day. Recapping today's session${session}.`,
    }
  // weekday, market not open now, no session dated today: pre-open or a holiday.
  return {
    openNow,
    title: 'Latest session recap',
    note: `Markets are closed right now. Latest completed session${session}.`,
  }
}

export function MarketPage() {
  const qc = useQueryClient()
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['market', 'overview'],
    queryFn: getMarketOverview,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  // intraday market pulse (SPY rides in the quote set; ~15m delayed)
  const { data: quotesData } = useQuery({
    queryKey: ['quotes'],
    queryFn: getQuotes,
    staleTime: 5 * 60 * 1000,
  })

  // Auto-generate the day's AI brief ONCE when the tab is first opened and
  // today's isn't cached. One attempt per page mount (a null result = no
  // credits/key) so a dry balance never loops; success refetches the overview
  // so the cached brief renders.
  const briefMut = useMutation({
    mutationFn: generateMarketBrief,
    onSuccess: (res) => {
      if (res.ai_brief) void qc.invalidateQueries({ queryKey: ['market', 'overview'] })
    },
  })
  const attempted = useRef(false)
  const aiBrief = data?.ai_brief ?? null
  useEffect(() => {
    if (data && !aiBrief && !attempted.current) {
      attempted.current = true
      briefMut.mutate()
    }
  }, [data, aiBrief, briefMut])

  if (isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-[150px] w-full rounded-card" />
        <div className="text-center text-xs text-[#9ca3af]">
          Computing market internals across ~5,500 stocks — first load after a
          server start can take half a minute…
        </div>
        <Skeleton className="h-[360px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  const d: MarketOverviewResponse = data
  const spyLive = quotesData?.quotes?.SPY
  const b = d.breadth
  const mkt = marketStatus(d.as_of)

  return (
    <div className="space-y-5">
      {/* header */}
      <header className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
        <div className="h-1 bg-gradient-to-r from-[#2563eb] via-[#4f46e5] to-[#0ea5e9]" />
        <div className="px-7 pb-5 pt-6">
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
            <span className="text-[#4f46e5]">StockBud</span>
            <span className="text-[#d1d5db]">/</span>
            <span className="text-[#94a3b8]">Market</span>
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-[#0f172a]">
              Market overview
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-[0.86rem]">
              {spyLive?.price != null && (
                <span>
                  <span className="font-semibold text-[#64748b]">SPY now </span>
                  <span className="font-extrabold tabular-nums text-[#0f172a]">
                    ${spyLive.price.toFixed(2)}
                  </span>{' '}
                  <span
                    className="font-bold tabular-nums"
                    style={{ color: plColor(spyLive.change_pct) }}
                  >
                    {spyLive.change_pct == null
                      ? ''
                      : `${spyLive.change_pct > 0 ? '+' : ''}${spyLive.change_pct.toFixed(2)}%`}
                  </span>
                  <span className="ml-1 text-[0.7rem] text-[#cbd5e1]">~15m delay</span>
                </span>
              )}
              <span>
                <span className="font-semibold text-[#64748b]">Last session </span>
                <span className="font-bold tabular-nums" style={{ color: plColor(d.market.spy_r1d) }}>
                  SPY {fmtSignedPct(d.market.spy_r1d)}
                </span>
                <span className="mx-1 text-[#d1d5db]">·</span>
                <span className="font-bold tabular-nums" style={{ color: plColor(d.market.universe_ew_r1d) }}>
                  avg stock {fmtSignedPct(d.market.universe_ew_r1d)}
                </span>
              </span>
            </div>
          </div>
          <p className="mt-1.5 text-[0.8rem] text-[#94a3b8]">
            Internals computed across the full {b.n.toLocaleString()}-name active universe
          </p>
        </div>
        <div className="border-t border-[#f1f5f9] px-7 py-3">
          <RegimeStrip d={d} />
        </div>
        <div className="border-t border-[#f1f5f9] px-7 py-2">
          <FreshnessRow d={d} />
        </div>
      </header>

      {/* session brief (AI narrative, generated once/day; computed fallback).
          Title + note adapt to whether the market is open, closed for the
          weekend, or between sessions, so a recap never reads as live. */}
      <SectionCard
        title={mkt.title}
        hint={
          aiBrief
            ? 'AI-written once per day from the numbers on this page (Haiku) — grounded only in this data, not advice.'
            : 'Assembled from the numbers on this page. The AI narrative writes once when you open the tab.'
        }
      >
        {mkt.note && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[0.78rem] font-medium text-slate-600">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            {mkt.note}
          </div>
        )}
        <AiBrief brief={aiBrief} computed={d.brief} generating={briefMut.isPending} />
      </SectionCard>

      {/* sectors */}
      <SectionCard
        title="Sector performance"
        hint="Equal-weight average return of every active name in the sector — what the typical stock did, not just the mega-caps."
      >
        <SectorTable sectors={d.sectors} />
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* internals */}
        <SectionCard
          title="Market internals"
          hint="Breadth and trend health across all names — rallies on narrow breadth are fragile."
        >
          <div className="space-y-4">
            <BreadthBar
              label="Advancers (last session)"
              pct={b.advancers / Math.max(b.advancers + b.decliners, 1)}
              detail={`${b.advancers.toLocaleString()} up · ${b.decliners.toLocaleString()} down`}
            />
            <BreadthBar label="Above 50-day average" pct={b.pct_above_ma50} />
            <BreadthBar label="Above 200-day average" pct={b.pct_above_ma200} />
            <div className="flex gap-6 border-t border-[#f1f5f9] pt-3 text-[0.84rem]">
              <span>
                <span className="font-extrabold tabular-nums text-[#059669]">{b.new_highs}</span>{' '}
                <span className="text-[#64748b]">new 52-week highs</span>
              </span>
              <span>
                <span className="font-extrabold tabular-nums text-[#dc2626]">{b.new_lows}</span>{' '}
                <span className="text-[#64748b]">new 52-week lows</span>
              </span>
            </div>
          </div>
        </SectionCard>

        {/* macro */}
        <SectionCard
          title="Macro dashboard"
          hint="Rates, volatility and inflation context — 90-day trend in each sparkline."
        >
          <div className="grid grid-cols-2 gap-3">
            {d.macro.cards.map((c) => (
              <MacroCardBox key={c.id} card={c} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[0.8rem] text-[#64748b]">
            {d.macro.curve_bps != null && (
              <span>
                2s10s curve{' '}
                <strong className="tabular-nums text-[#1e293b]">
                  {d.macro.curve_bps > 0 ? '+' : ''}{d.macro.curve_bps.toFixed(0)}bps
                </strong>
                {d.macro.curve_bps < 0 && ' (inverted)'}
              </span>
            )}
            {d.macro.cpi_yoy != null && (
              <span>
                CPI <strong className="tabular-nums text-[#1e293b]">{fmtSignedPct(d.macro.cpi_yoy)}</strong>{' '}
                YoY {d.macro.cpi_as_of && `(as of ${fmtDate(d.macro.cpi_as_of)})`}
              </span>
            )}
          </div>
        </SectionCard>
      </div>

      {/* movers */}
      <SectionCard
        title="Biggest movers — last session"
        hint="Names above $250M market cap only (micro-cap noise excluded). Click through for the full deep-dive."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <MoverList movers={d.movers.gainers} title="Gainers" />
          <MoverList movers={d.movers.losers} title="Losers" />
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* 8-K stream */}
        <div className="lg:col-span-3">
          <SectionCard
            title="Company news from the source — high-signal 8-Ks"
            hint="Material-event filings across all ~5,500 companies in the last few days: M&A, executive changes, results, delistings. The primary documents the headlines get written from."
          >
            <div className="max-h-[460px] space-y-3 overflow-auto pr-1">
              {d.filings.length === 0 && (
                <p className="text-sm text-[#9ca3af]">No high-signal filings in the window.</p>
              )}
              {d.filings.map((f) => (
                <div key={f.accession_no + f.security_id} className="flex items-start gap-3">
                  <div className="w-[4.2rem] shrink-0 pt-0.5 text-[0.7rem] tabular-nums text-[#94a3b8]">
                    {fmtDate(f.filed_date).replace(', 2026', '')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {f.ticker && (
                        <Link
                          to={`/securities/${f.ticker}`}
                          className="font-bold text-[#1e293b] hover:text-[#4f46e5]"
                        >
                          {f.ticker}
                        </Link>
                      )}
                      <span className="truncate text-[0.76rem] text-[#94a3b8]">
                        {f.name} {f.market_cap ? `· ${fmtMoney(f.market_cap)}` : ''}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {f.labels.slice(0, 3).map((l) => (
                        <span
                          key={l}
                          className="rounded-full bg-[#eef2ff] px-2 py-0.5 text-[0.68rem] font-semibold text-[#4f46e5]"
                        >
                          {l}
                        </span>
                      ))}
                      {f.primary_doc_url && (
                        <a
                          href={f.primary_doc_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full bg-[#f8fafc] px-2 py-0.5 text-[0.68rem] font-semibold text-[#94a3b8] hover:text-[#4f46e5]"
                        >
                          SEC filing ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* insider pulse */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Insider buying pulse"
            hint="Largest open-market insider purchases filed in the last 7 days (Form 4, code P). Context only."
          >
            <div className="space-y-2.5">
              {d.insider_buys.length === 0 && (
                <p className="text-sm text-[#9ca3af]">No open-market buys filed this week.</p>
              )}
              {d.insider_buys.map((i) => (
                <div key={i.security_id} className="flex items-center gap-2.5 text-[0.84rem]">
                  <Link
                    to={`/securities/${i.ticker}`}
                    className="w-16 shrink-0 font-bold text-[#1e293b] hover:text-[#4f46e5]"
                  >
                    {i.ticker}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-[0.76rem] text-[#94a3b8]">
                    {i.buyers} buyer{i.buyers !== 1 ? 's' : ''} · filed {fmtDate(i.last_filed).replace(', 2026', '')}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-[#059669]">
                    {fmtMoney(i.total_value)}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* headlines */}
      <SectionCard
        title="Headlines"
        hint="Top stories from public feeds (CNBC, MarketWatch, Yahoo Finance) — refreshed ~15 min."
      >
        <div className="space-y-2.5">
          {d.headlines.length === 0 && (
            <p className="text-sm text-[#9ca3af]">
              Feeds unreachable right now — the rest of the page is unaffected.
            </p>
          )}
          {d.headlines.map((h) => (
            <a
              key={h.url}
              href={h.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-baseline gap-3 no-underline"
            >
              <span className="w-24 shrink-0 text-[0.7rem] font-semibold uppercase tracking-wide text-[#94a3b8]">
                {h.source}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.88rem] font-medium text-[#334155] group-hover:text-[#4f46e5]">
                {h.title}
              </span>
              <span className="shrink-0 text-[0.7rem] text-[#cbd5e1]">
                {timeAgo(h.published_epoch)}
              </span>
            </a>
          ))}
        </div>
      </SectionCard>

      <p className="pb-2 text-center text-xs text-[#9ca3af]">
        Whole-market context from nightly data, SEC filings and public feeds —
        not investment advice. Server-cached ~10 min.
      </p>
    </div>
  )
}
