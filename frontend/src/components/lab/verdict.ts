import type { BacktestKeyResult, BacktestRandomPortfolio } from '@/types/api'

import { fmtPct, fmtSharpe } from './shared'

export type Grade = 'strong' | 'moderate' | 'weak' | 'inverted' | 'unknown'
export interface VerdictPoint { ok: boolean | null; text: string }
export interface Verdict { grade: Grade; headline: string; action: string; points: VerdictPoint[] }

export function buildVerdict(
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
