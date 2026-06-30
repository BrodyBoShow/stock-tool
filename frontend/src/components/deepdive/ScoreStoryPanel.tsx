import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { getBriefStatus, getEvents } from '@/lib/api'
import { FACTOR_TABLE, type FactorKey } from '@/lib/constants'
import { fmtShortDate } from '@/lib/format'
import type { FactorTrendPoint } from '@/types/api'

/** The factor lines, in draw order. `composite` is always shown; the four
 *  sub-factors are toggleable so the chart stays legible. */
const LINES: { key: FactorKey; field: keyof FactorTrendPoint; label: string }[] = [
  { key: 'composite', field: 'composite', label: 'Composite' },
  { key: 'growth', field: 'growth_pctl', label: 'Growth' },
  { key: 'value', field: 'value_pctl', label: 'Value' },
  { key: 'quality', field: 'quality_pctl', label: 'Quality' },
  { key: 'momentum', field: 'momentum_pctl', label: 'Momentum' },
]

interface Row {
  date: string
  composite: number | null
  growth: number | null
  value: number | null
  quality: number | null
  momentum: number | null
  rank: number | null
}

function StoryTooltip({
  active,
  payload,
  shown,
  eventsByDate,
}: {
  active?: boolean
  payload?: { payload: Row }[]
  shown: Set<FactorKey>
  eventsByDate: Map<string, string[]>
}) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  const evs = eventsByDate.get(r.date)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-[0.72rem] shadow-lg">
      <div className="mb-1 font-bold text-slate-700">{fmtShortDate(r.date)}</div>
      {LINES.filter((l) => l.key === 'composite' || shown.has(l.key)).map((l) => (
        <div key={l.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: FACTOR_TABLE[l.key].bar }} />
            {l.label}
          </span>
          <span className="numeric font-semibold text-slate-800">
            {r[l.key] == null ? '—' : (r[l.key] as number).toFixed(1)}
          </span>
        </div>
      ))}
      {r.rank != null && (
        <div className="mt-1 border-t border-slate-100 pt-1 text-slate-400">
          Universe rank <span className="numeric font-semibold text-slate-600">#{r.rank}</span>
        </div>
      )}
      {evs && (
        <div className="mt-1 max-w-[200px] text-[0.66rem] text-amber-600">▪ {evs.join(' · ')}</div>
      )}
    </div>
  )
}

export function ScoreStoryPanel({ ticker }: { ticker: string }) {
  const [shown, setShown] = useState<Set<FactorKey>>(new Set())
  const toggle = (k: FactorKey) =>
    setShown((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  const { data: brief } = useQuery({
    queryKey: ['brief', ticker],
    queryFn: () => getBriefStatus(ticker),
    staleTime: 5 * 60 * 1000,
  })
  const { data: events } = useQuery({
    queryKey: ['events', ticker],
    queryFn: () => getEvents(ticker),
    staleTime: 10 * 60 * 1000,
  })

  const trend: FactorTrendPoint[] = brief?.trend ?? []
  const rows: Row[] = trend.map((t) => ({
    date: t.score_date,
    composite: t.composite,
    growth: t.growth_pctl,
    value: t.value_pctl,
    quality: t.quality_pctl,
    momentum: t.momentum_pctl,
    rank: t.rank,
  }))

  // high-signal 8-K markers that fall on/around a score snapshot's date
  const dates = new Set(rows.map((r) => r.date))
  const eventsByDate = new Map<string, string[]>()
  for (const e of events?.events ?? []) {
    if (!e.high_signal) continue
    const d = e.event_date ?? e.filed_date
    // snap each event to the nearest score_date at or after it
    const hit = rows.find((r) => r.date >= d)?.date
    if (hit && dates.has(hit)) {
      eventsByDate.set(hit, [...(eventsByDate.get(hit) ?? []), e.labels[0] ?? e.form].slice(0, 2))
    }
  }

  const card =
    'overflow-hidden rounded-card border border-gray-200 bg-white shadow-card'

  if (rows.length < 3) {
    return (
      <section className={card}>
        <div className="px-4 pb-2.5 pt-3.5">
          <div className="text-base font-bold text-gray-900">Score story</div>
        </div>
        <div className="px-4 pb-5 text-[0.82rem] text-gray-500">
          Score history is still building — only{' '}
          <span className="numeric font-semibold">{rows.length}</span> nightly snapshot
          {rows.length === 1 ? '' : 's'} so far. The timeline fills in as the nightly
          batch accumulates more dates.
        </div>
      </section>
    )
  }

  const first = rows[0]
  const last = rows[rows.length - 1]
  const compChg =
    first.composite != null && last.composite != null ? last.composite - first.composite : null
  // The honest, differentiated insight: a rising score can coincide with a
  // FALLING universe rank when the whole universe rose. rank: lower = better.
  const rankMove =
    first.rank != null && last.rank != null ? first.rank - last.rank : null
  let insight: string | null = null
  if (compChg != null && rankMove != null) {
    const cDir = compChg >= 0 ? 'rose' : 'fell'
    const rDir = rankMove > 0 ? 'climbed' : rankMove < 0 ? 'slipped' : 'held'
    insight =
      `Composite ${cDir} ${Math.abs(compChg).toFixed(1)} over this window` +
      (rankMove === 0
        ? `, holding universe rank #${last.rank}.`
        : ` — universe rank ${rDir} ${Math.abs(rankMove)} to #${last.rank}.` +
          (Math.sign(compChg) !== Math.sign(rankMove) && rankMove !== 0
            ? ' The score and rank diverged: the rest of the universe moved too.'
            : ''))
  }

  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-2 pt-3.5">
        <div>
          <div className="text-base font-bold text-gray-900">Score story</div>
          <div className="mt-0.5 text-[0.78rem] text-gray-500">
            Nightly composite + factor percentiles, {fmtShortDate(first.date)} →{' '}
            {fmtShortDate(last.date)} · {rows.length} snapshots
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LINES.filter((l) => l.key !== 'composite').map((l) => {
            const on = shown.has(l.key)
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => toggle(l.key)}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[0.7rem] font-semibold transition"
                style={
                  on
                    ? { background: FACTOR_TABLE[l.key].bar, color: '#fff' }
                    : { background: '#fff', color: '#64748b', boxShadow: 'inset 0 0 0 1px #e5e7eb' }
                }
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: on ? '#fff' : FACTOR_TABLE[l.key].bar }}
                />
                {l.label}
              </button>
            )
          })}
        </div>
      </div>

      {insight && (
        <div className="mx-4 mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[0.8rem] text-slate-600">
          {insight}
        </div>
      )}

      <div className="px-2 pb-1" style={{ height: 250 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtShortDate}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              minTickGap={36}
              axisLine={{ stroke: '#e2e8f0' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              width={34}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => (
                <StoryTooltip
                  active={active}
                  payload={payload as unknown as { payload: Row }[] | undefined}
                  shown={shown}
                  eventsByDate={eventsByDate}
                />
              )}
            />
            {[...eventsByDate.keys()].map((d) => (
              <ReferenceLine key={d} x={d} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.6} />
            ))}
            {LINES.filter((l) => l.key === 'composite' || shown.has(l.key)).map((l) => (
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                stroke={FACTOR_TABLE[l.key].bar}
                strokeWidth={l.key === 'composite' ? 2.4 : 1.4}
                strokeOpacity={l.key === 'composite' ? 1 : 0.7}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-[0.7rem] text-gray-400">
        Toggle factor lines above · dashed amber = high-signal 8-K · interpretation of
        our own nightly percentiles, not advice.
      </div>
    </section>
  )
}
