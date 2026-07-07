import { InfoTip } from '@/components/ui/InfoTip'
import { HEALTH_BAND_LABEL, type HealthBand, type HealthScore } from '@/components/portfolio/portfolioUi'

/** Portfolio Health — a DETERMINISTIC 0-100 diagnostic of measurable structural
 *  issues (concentration, drawdown, diversification, risk-adjusted return), with
 *  a fully transparent per-factor breakdown.
 *
 *  Honesty contract: this scores STRUCTURAL RESILIENCE, not stock-picking skill,
 *  and it is not advice. It never fabricates — too little history renders a
 *  copy-only "not enough history" state with no number or gauge, and dropped
 *  factors are disclosed. All math lives in computeHealthScore; this is pure
 *  presentation.
 */

const BAND_STYLE: Record<HealthBand, { text: string; bar: string; chip: string; ring: string }> = {
  needs_attention: {
    text: 'text-red-700',
    bar: '#dc2626',
    chip: 'bg-red-50 text-red-700 border-red-200',
    ring: '#fee2e2',
  },
  balanced: {
    text: 'text-amber-700',
    bar: '#d97706',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    ring: '#fef3c7',
  },
  resilient: {
    text: 'text-emerald-700',
    bar: '#16a34a',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ring: '#dcfce7',
  },
}

const METHODOLOGY =
  'Portfolio Health is a 0-100 diagnostic of measurable STRUCTURAL issues — ' +
  'single-name and sector concentration, drawdown, diversification and ' +
  'risk-adjusted return — computed from your own holdings and price history. ' +
  'It measures structural resilience, NOT stock-picking skill, and it is not ' +
  'investment advice. Each factor below shows the real number and the points it ' +
  'cost; the score starts at 100 and subtracts those penalties.'

function Gauge({ score, band }: { score: number; band: HealthBand }) {
  const r = 30
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(100, score)) / 100
  const style = BAND_STYLE[band]
  return (
    <svg viewBox="0 0 72 72" width="72" height="72" className="flex-none">
      <circle cx="36" cy="36" r={r} fill="none" stroke={style.ring} strokeWidth="7" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke={style.bar}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="34" textAnchor="middle" className="numeric" fontSize="19" fontWeight="800" fill="#0f172a">
        {score.toFixed(0)}
      </text>
      <text x="36" y="47" textAnchor="middle" fontSize="8.5" fill="#94a3b8">
        / 100
      </text>
    </svg>
  )
}

function bridgeLine(tone: 'good' | 'warn' | 'bad', benchmark: string): string {
  const rel =
    tone === 'good' ? `beating ${benchmark}` : tone === 'bad' ? `trailing ${benchmark}` : `tracking ${benchmark}`
  return `You're ${rel}, but this score measures structural resilience — concentration, drawdown and diversification — not whether you beat the market.`
}

export function HealthScorePanel({
  health,
  benchmark,
  verdictTone,
}: {
  health: HealthScore
  benchmark: string
  verdictTone: 'good' | 'warn' | 'bad'
}) {
  // Honesty: too little history → copy only, never a fabricated grade.
  if (health.status === 'insufficient_history' || health.score == null || health.band == null) {
    return (
      <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-gray-900">Portfolio health</h3>
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-slate-500">
            Not investment advice
          </span>
        </div>
        <p className="mt-2 text-[0.8rem] text-slate-500">
          No holdings to score yet — add positions and the health diagnostic will appear
          here.
        </p>
      </section>
    )
  }

  const style = BAND_STYLE[health.band]
  const failing = health.factors.filter((f) => !f.ok)
  const passed = health.factors.filter((f) => f.ok)

  return (
    <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center text-sm font-bold text-gray-900">
          Portfolio health
          <InfoTip text={METHODOLOGY} />
        </h3>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-amber-700">
          Not investment advice
        </span>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <Gauge score={health.score} band={health.band} />
        <div className="min-w-0">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.78rem] font-bold ${style.chip}`}
          >
            {HEALTH_BAND_LABEL[health.band]}
          </span>
          <p className="mt-1.5 text-[0.74rem] leading-relaxed text-slate-500">
            {bridgeLine(verdictTone, benchmark)}
          </p>
        </div>
      </div>

      {/* What cost points */}
      {failing.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {failing.map((f) => (
            <li key={f.key} className="flex items-start gap-2 text-[0.78rem]">
              <span
                className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full"
                style={{ background: f.penalty >= 12 ? '#dc2626' : f.penalty >= 6 ? '#d97706' : '#64748b' }}
              />
              <span className="min-w-0 flex-1 text-slate-600">{f.reason}</span>
              <span className="flex-none font-bold tabular-nums text-slate-500">−{Math.round(f.penalty)} pts</span>
            </li>
          ))}
        </ul>
      )}

      {/* What passed — honest about what was checked AND cleared */}
      {passed.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {passed.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[0.66rem] font-medium text-slate-500"
            >
              <span className="text-emerald-500">✓</span>
              {f.label}
            </span>
          ))}
        </div>
      )}

      {health.notes.map((n) => (
        <p key={n} className="mt-2 text-[0.66rem] text-slate-400">
          {n}
        </p>
      ))}

      <p className="mt-3 border-t border-gray-100 pt-2 text-[0.64rem] leading-relaxed text-gray-400">
        A diagnostic of measurable structural issues, not a rating of your stock-picking.
        Scored on {health.scoredCount} of {health.totalFactors} factors. Not investment advice.
      </p>
    </section>
  )
}
