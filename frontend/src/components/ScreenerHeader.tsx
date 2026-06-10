import { useEffect, useMemo, useState } from 'react'

import { fmtDate } from '@/lib/format'
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

/** Whole days between the ET calendar date and score_date (YYYY-MM-DD). */
function staleDaysET(scoreDate: string, now: Date): number {
  const p = etParts(now)
  const todayUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))
  const [y, m, d] = scoreDate.split('-').map(Number)
  const scoreUtc = Date.UTC(y, m - 1, d)
  return Math.round((todayUtc - scoreUtc) / 86_400_000)
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
      <span className="text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
        {label}
      </span>
      <span
        className="mt-0.5 text-[1.15rem] font-bold tabular-nums leading-tight"
        style={{ color: accent ?? '#1e293b' }}
      >
        {value}
      </span>
      {hint && <span className="mt-0.5 text-[0.65rem] text-[#cbd5e1]">{hint}</span>}
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
  scoreDate,
  rows,
}: {
  scoreDate: string | null
  rows: ScreenerRow[]
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

  const staleDays = scoreDate ? staleDaysET(scoreDate, now) : null
  const fresh = staleDays === null || staleDays <= 3

  const { adv, dec } = useMemo(() => {
    let a = 0
    let d = 0
    for (const r of rows) {
      if (r.last_price !== null && r.prev_close !== null) {
        if (r.last_price > r.prev_close) a += 1
        else if (r.last_price < r.prev_close) d += 1
      }
    }
    return { adv: a, dec: d }
  }, [rows])
  const ratio = dec > 0 ? (adv / dec).toFixed(2) : '—'

  return (
    <header className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
      {/* brand accent strip */}
      <div className="h-1 bg-gradient-to-r from-[#2563eb] via-[#4f46e5] to-[#0ea5e9]" />

      <div
        className="px-7 pb-5 pt-6"
        style={{ background: 'linear-gradient(180deg, #fbfcfe 0%, #ffffff 62%)' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          {/* identity */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
              <span className="text-[#4f46e5]">StockBud</span>
              <span className="text-[#d1d5db]">/</span>
              <span className="text-[#94a3b8]">Equity Screener</span>
            </div>
            <h1 className="mt-2 text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-[#0f172a]">
              S&amp;P 500 Factor Screener
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.9rem] text-[#64748b]">
              <span>
                Nightly percentile rankings across {rows.length} companies
              </span>
              {fresh ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[0.72rem] font-semibold text-emerald-700">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                    style={{ animation: 'ckpulse 2s ease-in-out infinite' }}
                  />
                  Updated {fmtDate(scoreDate)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[0.72rem] font-semibold text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Stale · {fmtDate(scoreDate)}
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
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-slate-50 text-slate-500')
              }
            >
              <span
                className={
                  'h-2 w-2 rounded-full ' +
                  (open ? 'bg-emerald-500' : 'bg-slate-400')
                }
              />
              {open ? 'Markets open' : 'Markets closed'}
            </span>
            <div className="text-right">
              <div className="font-mono text-[1.1rem] font-semibold tabular-nums text-[#334155]">
                {clock}
              </div>
              <div className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-[#94a3b8]">
                New York · ET
              </div>
            </div>
          </div>
        </div>

        {/* divider */}
        <div className="my-4 h-px bg-[#eef1f6]" />

        {/* market breadth — nightly, presented as dashboard KPIs */}
        <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
          <Stat label="Advancing" value={adv} accent="#059669" hint="vs prior close" />
          <Stat label="Declining" value={dec} accent="#dc2626" hint="vs prior close" />
          <Stat label="Adv / Dec" value={ratio} hint="breadth ratio" />
          <Stat label="Volatility · VIX" value="—" hint="macro feed pending" />
          <Stat label="Index" value="S&P 500" hint="active universe" />
        </div>
      </div>
    </header>
  )
}
