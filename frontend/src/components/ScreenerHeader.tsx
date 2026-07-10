import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { getMacroLatest } from '@/lib/api'
import { fmtShortDate } from '@/lib/format'
import type { ScreenerRow } from '@/types/api'

/** ET wall-clock parts via Intl — never the user's local zone. */
function etParts(now: Date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const o: Record<string, string> = {}
  for (const p of fmt.formatToParts(now)) o[p.type] = p.value
  if (o.hour === '24') o.hour = '00'
  return o
}


function Stat({
  label,
  value,
  accent,
  hint,
}: {
  label: string
  value: React.ReactNode
  accent?: string
  hint?: string
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-subtle">
        {label}
      </span>
      <span
        className="mt-0.5 text-[1.15rem] font-bold tabular-nums leading-tight"
        style={{ color: accent ?? 'var(--ink)' }}
      >
        {value}
      </span>
      {hint && <span className="mt-0.5 text-[0.65rem] text-subtle">{hint}</span>}
    </div>
  )
}

/**
 * Screener hero — a clean dashboard header (not a terminal readout).
 *
 * Honesty notes carried from the original: the freshness badge says
 * "Updated <date>" / "Stale" — the pipeline is a nightly batch, never live.
 * The clock and market status are real wall-clock ET (pure time, not a data
 * claim). Advancing/Declining come from our own nightly close-vs-prior-close,
 * not an index feed. VIX shows "—" — the API exposes no macro endpoint yet.
 */
