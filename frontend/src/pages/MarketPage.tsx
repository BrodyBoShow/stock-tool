import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import { ErrorCard } from '@/components/ErrorCard'
import { AnomaliesFeed } from '@/components/market/AnomaliesFeed'
import { BreadthCalendar } from '@/components/market/BreadthCalendar'
import {
  EnhancedFilings,
  EnhancedHeadlines,
  EnhancedInsider,
  EnhancedMovers,
} from '@/components/market/enhanced'
import { FactorCompass } from '@/components/market/FactorCompass'
import { MarketSubHeader } from '@/components/market/MarketSubHeader'
import {
  AiBrief,
  FactorOfDay,
  FreshnessRow,
  MacroCardBox,
  RegimeHero,
  RegimeStrip,
  SessionSnapshot,
} from '@/components/market/sections'
import { SectorTreemap } from '@/components/market/SectorTreemap'
import { BreadthBar, FilingFreshness, Provenance } from '@/components/market/shared'
import { G, marketStatus, maxIsoDate } from '@/components/market/utils'
import { InfoTip } from '@/components/ui/InfoTip'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useWatchlistSet } from '@/hooks/useWatchlist'
import { generateMarketBrief, getMarketOverview, getQuotes } from '@/lib/api'
import { fmtDate, fmtSignedPct } from '@/lib/format'
import type { MarketOverviewResponse } from '@/types/api'

/** Small uppercase eyebrow that introduces each information tier. */
function TierLabel({ n, title }: { n: 1 | 2 | 3; title: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-slate-500">
        <span className="text-indigo-600">Tier {n}</span>
        <span className="text-slate-300" aria-hidden>·</span>
        {title}
      </span>
      <span className="h-px flex-1 bg-slate-100" />
    </div>
  )
}

/** Smooth-scroll to an element id, accounting for the sticky sub-header. */
function scrollToTier(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function MarketPage() {
  const qc = useQueryClient()
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['market', 'overview'], queryFn: getMarketOverview, staleTime: 5 * 60 * 1000, retry: 1,
  })
  const { data: quotesData } = useQuery({ queryKey: ['quotes'], queryFn: getQuotes, staleTime: 5 * 60 * 1000 })
  const { tickers: watchlist } = useWatchlistSet()

  const briefMut = useMutation({
    mutationFn: generateMarketBrief,
    onSuccess: (res) => { if (res.ai_brief) void qc.invalidateQueries({ queryKey: ['market', 'overview'] }) },
  })
  const attempted = useRef(false)
  const aiBrief = data?.ai_brief ?? null
  useEffect(() => {
    if (data && !aiBrief && !attempted.current) { attempted.current = true; briefMut.mutate() }
  }, [data, aiBrief, briefMut])

  // Tickers already on the page — the safe universe for headline ticker-tagging
  // (avoids matching arbitrary uppercase words). Recomputed only when data changes.
  const knownTickers = useMemo(() => {
    const set = new Set<string>()
    if (!data) return set
    for (const m of [...data.movers.gainers, ...data.movers.losers]) if (m.ticker) set.add(m.ticker.toUpperCase())
    for (const f of data.filings) if (f.ticker) set.add(f.ticker.toUpperCase())
    for (const i of data.insider_buys) if (i.ticker) set.add(i.ticker.toUpperCase())
    for (const t of watchlist) set.add(t.toUpperCase())
    return set
  }, [data, watchlist])

  // Keyboard shortcuts: 1/2/3 jump to a tier, r refetches. Guarded against form
  // fields and modifier chords. The effect only wires the listener — the handler
  // does the scroll/refetch, so no setState runs in the effect body.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      if (e.key === '1') scrollToTier('tier-1')
      else if (e.key === '2') scrollToTier('tier-2')
      else if (e.key === '3') scrollToTier('tier-3')
      else if (e.key === 'r' || e.key === 'R') void refetch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refetch])

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
      <MarketSubHeader d={d} onRefresh={() => void refetch()} />

      {/* ── TIER 1 · THE 2-SECOND READ ─────────────────────────────────────── */}
      <TierLabel n={1} title="The 2-second read" />
      <div id="tier-1" className="scroll-mt-24 space-y-5">
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
      </div>

      {/* ── TIER 2 · THE 20-SECOND SCAN ────────────────────────────────────── */}
      <TierLabel n={2} title="The 20-second scan" />
      <div id="tier-2" className="scroll-mt-24 space-y-5">
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
        <SectorTreemap sectors={d.sectors} />
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
              detail={`${b.advancers.toLocaleString()} up · ${b.decliners.toLocaleString()} down${
                b.adv_pct_pctl != null ? ` · ${b.adv_pct_pctl}th pctl of 90d` : ''
              }`} />
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
            {b.calendar && b.calendar.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <BreadthCalendar calendar={b.calendar} pctl={b.adv_pct_pctl} />
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

      {d.factor_day && d.factor_day.length > 0 && (
        <SectionCard title="What worked today — by factor" tip={G.factorDay}
          hint="Which style the market rewarded, from the factor scores that drive the screener.">
          <FactorOfDay factors={d.factor_day} />
          <div className="mt-4 border-t border-slate-100 pt-4">
            <FactorCompass factors={d.factor_day} />
          </div>
        </SectionCard>
      )}
      </div>

      {/* ── TIER 3 · THE 5-MINUTE DRILL-DOWN ───────────────────────────────── */}
      <TierLabel n={3} title="The 5-minute drill-down" />
      <div id="tier-3" className="scroll-mt-24 space-y-5">
      <SectionCard title="Market anomalies"
        hint="Auto-detected unusual patterns in this session's data — the high-signal exceptions worth a look. Context, not advice.">
        <AnomaliesFeed anomalies={d.anomalies ?? []} />
      </SectionCard>

      <SectionCard title={`Biggest movers — ${fmtDate(d.as_of)} session`}
        hint="Names above $250M market cap only (micro-cap noise excluded). Click through for the full deep-dive.">
        <EnhancedMovers gainers={d.movers.gainers} losers={d.movers.losers} />
      </SectionCard>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-5">
        <div className="md:col-span-2 lg:col-span-3">
          <SectionCard
            title="Company news from the source — high-signal 8-Ks"
            hint="Material-event filings across all ~5,500 companies in the last few days: M&A, executive changes, results, delistings."
            right={<FilingFreshness date={maxIsoDate(d.filings.map((f) => f.filed_date))} />}
          >
            <EnhancedFilings filings={d.filings} watchlist={watchlist} />
          </SectionCard>
        </div>
        <div className="md:col-span-2 lg:col-span-2">
          <SectionCard title="Insider buying pulse"
            hint="Largest open-market insider purchases filed in the last 7 days (Form 4, code P). Context only."
            right={<FilingFreshness date={maxIsoDate(d.insider_buys.map((i) => i.last_filed))} />}>
            <EnhancedInsider buys={d.insider_buys} />
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Headlines" hint="Top stories from public feeds (CNBC, MarketWatch, Yahoo Finance) — refreshed ~15 min.">
        <EnhancedHeadlines headlines={d.headlines} knownTickers={knownTickers} watchlist={watchlist} />
      </SectionCard>
      </div>

      <p className="pb-2 text-center text-xs text-gray-400">
        Whole-market context from nightly data, SEC filings and public feeds — not investment advice.
      </p>
    </div>
  )
}
