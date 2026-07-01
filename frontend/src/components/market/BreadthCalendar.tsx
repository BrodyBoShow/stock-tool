import { InfoTip } from '@/components/ui/InfoTip'

// 5-tier breadth color, centered on ~50% (a coin-flip day is neutral slate).
// Broad rally → green, broad sell-off → red; this is the regime signal.
function cellColor(p: number): string {
  if (p >= 0.6) return '#15803d'
  if (p >= 0.54) return '#86efac'
  if (p >= 0.46) return '#e2e8f0'
  if (p >= 0.4) return '#fca5a5'
  return '#b91c1c'
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/**
 * 90-day breadth regime calendar — one cell per trading day, colored by that
 * day's advancer %. Green stretches = broad rallies, red = broad sell-offs,
 * slate = mixed. Instantly shows regime shifts a single-day number can't.
 * Descriptive market context, never advice.
 */
export function BreadthCalendar({
  calendar,
  pctl,
}: {
  calendar: { date: string; adv_pct: number }[]
  pctl?: number
}) {
  if (calendar.length < 10) return null

  // Lay the (already weekday-only, chronological) series into week columns:
  // start a new column whenever the weekday doesn't advance. A plain for-loop
  // (not a captured closure) keeps the React-compiler happy about the counter.
  const placed: { date: string; adv_pct: number; dow: number; week: number }[] = []
  let weeks = 1
  for (let i = 0; i < calendar.length; i += 1) {
    const c = calendar[i]
    const dow = (new Date(`${c.date}T00:00:00Z`).getUTCDay() + 6) % 7 // Mon=0 … Sun=6
    if (i > 0 && dow <= placed[i - 1].dow) weeks += 1
    placed.push({ date: c.date, adv_pct: c.adv_pct, dow, week: weeks - 1 })
  }
  const byCell = new Map<string, { date: string; adv_pct: number }>()
  for (const c of placed) byCell.set(`${c.week}:${c.dow}`, c)
  const todayKey = placed.length ? `${placed[placed.length - 1].week}:${placed[placed.length - 1].dow}` : ''

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-slate-400">
          90-day breadth regime
          <InfoTip text="Each square is one trading day, colored by the share of stocks that rose that day. Green = broad rally, red = broad sell-off, slate = mixed (~50%). Shows regime shifts over ~18 weeks. Context, not advice." />
        </span>
        {pctl != null && (
          <span className="text-[0.7rem] text-slate-500">
            today{' '}
            <span className="font-bold tabular-nums text-slate-700">{pctl}th pctl</span>{' '}
            of 90d
          </span>
        )}
      </div>
      <div className="flex gap-1.5">
        <div className="flex flex-col justify-between py-[1px] text-[0.56rem] text-slate-300">
          {WEEKDAYS.map((w) => (
            <span key={w} className="leading-none">{w}</span>
          ))}
        </div>
        <div className="grid flex-1 grid-flow-col gap-[3px]" style={{ gridTemplateRows: 'repeat(5, 1fr)' }}>
          {Array.from({ length: weeks }, (_, wk) =>
            WEEKDAYS.map((_, dow) => {
              const cell = byCell.get(`${wk}:${dow}`)
              const key = `${wk}:${dow}`
              if (!cell) {
                return <span key={key} className="h-3 rounded-[2px] bg-slate-50" />
              }
              return (
                <span
                  key={key}
                  className={'h-3 rounded-[2px] ' + (key === todayKey ? 'ring-1 ring-slate-900 ring-offset-1' : '')}
                  style={{ background: cellColor(cell.adv_pct) }}
                  title={`${cell.date} · ${(cell.adv_pct * 100).toFixed(0)}% of stocks up`}
                />
              )
            }),
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[0.6rem] text-slate-400">
        <span>Broad sell-off</span>
        <span className="flex gap-[3px]">
          {['#b91c1c', '#fca5a5', '#e2e8f0', '#86efac', '#15803d'].map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />
          ))}
        </span>
        <span>Broad rally</span>
      </div>
    </div>
  )
}
