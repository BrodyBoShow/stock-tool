import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ErrorCard } from '@/components/ErrorCard'
import { InfoTip } from '@/components/ui/InfoTip'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { getBacktest } from '@/lib/api'
import { fmtDate, fmtPct as fmtPctBase, fmtRatio, fmtSignedPct } from '@/lib/format'
import type {
  BacktestCI,
  BacktestICBlock,
  BacktestKeyResult,
  BacktestRandomPortfolio,
  BacktestRunResponse,
} from '@/types/api'

const KEY_LABELS: Record<string, string> = {
  composite: 'Composite',
  growth: 'Growth',
  value: 'Value',
  quality: 'Quality',
  momentum: 'Momentum',
}

// Thin adapters over lib/format so the formatting logic lives in one place.
const fmtPct = (x: number | null | undefined, signed = true) =>
  signed ? fmtSignedPct(x) : fmtPctBase(x)
const fmtSharpe = fmtRatio
const ciPct = (ci?: BacktestCI | null) => (ci ? `${fmtPct(ci.lo)} … ${fmtPct(ci.hi)}` : '—')
const ciSharpe = (ci?: BacktestCI | null) => (ci ? `${fmtSharpe(ci.lo)} … ${fmtSharpe(ci.hi)}` : '—')

// ── traffic-light tones ───────────────────────────────────────────────────────
type Tone = 'good' | 'warn' | 'bad' | 'neutral'
// Darkened to clear WCAG AA (4.5:1) for the small table text + CI captions, not
// just the large bold KPI numbers. good #047857=5.5:1, warn #b45309=5.0:1,
// bad #b91c1c=5.9:1 on white (and >=4.5:1 on the selected-row tint).
const TONE_HEX: Record<Tone, string> = {
  good: '#047857',
  warn: '#b45309',
  bad: '#b91c1c',
  neutral: '#0f172a',
}
// Pass/fail thresholds, one place so the KPIs, table and verdict all agree.
const icTone = (t?: number | null): Tone =>
  t == null ? 'neutral' : t >= 3 ? 'good' : t >= 2 ? 'warn' : 'bad'
const icMeanTone = (m?: number | null): Tone =>
  m == null ? 'neutral' : m >= 0.03 ? 'good' : m > 0 ? 'warn' : 'bad'
const lsTone = (s?: number | null): Tone =>
  s == null ? 'neutral' : s > 0.3 ? 'good' : s > 0 ? 'warn' : 'bad'
const sharpeTone = (s?: number | null): Tone =>
  s == null ? 'neutral' : s >= 1 ? 'good' : s > 0 ? 'neutral' : 'bad'
const vsSpyTone = (cagr?: number | null, spy?: number | null): Tone =>
  cagr == null || spy == null ? 'neutral' : cagr >= spy ? 'good' : 'warn'
const pctileTone = (p?: number | null): Tone =>
  p == null ? 'neutral' : p >= 0.95 ? 'good' : p >= 0.8 ? 'warn' : 'bad'

// ── small primitives ──────────────────────────────────────────────────────────

/** Accessible info tooltip — hover OR keyboard-focus reveals the definition.
 * The button carries a short name and points at the description via
 * aria-describedby (not a giant aria-label), so screen readers announce
 * "More information" then read the definition as the description. */
