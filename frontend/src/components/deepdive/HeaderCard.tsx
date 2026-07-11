import { useQuery } from '@tanstack/react-query'

import { SectorPill } from '@/components/screener/SectorPill'
import { Delta } from '@/components/ui/Delta'
import { getBriefStatus } from '@/lib/api'
import { scoreHeat } from '@/lib/colors'
import { topDriver, type FactorPctls } from '@/lib/factorReading'
import { DASH, fmtDate, fmtPrice } from '@/lib/format'
import type { SecurityHeader } from '@/types/api'

const STAT_LABEL = 'text-[0.75rem] text-muted'
const STAT_VALUE = 'text-[1.35rem] font-extrabold text-ink'
const STAT_SUB = 'text-[0.72rem] text-subtle'

/** Circular 0–100 gauge, heat-colored, with the score in the center. */
function ScoreGauge({ value }: { value: number }) {
  const r = 30
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(100, value)) / 100
  const { bar } = scoreHeat(value)
  return (
    <svg viewBox="0 0 72 72" width="64" height="64" className="flex-none">
      <circle cx="36" cy="36" r={r} fill="none" strokeWidth="7" style={{ stroke: 'var(--surface-2)' }} />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        style={{ stroke: bar }}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="34" textAnchor="middle" className="numeric" fontSize={Number.isInteger(value) ? 18 : 16} fontWeight="800" style={{ fill: 'var(--ink)' }}>
        {Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}
      </text>
      <text x="36" y="47" textAnchor="middle" fontSize="8.5" style={{ fill: 'var(--subtle)' }}>
        / 100
      </text>
    </svg>
  )
}

export function HeaderCard({
  header,
  action,
}: {
  header: SecurityHeader
  action?: React.ReactNode
}) {
  // Reuse the cached brief query (DecisionBriefPanel + ScoreStoryPanel share it)
  // for the hero one-liner, the week-over-week composite delta, and rank.
  const { data: brief } = useQuery({
    queryKey: ['brief', header.ticker],
    queryFn: () => getBriefStatus(header.ticker),
    staleTime: 5 * 60 * 1000,
  })
  const trend = brief?.trend ?? []
  const last = trend[trend.length - 1]
  const prior = trend[trend.length - 2]
  const compDelta =
    last?.composite != null && prior?.composite != null
      ? last.composite - prior.composite
      : null
  const rank = last?.rank ?? null
  const oneLiner = brief?.brief?.brief?.one_liner ?? null

  const pctls: FactorPctls = {
    composite: header.composite,
    growth: header.growth_pctl,
    value: header.value_pctl,
    quality: header.quality_pctl,
    momentum: header.momentum_pctl,
  }
  const driver = topDriver(pctls)
  const nSub = header.details?.sub_pctls
    ? Object.values(header.details.sub_pctls).filter((v) => v != null).length
    : null
  const whyRanked =
    header.composite == null
      ? null
      : `${driver ? `Strongest factor: ${driver.label}` : 'Balanced across factors'}` +
        `${nSub != null ? ` · ${nSub} sub-metrics scored` : ''}`

  return (
    <div className="rounded-card border border-line bg-surface px-[22px] py-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-[18px]">
        <div className="flex items-center gap-3.5">
          <div
            className="flex h-[54px] w-[54px] flex-none items-center justify-center rounded-[13px] text-[1.15rem] font-extrabold text-white"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #4f46e5)' }}
          >
            {header.ticker.slice(0, 2)}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[1.45rem] font-extrabold text-ink">
                {header.ticker}
              </span>
              {header.exchange && (
                <span className="rounded-full bg-surface-3 px-2.5 py-[3px] text-[0.72rem] font-semibold text-ink">
                  {header.exchange}
                </span>
              )}
              <SectorPill sector={header.sector} />
            </div>
            <div className="mt-px text-[0.95rem] text-ink">{header.name ?? DASH}</div>
            {header.industry && (
              <div className="mt-0.5 text-[0.78rem] text-subtle">{header.industry}</div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2.5">
          {action}
          <div className="flex items-center gap-[30px]">
            <div>
              <div className={STAT_LABEL}>Last close</div>
              <div className={STAT_VALUE}>{fmtPrice(header.last_price)}</div>
              <div className={STAT_SUB}>{fmtDate(header.price_date)}</div>
            </div>
            {/* Composite gauge — the page's anchor number */}
            <div className="flex items-center gap-2.5">
              {header.composite != null ? (
                <ScoreGauge value={header.composite} />
              ) : (
                <div className={STAT_VALUE}>{DASH}</div>
              )}
              <div>
                <div className={STAT_LABEL}>
                  Composite{' '}
                  <span
                    title="Nightly factor snapshot. The Factors pane shows the live-adjusted value using today's price."
                    className="cursor-help rounded bg-surface-3 px-1 text-[0.6rem] font-semibold uppercase tracking-wide text-subtle"
                  >
                    nightly
                  </span>
                </div>
                {compDelta != null && (
                  <div className="numeric text-[0.82rem] font-bold">
                    <Delta value={compDelta} /> <span className="font-normal text-subtle">wk</span>
                  </div>
                )}
                <div className={STAT_SUB}>
                  {rank != null ? (
                    <>
                      rank <span className="numeric font-semibold text-muted">#{rank}</span>
                    </>
                  ) : (
                    'percentile · 100 = top'
                  )}
                </div>
                <div className={STAT_SUB}>as of {fmtDate(header.score_date)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hero thesis one-liner (AI) — falls back to the factor-driver readout */}
      {(oneLiner || whyRanked) && (
        <div className="mt-3.5 border-t border-line pt-3">
          {oneLiner ? (
            <p className="text-[0.92rem] leading-snug text-ink">{oneLiner}</p>
          ) : (
            <p
              className="text-[0.78rem] text-subtle"
              title="The factor pulling this composite up the most. Descriptive — not advice."
            >
              {whyRanked}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