export function ScreenerHeader({
  rows,
  quotesAsOfEpoch,
}: {
  rows: ScreenerRow[]
  quotesAsOfEpoch?: number | null
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const p = etParts(now)
  const hour24 = Number(p.hour)
  const ampm = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = ((hour24 + 11) % 12) + 1
  const clock = `${hour12}:${p.minute}:${p.second} ${ampm}`
  const mins = hour24 * 60 + Number(p.minute)
  const weekday = p.weekday !== 'Sat' && p.weekday !== 'Sun'
  const open = weekday && mins >= 570 && mins < 960 // 09:30–16:00 ET regular session

  // ET calendar date for display under the clock
  const etDateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(now)

  // Live-price stamp (intraday overlay). Prices are ~15-min delayed (free
  // yfinance); scores remain end-of-day. Show the quote date + time in ET.
  let liveStamp: string | null = null
  let liveDate: string | null = null
  if (quotesAsOfEpoch != null) {
    const d = new Date(quotesAsOfEpoch * 1000)
    const q = etParts(d)
    const h24 = Number(q.hour)
    const h12 = ((h24 + 11) % 12) + 1
    liveStamp = `${h12}:${q.minute} ${h24 >= 12 ? 'PM' : 'AM'}`
    liveDate = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
    }).format(d)
  }
  const liveNow = Boolean(liveStamp && open) // only call it "live" while open

  // VIX from FRED (/macro/latest). Market convention: rising VIX = fear = red,
  // falling = calm = green — that's the one place a macro delta is colored.
  const { data: macro } = useQuery({
    queryKey: ['macro', 'latest'],
    queryFn: getMacroLatest,
    staleTime: 6 * 60 * 60 * 1000,
  })
  const vixObs = macro?.series.find((s) => s.series_id === 'VIXCLS')?.observations ?? []
  const vixLatest = vixObs[0]?.value ?? null
  const vixPrior = vixObs[1]?.value ?? null
  const vixChg = vixLatest != null && vixPrior != null ? vixLatest - vixPrior : null

  let vixValue: React.ReactNode = '—'
  let vixHint = 'macro feed pending'
  if (vixLatest != null) {
    vixHint = vixObs[1] ? `vs ${fmtShortDate(vixObs[1].date)}` : 'latest close'
    if (vixChg != null && vixChg !== 0) {
      const color = vixChg > 0 ? 'var(--neg)' : 'var(--pos)'
      const arrow = vixChg > 0 ? '▲' : '▼'
      vixValue = (
        <>
          {vixLatest.toFixed(2)}{' '}
          <span className="text-[0.82rem] font-bold" style={{ color }}>
            {arrow}
            {Math.abs(vixChg).toFixed(2)}
          </span>
        </>
      )
    } else {
      vixValue = vixLatest.toFixed(2)
    }
  }

  const { adv, dec, unch } = useMemo(() => {
    let a = 0
    let d = 0
    let u = 0
    for (const r of rows) {
      if (r.last_price !== null && r.prev_close !== null) {
        if (r.last_price > r.prev_close) a += 1
        else if (r.last_price < r.prev_close) d += 1
        else u += 1
      }
    }
    return { adv: a, dec: d, unch: u }
  }, [rows])
  const ratioNum = dec > 0 ? adv / dec : null
  const ratio = ratioNum != null ? ratioNum.toFixed(2) : '—'
  const priced = adv + dec + unch
  const advPct = priced > 0 ? (adv / priced) * 100 : 0
  const decPct = priced > 0 ? (dec / priced) * 100 : 0
  const unchPct = Math.max(0, 100 - advPct - decPct)

  // Market Pulse — a single contextual read replacing five equal-weight KPIs.
  // Breadth (our own nightly close-vs-prior) + VIX regime → one direction word.
  // Thresholds are conventional market heuristics, not a tuned signal; the raw
  // numbers stay visible beside it so the interpretation is never a black box.
  const pulse: { label: string; cls: string; dot: string; why: string } =
    ratioNum != null && ratioNum > 1.5 && vixLatest != null && vixLatest < 18
      ? {
          label: 'Bullish',
          cls: 'border-pos-border bg-pos-soft text-pos',
          dot: 'bg-pos-strong',
          why: 'Broad advance (Adv/Dec > 1.5) with calm volatility (VIX < 18).',
        }
      : (ratioNum != null && ratioNum < 0.7) || (vixLatest != null && vixLatest > 25)
        ? {
            label: 'Bearish',
            cls: 'border-neg-border bg-neg-soft text-neg',
            dot: 'bg-neg-strong',
            why: 'Broad decline (Adv/Dec < 0.7) or elevated fear (VIX > 25).',
          }
        : {
            label: 'Neutral',
            cls: 'border-warn bg-warn-soft text-warn',
            dot: 'bg-warn-strong',
            why: 'Mixed breadth and moderate volatility — no clear regime.',
          }

  return (
    <header className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
      {/* brand accent strip */}
      <div className="h-1 bg-gradient-to-r from-[var(--accent)] to-transparent" />

      <div
        className="px-7 pb-5 pt-6"
        style={{ background: 'linear-gradient(180deg, var(--surface-2) 0%, var(--surface) 62%)' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          {/* identity */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
              <span className="text-accent">StockBud</span>
              <span className="text-subtle">/</span>
              <span className="text-subtle">Equity Screener</span>
            </div>
            <h1 className="mt-2 text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-ink">
              US Equity Factor Screener
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.9rem] text-muted">
              <span>
                Factor rankings across {rows.length} companies
              </span>
              {liveNow && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-info bg-info-soft px-2.5 py-0.5 text-[0.72rem] font-semibold text-info"
                  title="Prices are ~15-min delayed. Factor scores are official nightly closes."
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-info"
                    style={{ animation: 'ckpulse 2s ease-in-out infinite' }}
                  />
                  Live prices · {liveDate}, {liveStamp} ET
                </span>
              )}
            </div>
          </div>

          {/* market status + clock */}
          <div className="flex flex-col items-end gap-2.5">
            <span
              className={
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[0.78rem] font-semibold ' +
                (open
                  ? 'border-pos-border bg-pos-soft text-pos'
                  : 'border-line bg-surface-2 text-muted')
              }
            >
              <span
                className={
                  'h-2 w-2 rounded-full ' +
                  (open ? 'bg-pos-strong' : 'bg-slate-400')
                }
              />
              {open ? 'Markets open' : 'Markets closed'}
            </span>
            <div className="text-right">
              <div className="font-mono text-[1.1rem] font-semibold tabular-nums text-ink">
                {clock}
              </div>
              <div className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-subtle">
                {etDateLabel} · New York · ET
              </div>
            </div>
          </div>
        </div>

        {/* divider */}
        <div className="my-4 h-px bg-divider" />

        {/* market pulse — one contextual read, with the raw breadth beside it */}
        <div className="flex flex-wrap items-center gap-x-9 gap-y-3">
          <div
            className={
              'inline-flex items-center gap-2.5 rounded-full border px-4 py-1.5 ' +
              pulse.cls
            }
            title={pulse.why}
          >
            <span
              className={'h-2 w-2 rounded-full ' + pulse.dot}
              style={{ animation: 'ckpulse 2s ease-in-out infinite' }}
            />
            <span className="text-[0.66rem] font-bold uppercase tracking-[0.12em] opacity-70">
              Market Pulse
            </span>
            <span className="text-[1.02rem] font-extrabold leading-none">{pulse.label}</span>
          </div>
          <Stat label="Advancing" value={adv} accent="var(--pos)" hint="vs prior close" />
          <Stat label="Declining" value={dec} accent="var(--neg)" hint="vs prior close" />
          <Stat label="Adv / Dec" value={ratio} hint="breadth ratio" />
          <Stat label="Volatility · VIX" value={vixValue} hint={vixHint} />

          {/* market breadth bar — fills the row's right side with the adv/dec
              split visualized (green up · neutral flat · red down). */}
          {priced > 0 && (
            <div className="ml-auto flex min-w-[220px] max-w-[460px] flex-1 flex-col gap-1.5">
              <div className="flex items-center justify-between text-[0.62rem] font-semibold uppercase tracking-[0.07em]">
                <span className="text-pos">{advPct.toFixed(0)}% up</span>
                <span className="text-subtle">
                  Market breadth · {priced.toLocaleString()} priced
                </span>
                <span className="text-neg">{decPct.toFixed(0)}% down</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full ring-1 ring-inset ring-line">
                <div
                  className="bg-pos-strong"
                  style={{ width: `${advPct}%` }}
                  title={`${adv.toLocaleString()} advancing`}
                />
                <div
                  className="bg-surface-3"
                  style={{ width: `${unchPct}%` }}
                  title={`${unch.toLocaleString()} unchanged`}
                />
                <div
                  className="bg-neg-strong"
                  style={{ width: `${decPct}%` }}
                  title={`${dec.toLocaleString()} declining`}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