/** Dense KPI tile (~35% shorter than before) — traffic-light value + tooltip. */
function Stat({ label, value, sub, tone = 'neutral', tip }: {
  label: string
  value: string
  sub?: string
  tone?: Tone
  tip?: string
}) {
  return (
    <div className="rounded-card border border-[#e5e7eb] bg-white px-3 py-2.5 shadow-card">
      <div className="flex items-center text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">
        <span>{label}</span>
        {tip && <InfoTip text={tip} />}
      </div>
      <div
        className="mt-0.5 text-[1.15rem] font-extrabold leading-tight tabular-nums"
        style={{ color: TONE_HEX[tone] }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.64rem] leading-tight text-[#9ca3af]">{sub}</div>}
    </div>
  )
}

/** Segmented toggle (e.g. Linear / Log). */
function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-[#e5e7eb] bg-[#f8fafc] p-0.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className="rounded-md px-2.5 py-1 text-[0.72rem] font-semibold transition-colors"
            style={on ? { background: '#ffffff', color: '#4f46e5', boxShadow: '0 1px 2px rgba(15,23,42,0.08)' } : { color: '#64748b' }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── verdict synthesis ─────────────────────────────────────────────────────────
type Grade = 'strong' | 'moderate' | 'weak' | 'inverted' | 'unknown'
const GRADE_STYLE: Record<Grade, { bg: string; border: string; chip: string; label: string }> = {
  strong: { bg: '#f0fdf4', border: '#86efac', chip: '#16a34a', label: 'STRONG SIGNAL' },
  moderate: { bg: '#fffbeb', border: '#fde68a', chip: '#d97706', label: 'MODERATE SIGNAL' },
  weak: { bg: '#fef2f2', border: '#fecaca', chip: '#dc2626', label: 'WEAK / NO EDGE' },
  inverted: { bg: '#fef2f2', border: '#fecaca', chip: '#dc2626', label: 'INVERTED' },
  unknown: { bg: '#f8fafc', border: '#e2e8f0', chip: '#64748b', label: 'INSUFFICIENT DATA' },
}

interface VerdictPoint { ok: boolean | null; text: string }
interface Verdict { grade: Grade; headline: string; action: string; points: VerdictPoint[] }

function buildVerdict(
  sel: BacktestKeyResult,
  label: string,
  rp: BacktestRandomPortfolio | null,
): Verdict {
  const t = sel.ic?.t_stat ?? null
  const ls = sel.long_short.sharpe ?? null
  const topLo = sel.bootstrap?.top?.cagr?.lo ?? null
  const nums = ['1', '2', '3', '4', '5']
    .map((b) => sel.bucket_cagrs[b])
    .filter((x): x is number => x != null)
  let upSteps = 0
  for (let i = 1; i < nums.length; i++) if (nums[i] >= nums[i - 1]) upSteps++
  const monotone =
    nums.length >= 2 ? nums[nums.length - 1] > nums[0] && upSteps >= nums.length - 2 : null

  let grade: Grade
  if (t == null) grade = 'unknown'
  else if (t <= -2) grade = 'inverted'
  else if (t >= 3) grade = 'strong'
  else if (t >= 2) grade = 'moderate'
  else grade = 'weak'

  const points: VerdictPoint[] = [
    {
      ok: t == null ? null : t >= 2,
      text:
        t == null
          ? 'Not enough months to measure rank predictiveness.'
          : `Sorts next-month returns: IC t-stat ${t.toFixed(1)} over ${sel.ic?.n ?? '—'} months` +
            `${sel.ic ? ` (${Math.round(sel.ic.pct_positive * 100)}% of months positive)` : ''}.`,
    },
    {
      ok: monotone,
      text:
        monotone == null
          ? 'Quintile spread unavailable.'
          : monotone
            ? 'Returns climb steadily from the worst to the best quintile.'
            : 'Returns do not climb cleanly across quintiles.',
    },
    {
      ok: topLo == null ? null : topLo > 0,
      text:
        topLo == null
          ? 'Top-quintile bootstrap unavailable.'
          : `Top-quintile return holds up under bootstrap (90% CI floor ${fmtPct(topLo)}).`,
    },
    {
      ok: ls == null ? null : ls > 0,
      text:
        ls == null
          ? 'Long-short spread unavailable.'
          : `Long-short (top − bottom) Sharpe ${fmtSharpe(ls)} — ${ls > 0.3 ? 'a genuinely tradeable spread' : ls > 0 ? 'only weakly positive' : 'negative, so the spread is not tradeable'}.`,
    },
  ]
  // Always present (stable list length) — degrades to a neutral note for the
  // single-factor rankings, where the random-portfolio null isn't computed.
  points.push(
    rp
      ? {
          ok: rp.percentile >= 0.8,
          text: `Composite top quintile beats ${Math.round(rp.percentile * 100)}% of random same-size baskets.`,
        }
      : { ok: null, text: 'Random-portfolio test is computed for the composite ranking only.' },
  )

  const headline = {
    strong: `${label}: a real, statistically strong signal.`,
    moderate: `${label}: a real but moderate signal.`,
    weak: `${label}: no reliable edge in this window.`,
    inverted: `${label}: the ranking points the wrong way here.`,
    unknown: `${label}: not enough data to judge.`,
  }[grade]

  const action =
    grade === 'inverted'
      ? 'Investigate before using — over this window the bottom quintile outran the top.'
      : grade === 'weak'
        ? 'Don’t lean on this factor on its own; it adds little ranking power here.'
        : grade === 'unknown'
          ? 'Re-run once more history is available.'
          : ls != null && ls > 0.3
            ? 'Usable both as a long-only tilt and as a long-short spread.'
            : 'Use it to tilt a long-only screen toward top-ranked names — the long-short leg isn’t worth shorting on this data.'

  return { grade, headline, action, points }
}

function VerdictBanner({ v }: { v: Verdict }) {
  const s = GRADE_STYLE[v.grade]
  return (
    <section
      className="rounded-card border p-5 shadow-card"
      style={{ background: s.bg, borderColor: s.border }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="rounded-full px-2.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-white"
          style={{ background: s.chip }}
        >
          {s.label}
        </span>
        <h2 className="text-[1.05rem] font-extrabold text-[#0f172a]">{v.headline}</h2>
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {v.points.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-[0.82rem] text-[#334155]">
            <span
              aria-hidden
              className="mt-[1px] font-bold"
              style={{ color: p.ok == null ? '#64748b' : p.ok ? TONE_HEX.good : TONE_HEX.bad }}
            >
              {p.ok == null ? '–' : p.ok ? '✓' : '✕'}
            </span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-black/5 pt-3 text-[0.84rem] font-semibold text-[#0f172a]">
        <span className="text-[#64748b]">What to do: </span>
        {v.action}
      </p>
    </section>
  )
}

// ── charts ────────────────────────────────────────────────────────────────────

/** Equity curves: selected factor's top quintile (+ optional long-short) vs SPY
 * vs universe EW. Linear or log Y so a flat-looking line isn't hiding the action. */
function EquityChart({ data, sel, factorLabel, showLongShort, logScale }: {
  data: BacktestRunResponse
  sel: BacktestKeyResult
  factorLabel: string
  showLongShort: boolean
  logScale: boolean
}) {
  const points = useMemo(() => {
    const bench = data.benchmarks
    if (!sel || !bench) return []
    const top = new Map(sel.curves.dates.map((d, i) => [d, sel.curves.top[i]]))
    const ls = new Map(sel.curves.dates.map((d, i) => [d, sel.curves.long_short[i]]))
    return bench.dates.map((d, i) => ({
      date: d.slice(0, 7),
      strategy: top.get(d) ?? null,
      longshort: ls.get(d) ?? null,
      spy: bench.spy[i] ?? null,
      universe: bench.universe_ew[i] ?? null,
    }))
  }, [data, sel])

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={28} />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickFormatter={(v: number) => `${v.toFixed(logScale ? 0 : 1)}x`}
          scale={logScale ? 'log' : 'linear'}
          domain={logScale ? [0.5, 'auto'] : ['auto', 'auto']}
          allowDataOverflow={false}
          width={44}
        />
        <Tooltip
          formatter={(v: number, name: string) => [`${v?.toFixed(2)}x`, name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="strategy" name={`Top quintile (${factorLabel})`}
          stroke="#4f46e5" strokeWidth={2.2} dot={false} connectNulls />
        {/* Long-short growth can cross zero; a log axis can't plot <=0 (it would
            silently drop those points and bridge the gap), so it shows on the
            linear axis only. */}
        {showLongShort && !logScale && (
          <Line type="monotone" dataKey="longshort" name="Long-short (top − bottom)"
            stroke="#16a34a" strokeWidth={1.8} strokeDasharray="5 3" dot={false} connectNulls />
        )}
        <Line type="monotone" dataKey="spy" name="S&P 500 (SPY)"
          stroke="#0ea5e9" strokeWidth={1.8} dot={false} connectNulls />
        <Line type="monotone" dataKey="universe" name="Universe equal-weight"
          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Drawdown of the top-quintile curve (running peak-to-trough). */
function DrawdownChart({ comp }: { comp: BacktestKeyResult }) {
  const points = useMemo(() => {
    let peak = -Infinity
    return comp.curves.dates.map((d, i) => {
      const v = comp.curves.top[i]
      peak = Math.max(peak, v)
      return { date: d.slice(0, 7), dd: (v / peak - 1) * 100 }
    })
  }, [comp])

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={28} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={44} />
        <Tooltip
          formatter={(v: number) => [`${v.toFixed(1)}%`, 'Drawdown']}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <Area type="monotone" dataKey="dd" stroke="#dc2626" fill="#fee2e2" strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** CAGR by quintile — the spread, visually. Top bucket highlighted. */
function QuintileChart({ res }: { res: BacktestKeyResult }) {
  const points = Object.entries(res.bucket_cagrs)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([b, cagr]) => ({
      bucket: `Q${b}${Number(b) === 5 ? ' (top)' : Number(b) === 1 ? ' (bottom)' : ''}`,
      top: Number(b) === 5,
      cagr: cagr == null ? null : cagr * 100,
    }))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#94a3b8' }} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={44} />
        <Tooltip
          formatter={(v: number) => [`${v?.toFixed(1)}% CAGR`, '']}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <ReferenceLine y={0} stroke="#cbd5e1" />
        <Bar dataKey="cagr" radius={[5, 5, 0, 0]} maxBarSize={56}>
          {points.map((p, i) => (
            <Cell key={i} fill={p.top ? '#4f46e5' : '#c7d2fe'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Information Coefficient over time — month bars + a trailing-6mo average line
 * so signal decay (a falling line) is visible at a glance. */
function ICChart({ ic }: { ic: BacktestICBlock }) {
  const points = useMemo(() => {
    const win = 6
    const raw = ic.series
    return raw.map((s, i) => {
      const slice = raw
        .slice(Math.max(0, i - win + 1), i + 1)
        .map((x) => x.ic)
        .filter((v): v is number => v != null)
      const trail = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null
      return {
        date: s.date.slice(0, 7),
        ic: s.ic == null ? null : Number(s.ic.toFixed(4)),
        trail: trail == null ? null : Number(trail.toFixed(4)),
      }
    })
  }, [ic])
  return (
    <ResponsiveContainer width="100%" height={210}>
      <ComposedChart data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={28} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={44} tickFormatter={(v: number) => v.toFixed(2)} />
        <Tooltip
          formatter={(v: number, n: string) => [v?.toFixed(3), n === 'trail' ? '6-mo avg IC' : 'rank IC']}
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e5e7eb' }}
        />
        <ReferenceLine y={0} stroke="#cbd5e1" />
        <Bar dataKey="ic" radius={[2, 2, 0, 0]} maxBarSize={14}>
          {points.map((p, i) => (
            <Cell key={i} fill={(p.ic ?? 0) >= 0 ? '#86efac' : '#fecaca'} />
          ))}
        </Bar>
        <Line type="monotone" dataKey="trail" name="trail" stroke="#4f46e5" strokeWidth={2} dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function LabPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['lab', 'backtest'],
    queryFn: getBacktest,
    staleTime: 60 * 60 * 1000, // refreshed monthly by the workflow
  })
  const [factorKey, setFactorKey] = useState('composite')
  const [showLongShort, setShowLongShort] = useState(false)
  const [logScale, setLogScale] = useState(false)

  if (isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-[120px] w-full rounded-card" />
        <Skeleton className="h-[96px] w-full rounded-card" />
        <Skeleton className="h-[380px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  if (!data.has_results || !data.results) {
    return (
      <div className="rounded-card border border-[#e5e7eb] bg-white p-10 text-center shadow-card">
        <h1 className="text-xl font-extrabold text-[#0f172a]">Factor Lab</h1>
        <p className="mx-auto mt-3 max-w-[520px] text-sm text-[#64748b]">
          No backtest stored yet. The monthly workflow
          (<code className="rounded bg-[#f1f5f9] px-1">backtest.yml</code>) computes and stores
          one automatically on the 2nd of each month — or run it once now with{' '}
          <code className="rounded bg-[#f1f5f9] px-1">python scripts/run_backtest.py --store</code>.
        </p>
      </div>
    )
  }

  const results = data.results
  const comp = results.composite
  const keys = ['composite', ...Object.keys(results).filter((k) => k !== 'composite')]
  const sel = results[factorKey] ?? comp
  const selLabel = KEY_LABELS[factorKey] ?? factorKey
  const selTop = sel.buckets['5'] ?? sel.buckets[String(Object.keys(sel.buckets).length)]
  const spyCagr = data.benchmarks?.spy_stats.cagr ?? null
  const rp = data.significance?.random_portfolio ?? null
  const verdict = buildVerdict(sel, selLabel, factorKey === 'composite' ? rp : null)

  const FactorPills = (
    <div className="flex flex-wrap gap-[5px]">
      {keys.map((k) => {
        const selected = factorKey === k
        return (
          <button
            key={k}
            type="button"
            onClick={() => setFactorKey(k)}
            aria-pressed={selected}
            className="rounded-full px-[11px] py-[3px] text-[0.72rem] font-semibold transition-shadow"
            style={
              selected
                ? { background: '#eef2ff', color: '#4f46e5', boxShadow: 'inset 0 0 0 1.5px #4f46e5' }
                : { background: '#ffffff', color: '#334155', boxShadow: 'inset 0 0 0 1px #cbd5e1' }
            }
          >
            {KEY_LABELS[k] ?? k}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-5">
      {/* header */}
      <header className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
        <div className="h-1 bg-gradient-to-r from-[#2563eb] via-[#4f46e5] to-[#0ea5e9]" />
        <div className="px-7 pb-5 pt-6">
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em]">
            <span className="text-[#4f46e5]">StockBud</span>
            <span className="text-[#d1d5db]">/</span>
            <span className="text-[#94a3b8]">Factor Lab</span>
          </div>
          <h1 className="mt-2 text-[1.95rem] font-extrabold leading-[1.1] tracking-[-0.015em] text-[#0f172a]">
            Does the model actually work?
          </h1>
          <p className="mt-2 text-[0.9rem] text-[#64748b]">
            Point-in-time backtest of <code>{data.config_version}</code> · {data.start_date} →{' '}
            {data.end_date} · {data.params?.rebalances} monthly rebalances · quintiles, equal-weight,{' '}
            {data.params?.cost_bps}bps/side · sub-$1 names dropped, returns winsorized
          </p>
          {data.generated_at && (
            <p className="mt-1 text-[0.74rem] text-[#94a3b8]">
              Computed {fmtDate(data.generated_at.slice(0, 10))} · served from store · refreshes monthly
            </p>
          )}
        </div>
      </header>

      {/* factor selector — drives the verdict and every chart below */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-[#475569]">
          Ranking
        </span>
        {FactorPills}
      </div>

      {/* the decision: a plain-language verdict for the selected ranking */}
      <VerdictBanner v={verdict} />

      {/* dense KPI strip — headline + significance at a glance, traffic-lit */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Top-Q CAGR"
          value={fmtPct(selTop?.cagr)}
          sub={`vs SPY ${fmtPct(spyCagr)}`}
          tone={vsSpyTone(selTop?.cagr, spyCagr)}
          tip="Compound annual growth of the top-ranked quintile, rebalanced monthly, net of the cost estimate. Survivor-biased — compare to SPY, don't read the level literally."
        />
        <Stat
          label="Top-Q Sharpe"
          value={fmtSharpe(selTop?.sharpe)}
          sub="risk-adjusted"
          tone={sharpeTone(selTop?.sharpe)}
          tip="Annualized return ÷ volatility for the top quintile. Higher = smoother ride per unit of return."
        />
        <Stat
          label="Mean IC"
          value={sel.ic ? sel.ic.mean.toFixed(3) : '—'}
          sub={sel.ic ? `${(sel.ic.pct_positive * 100).toFixed(0)}% months positive` : 'n/a'}
          tone={icMeanTone(sel.ic?.mean)}
          tip="Information Coefficient: the average month's rank correlation between score and next-month return. ~0.03+ is a useful signal; 0 = no ranking power."
        />
        <Stat
          label="IC t-stat"
          value={sel.ic?.t_stat != null ? sel.ic.t_stat.toFixed(2) : '—'}
          sub="|t| ≥ 2 ≈ significant"
          tone={icTone(sel.ic?.t_stat)}
          tip="How many standard errors the mean IC sits above zero. |t| ≥ 2 means the ranking's predictiveness is unlikely to be luck. The stablest 'real vs noise' read."
        />
        <Stat
          label="Long-short Sharpe"
          value={fmtSharpe(sel.long_short.sharpe)}
          sub="top − bottom spread"
          tone={lsTone(sel.long_short.sharpe)}
          tip="Risk-adjusted return of going long the top quintile and short the bottom. Positive = the spread is real and, in principle, tradeable market-neutral."
        />
        <Stat
          label="Win rate (top-Q)"
          value={fmtPct(sel.win_rate_top, false)}
          sub="% months positive"
          tip="Share of months the top quintile had a positive return."
        />
      </div>

      {/* equity curve */}
      <SectionCard
        title={`Growth of $1 — ${selLabel} top quintile vs benchmarks`}
        hint="Top quintile (monthly rebalance, net of cost estimate) vs SPY total return and the equal-weight scored universe."
        tip="Switch to Log when one line dwarfs the others — a log axis shows percentage moves, so compounding is comparable across very different scales."
        right={
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowLongShort((s) => !s)}
              aria-pressed={showLongShort}
              className="rounded-lg border px-2.5 py-1 text-[0.72rem] font-semibold transition-colors"
              style={
                showLongShort
                  ? { borderColor: '#16a34a', background: '#f0fdf4', color: '#16a34a' }
                  : { borderColor: '#e5e7eb', background: '#ffffff', color: '#64748b' }
              }
            >
              {showLongShort ? '✓ ' : ''}Long-short
            </button>
            <Segmented
              value={logScale ? 'log' : 'lin'}
              onChange={(v) => setLogScale(v === 'log')}
              options={[
                { value: 'lin', label: 'Linear' },
                { value: 'log', label: 'Log' },
              ]}
            />
          </div>
        }
      >
        {showLongShort && logScale && (
          <p className="mb-2 text-[0.72rem] text-[#b45309]">
            Long-short is hidden on the log axis (its growth-of-$1 can cross zero, which a log scale
            can't plot). Switch to Linear to see it.
          </p>
        )}
        <EquityChart data={data} sel={sel} factorLabel={selLabel} showLongShort={showLongShort} logScale={logScale} />
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title={`${selLabel} top-quintile drawdown`}
          hint="Peak-to-trough of the strategy curve — the pain you'd have sat through."
        >
          <DrawdownChart comp={sel} />
        </SectionCard>

        <SectionCard
          title={`${selLabel}: CAGR by quintile`}
          hint="A working signal steps up left to right. Flat or U-shaped = no ranking power."
          tip="Each bar is the equal-weight CAGR of one fifth of the universe, sorted worst (Q1) to best (Q5). The cleaner the climb, the stronger the ranking."
        >
          <QuintileChart res={sel} />
        </SectionCard>
      </div>

      {/* significance & robustness */}
      {sel.ic || rp ? (
        <SectionCard
          title="Is the edge real, or luck?"
          tip="These quantify the signal rigorously, but on a survivor-biased sample. Read the IC t-stat first; the random-portfolio percentile is a single-path statistic, so treat it as supporting colour."
          hint="Information Coefficient, bootstrap confidence intervals, and a random-portfolio null. All seeded — reproducible, not a fresh number each run."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat
              label="Top-Q CAGR 90% CI"
              value={ciPct(sel.bootstrap?.top?.cagr)}
              sub="block bootstrap"
              tone={sel.bootstrap?.top?.cagr ? (sel.bootstrap.top.cagr.lo > 0 ? 'good' : 'warn') : 'neutral'}
              tip="Resampling the monthly returns in blocks 2,000× — the range the top-quintile CAGR lands in 90% of the time. A floor above 0 means the edge isn't a fluke of one good month."
            />
            <Stat
              label="Top-Q Sharpe 90% CI"
              value={ciSharpe(sel.bootstrap?.top?.sharpe)}
              sub="block bootstrap"
              tone={sel.bootstrap?.top?.sharpe ? (sel.bootstrap.top.sharpe.lo > 0 ? 'good' : 'warn') : 'neutral'}
              tip="Same block bootstrap, applied to the top-quintile Sharpe ratio."
            />
            <Stat
              label="Long-short CAGR 90% CI"
              value={ciPct(sel.bootstrap?.long_short?.cagr)}
              sub="block bootstrap"
              tone={sel.bootstrap?.long_short?.cagr ? (sel.bootstrap.long_short.cagr.lo > 0 ? 'good' : 'warn') : 'neutral'}
              tip="Bootstrap CI for the long-short (top − bottom) spread. If this straddles 0, the market-neutral leg isn't reliable."
            />
          </div>

          {rp && (
            <div className="mt-4 rounded-card border border-[#e5e7eb] bg-[#f8fafc] px-4 py-3">
              <div className="flex items-center text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-[#475569]">
                Random-portfolio null (composite top quintile)
                <InfoTip text="The 'monkey' test: 1,000 random equal-weight baskets of the same size, chained over the same window. Where the real strategy's CAGR lands tells you how much is skill vs market beta." />
              </div>
              <p className="mt-1 text-[0.86rem] text-[#334155]">
                The composite top quintile beat{' '}
                <strong style={{ color: TONE_HEX[pctileTone(rp.percentile)] }}>
                  {(rp.percentile * 100).toFixed(0)}%
                </strong>{' '}
                of {rp.n_sims.toLocaleString()} random equal-weight baskets of the same size (~
                {rp.avg_basket} names). Actual {fmtPct(rp.actual_cagr)} CAGR vs random median{' '}
                {fmtPct(rp.p50)} (5–95th pct {fmtPct(rp.p5)} … {fmtPct(rp.p95)}).
              </p>
            </div>
          )}

          {sel.ic && (
            <div className="mt-4">
              <div className="mb-1 flex items-center text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-[#475569]">
                Information Coefficient over time — {selLabel}
                <InfoTip text="Green/red bars are each month's rank IC; the indigo line is the trailing 6-month average. A line drifting toward zero is a factor losing its edge." />
              </div>
              <ICChart ic={sel.ic} />
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard
          title="Is the edge real, or luck?"
          hint="Significance & robustness (IC, bootstrap CIs, random-portfolio null)."
        >
          <p className="text-sm text-[#64748b]">
            Significance stats populate on the next backtest run — the monthly workflow, or{' '}
            <code className="rounded bg-[#f1f5f9] px-1">python scripts/run_backtest.py --store</code>.
            The currently stored run predates this feature.
          </p>
        </SectionCard>
      )}

      {/* summary table */}
      <SectionCard
        title="Factor scoreboard"
        hint="Click a row to drive the charts above. Win rate = % of months the top quintile was positive."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[0.84rem]">
            <thead>
              <tr className="border-b border-[#eef1f6] text-left text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-[#94a3b8]">
                <th className="py-2 pr-4">Ranking</th>
                <th className="py-2 pr-4">Top-Q CAGR</th>
                <th className="py-2 pr-4">Top-Q Sharpe</th>
                <th className="py-2 pr-4">IC t-stat</th>
                <th className="py-2 pr-4">Win rate</th>
                <th className="py-2 pr-4">Max DD</th>
                <th className="py-2 pr-4">L-S CAGR</th>
                <th className="py-2 pr-4">L-S Sharpe</th>
                <th className="py-2">Turnover/mo</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const r = results[k]
                const top = r.buckets['5'] ?? r.buckets[String(Object.keys(r.buckets).length)]
                const isSel = factorKey === k
                return (
                  <tr
                    key={k}
                    onClick={() => setFactorKey(k)}
                    className={
                      'cursor-pointer border-b border-[#f8fafc] transition-colors hover:bg-[#f8fafc] ' +
                      (isSel ? 'bg-[#eef2ff]' : '')
                    }
                  >
                    <td className="py-2.5 pr-4 font-bold text-[#1e293b]">
                      {isSel && <span className="mr-1 text-[#4f46e5]">▸</span>}
                      {KEY_LABELS[k] ?? k}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtPct(top?.cagr)}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtSharpe(top?.sharpe)}</td>
                    <td
                      className="py-2.5 pr-4 font-semibold tabular-nums"
                      style={{ color: TONE_HEX[icTone(r.ic?.t_stat)] }}
                    >
                      {r.ic?.t_stat != null ? r.ic.t_stat.toFixed(2) : '—'}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtPct(r.win_rate_top, false)}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-[#dc2626]">
                      {fmtPct(top?.max_drawdown, false)}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">{fmtPct(r.long_short.cagr)}</td>
                    <td
                      className="py-2.5 pr-4 font-semibold tabular-nums"
                      style={{ color: TONE_HEX[lsTone(r.long_short.sharpe)] }}
                    >
                      {fmtSharpe(r.long_short.sharpe)}
                    </td>
                    <td className="py-2.5 tabular-nums">{fmtPct(r.avg_turnover, false)}</td>
                  </tr>
                )
              })}
              {data.benchmarks && (
                <tr>
                  <td className="py-2.5 pr-4 font-bold text-[#64748b]">S&amp;P 500 (SPY)</td>
                  <td className="py-2.5 pr-4 tabular-nums">{fmtPct(data.benchmarks.spy_stats.cagr)}</td>
                  <td className="py-2.5 pr-4 tabular-nums">{fmtSharpe(data.benchmarks.spy_stats.sharpe)}</td>
                  <td className="py-2.5 pr-4">—</td>
                  <td className="py-2.5 pr-4">—</td>
                  <td className="py-2.5 pr-4 tabular-nums text-[#dc2626]">
                    {fmtPct(data.benchmarks.spy_stats.max_drawdown, false)}
                  </td>
                  <td className="py-2.5 pr-4">—</td>
                  <td className="py-2.5 pr-4">—</td>
                  <td className="py-2.5">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* honesty footer — accurate, no contradictory claims */}
      <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-[0.8rem] leading-relaxed text-amber-800">
        <strong>How to read this honestly.</strong> Two caveats remain: (1){' '}
        <strong>survivorship</strong> — the universe is today's listed names, so absolute returns run
        optimistic; lean on the <em>spread</em> across quintiles, not the headline CAGR. (2) It's an{' '}
        <strong>in-sample</strong> study of the ranking, not a live track record. Sub-$1 names are
        dropped at each rebalance and single-period returns are capped at −90%/+200%, which neutralizes
        gross unadjusted-split spikes (like PPCB's $0.01→$250) — but the cap also clips legitimate
        extreme moves, so read the spread as <em>cleaned, not error-free</em>. Research context — not
        investment advice.
      </div>

      <p className="pb-2 text-center text-xs text-[#9ca3af]">
        Backtest recomputed monthly by GitHub Actions (point-in-time data, no look-ahead).
      </p>
    </div>
  )
}
