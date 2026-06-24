import { InfoTip } from '@/components/ui/InfoTip'
import { SectionCard } from '@/components/ui/SectionCard'
import { plColor } from '@/lib/colors'
import { fmtRatio, fmtSignedPct } from '@/lib/format'
import type { PortfolioResponse } from '@/types/api'

/** Annualized volatility from a growth-of-$1 curve (daily stdev × √252). */
function annVol(curve: (number | null)[]): number | null {
  const rets: number[] = []
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]
    const b = curve[i]
    if (a != null && b != null && a > 0) rets.push(b / a - 1)
  }
  if (rets.length < 2) return null
  const mean = rets.reduce((x, y) => x + y, 0) / rets.length
  const v = rets.reduce((x, y) => x + (y - mean) ** 2, 0) / (rets.length - 1)
  return Math.sqrt(v) * Math.sqrt(252)
}

/** Deepest peak-to-trough drop of a growth curve (negative fraction). */
function maxDD(curve: (number | null)[]): number | null {
  let peak = -Infinity
  let mdd = 0
  let seen = false
  for (const v of curve) {
    if (v == null) continue
    seen = true
    if (v > peak) peak = v
    if (peak > 0) mdd = Math.min(mdd, v / peak - 1)
  }
  return seen ? mdd : null
}

const pctInt = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(v >= 0.1 || v <= -0.1 ? 0 : 1)}%`

// Static typical-volatility references so the user can see where they sit on the
// risk spectrum (not computed from their data — labelled "typical").
const VOL_REFS = [
  { label: 'Bonds', vol: 0.05 },
  { label: '60/40', vol: 0.10 },
]

export function BenchmarkComparison({ data }: { data: PortfolioResponse }) {
  const s = data.summary
  const p = data.performance
  if (!s || !p || !p.spy_curve?.length) return null

  const yourVol = s.volatility
  const spyVol = annVol(p.spy_curve)
  const spyDD = maxDD(p.spy_curve)
  const volRatio = spyVol && yourVol ? yourVol / spyVol : null

  const aggression =
    volRatio == null
      ? 'comparable to the market'
      : volRatio >= 2.5
        ? 'very aggressive'
        : volRatio >= 1.6
          ? 'aggressive'
          : volRatio >= 1.1
            ? 'moderately aggressive'
            : volRatio <= 0.8
              ? 'more defensive than the market'
              : 'roughly market-like'

  const scaleMax = Math.max(0.6, (yourVol ?? 0) * 1.1, (spyVol ?? 0) * 1.1)
  const markers = [
    ...VOL_REFS.map((r) => ({ ...r, color: '#cbd5e1', typical: true })),
    { label: 'S&P 500', vol: spyVol, color: '#0ea5e9', typical: false },
    { label: 'You', vol: yourVol, color: '#4f46e5', typical: false },
  ].filter((m) => m.vol != null)

  const row = (
    key: string,
    label: string,
    you: string,
    spy: string,
    opts?: { tip?: string; youColor?: string },
  ) => (
    <div
      key={key}
      className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-slate-50 py-2 last:border-0"
    >
      <span className="flex items-center text-[0.8rem] text-slate-600">
        {label}
        {opts?.tip && <InfoTip text={opts.tip} />}
      </span>
      <span
        className="w-20 text-right text-[0.92rem] font-bold tabular-nums"
        style={opts?.youColor ? { color: opts.youColor } : undefined}
      >
        {you}
      </span>
      <span className="w-20 text-right text-[0.92rem] font-semibold tabular-nums text-slate-400">
        {spy}
      </span>
    </div>
  )

  return (
    <SectionCard
      title="Portfolio vs the market"
      hint="How your return, swings and worst drop stack up against the S&P 500 — and where you land on the risk spectrum."
    >
      {/* column headers */}
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 pb-1 text-[0.62rem] font-bold uppercase tracking-[0.08em] text-slate-400">
        <span />
        <span className="w-20 text-right text-indigo-600">You</span>
        <span className="w-20 text-right">S&amp;P 500</span>
      </div>

      {row(
        'ret',
        'Total return',
        fmtSignedPct(s.twr_total),
        fmtSignedPct(s.spy_total),
        {
          tip: 'Time-weighted return over your tracked window vs SPY over the same dates.',
          youColor: plColor(s.twr_total),
        },
      )}
      {row('vol', 'Volatility (how much it swings)', pctInt(yourVol), pctInt(spyVol), {
        tip: 'Annualized standard deviation of returns. Higher = bigger ups and downs. The S&P 500 typically runs ~15–18%.',
      })}
      {row('dd', 'Worst drawdown', pctInt(s.max_drawdown), pctInt(spyDD), {
        tip: "The largest peak-to-trough drop over the window. The deeper it is, the more you'd have had to stomach.",
        youColor: '#dc2626',
      })}
      {row('beta', 'Beta (market sensitivity)', `β ${fmtRatio(s.beta)}`, 'β 1.00', {
        tip: 'How much you move per 1% market move. 1.0 = in step with the S&P 500; above 1 amplifies both gains and losses.',
      })}

      {/* verdict */}
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[0.82rem] text-slate-700">
        {volRatio != null ? (
          <>
            Your portfolio swings{' '}
            <strong className="text-slate-900">~{fmtRatio(volRatio, 1)}×</strong> as much as
            the S&amp;P 500 (β {fmtRatio(s.beta)}) — squarely{' '}
            <strong className="text-indigo-700">{aggression}</strong>.
          </>
        ) : (
          <>Not enough benchmark history yet to gauge how aggressive this is.</>
        )}
      </div>

      {/* risk spectrum */}
      <div className="mt-4">
        <div className="mb-5 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-slate-400">
          Where you sit on the risk spectrum
        </div>
        <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-200 via-amber-200 to-red-300">
          {markers.map((m) => {
            const left = Math.min(100, Math.max(0, ((m.vol as number) / scaleMax) * 100))
            return (
              <div
                key={m.label}
                className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${left}%` }}
              >
                <div
                  className="absolute -top-4 whitespace-nowrap text-[0.6rem] font-bold"
                  style={{ color: m.typical ? '#94a3b8' : m.color }}
                >
                  {m.label}
                </div>
                <div
                  className="h-3.5 w-3.5 rounded-full border-2 border-white shadow"
                  style={{ background: m.color }}
                />
                <div className="absolute top-4 whitespace-nowrap text-[0.58rem] tabular-nums text-slate-400">
                  {pctInt(m.vol)}
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-7 text-[0.68rem] text-slate-400">
          Annualized volatility. Bonds &amp; 60/40 are typical references, not your data;
          S&amp;P 500 &amp; You are measured over your tracked window.
        </p>
      </div>
    </SectionCard>
  )
}
