import { useEffect, useMemo, useState } from 'react'

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

const CELL = 'px-[13px] whitespace-nowrap leading-normal border-r border-[#1d2430]'
const K = 'text-[#6b7280] font-bold tracking-[0.05em]'

/**
 * Bloomberg-ish terminal header.
 *
 * Honesty notes (carried from the Streamlit reference): the badge says
 * NIGHTLY/STALE — never "LIVE", the pipeline is a nightly batch. The clock
 * and OPEN/CLOSED are real wall-clock ET (pure time, not a data claim).
 * ADV/DEC come from our own nightly close-vs-prior-close, not an index feed.
 * VIX shows n/a — the API does not expose a macro endpoint yet.
 */
export function TerminalHeader({
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
  const clock = `${p.year}-${p.month}-${p.day}  ${p.hour}:${p.minute}:${p.second}`
  const mins = Number(p.hour) * 60 + Number(p.minute)
  const weekday = p.weekday !== 'Sat' && p.weekday !== 'Sun'
  const open = weekday && mins >= 570 && mins < 960 // 09:30–16:00 ET regular session

  const staleDays = scoreDate ? staleDaysET(scoreDate, now) : null
  const fresh = staleDays === null || staleDays <= 3
  const badgeTxt = fresh ? 'NIGHTLY' : `STALE ${staleDays}D`

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
    <header
      className="rounded-[13px] border-b-2 border-[#2a9d8f] px-5 pb-[13px] pt-[15px] font-mono text-[#e5e7eb] shadow-[0_6px_22px_rgba(8,11,18,0.22)]"
      style={{
        background:
          'radial-gradient(120% 140% at 0% 0%, #151a23 0%, #0f1117 55%)',
        backgroundColor: '#0f1117',
      }}
    >
      <div className="flex items-end justify-between gap-4">
        <div className="text-[10px] font-bold tracking-[0.3em] text-[#6b7280]">
          EQUITY SCREENER
        </div>
        <div className="text-right text-[10px] font-bold tracking-[0.22em] text-[#6b7280]">
          NYSE · ET
        </div>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="mt-[3px] text-[22px] font-extrabold tracking-[0.01em] text-[#f8fafc]">
          S&amp;P 500 FACTOR SCREENER
          <span
            className={
              'relative -top-[3px] ml-3 inline-flex items-center gap-1.5 rounded-[5px] border px-2 py-0.5 align-middle text-[10px] font-bold tracking-[0.14em] ' +
              (fresh
                ? 'border-[rgba(34,197,94,0.32)] bg-[rgba(34,197,94,0.12)] text-[#22c55e]'
                : 'border-[rgba(245,158,11,0.32)] bg-[rgba(245,158,11,0.13)] text-[#f59e0b]')
            }
          >
            <span
              className="h-[7px] w-[7px] rounded-full bg-current"
              style={fresh ? { animation: 'ckpulse 1.6s ease-in-out infinite' } : undefined}
            />
            {badgeTxt}
          </span>
        </div>
        <div className="text-right text-[19px] font-semibold tracking-[0.02em] text-[#cbd5e1] tabular-nums">
          {clock}
        </div>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="mt-[11px] flex gap-5">
          <span className="border-b-2 border-[#2a9d8f] pb-[7px] text-xs font-bold tracking-[0.09em] text-[#f8fafc]">
            S&amp;P 500
          </span>
        </div>
        <span
          className={
            'rounded-[5px] border px-[9px] py-0.5 text-[10px] font-bold tracking-[0.16em] ' +
            (open
              ? 'border-[rgba(34,197,94,0.32)] bg-[rgba(34,197,94,0.12)] text-[#22c55e]'
              : 'border-[rgba(148,163,184,0.26)] bg-[rgba(148,163,184,0.1)] text-[#94a3b8]')
          }
        >
          ● {open ? 'OPEN' : 'CLOSED'}
        </span>
      </div>

      <div
        className="my-[9px] mt-2.5 h-px"
        style={{
          background: 'linear-gradient(90deg, rgba(42,157,143,0.45), transparent)',
        }}
      />

      <div className="flex flex-wrap items-center text-xs">
        <span className={`${CELL} pl-0`}>
          <span className={K}>VIX</span> <span className="text-[#94a3b8]">n/a</span>
        </span>
        <span className={CELL}>
          <span className={K}>ADV</span>{' '}
          <span className="font-bold text-[#22c55e]">{adv}</span>
        </span>
        <span className={CELL}>
          <span className={K}>DEC</span>{' '}
          <span className="font-bold text-[#ef4444]">{dec}</span>
        </span>
        <span className={CELL}>
          <span className={K}>A/D</span>{' '}
          <span className="font-bold text-[#e5e7eb]">{ratio}</span>
        </span>
        <span className={CELL}>
          <span className={K}>NAMES</span>{' '}
          <span className="font-bold text-[#e5e7eb]">{rows.length}</span>
        </span>
        <span className={`${CELL} border-r-0`}>
          <span className={K}>SCORES</span>{' '}
          <span className="text-[#94a3b8]">{scoreDate ?? 'n/a'}</span>
        </span>
      </div>
    </header>
  )
}
