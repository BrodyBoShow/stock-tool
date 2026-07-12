import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Delta } from '@/components/ui/Delta'
import { useToast } from '@/components/ui/Toast'
import { ApiError, generateBrief, getBriefStatus, getLiveFactors } from '@/lib/api'
import { rankColor } from '@/lib/colors'
import { FACTOR_DEFS, INPUT_LABELS, PANEL_LABEL as LABEL } from '@/lib/constants'
import { fmtDate, fmtInput } from '@/lib/format'
import type {
  DataConfidence,
  DecisionBrief,
  FactorTrendPoint,
  PriceMoveContext,
  SecurityHeader,
} from '@/types/api'

interface QuantPick {
  key: string
  value: number | null
  pctl: number
  roicIsProxy: boolean
}

/** The strongest (bull) or weakest (bear) sub-metrics by their own universe
 *  percentile — pure factual context from the served snapshot's details, never
 *  parsed out of the AI text. Value comes from inputs, rank from sub_pctls.
 *  The two sides are split into DISJOINT halves (top ⌈n/2⌉ vs bottom ⌊n/2⌋,
 *  capped at 3 each) so a name with few scored metrics can never show the same
 *  metric as both a strength and a weakness. */
function topMetrics(header: SecurityHeader, tone: 'bull' | 'bear'): QuantPick[] {
  const inputs = header.details?.inputs ?? {}
  const sub = header.details?.sub_pctls ?? {}
  const roicIsProxy = header.details?.flags?.roic_pool === 'roa_proxy'
  const rows = Object.values(FACTOR_DEFS)
    .flat()
    .map(([key]) => ({ key, value: inputs[key] ?? null, pctl: sub[key], roicIsProxy }))
    .filter((r): r is QuantPick => r.pctl != null && Number.isFinite(r.pctl))
  rows.sort((a, b) => b.pctl - a.pctl)
  const n = rows.length
  if (tone === 'bull') return rows.slice(0, Math.min(3, Math.ceil(n / 2)))
  return rows.slice(n - Math.min(3, Math.floor(n / 2))).reverse()
}

/** Factual rank chips under a bull/bear case — strongest or weakest sub-metrics. */
function QuantChips({ header, tone }: { header: SecurityHeader; tone: 'bull' | 'bear' }) {
  const picks = topMetrics(header, tone)
  if (picks.length === 0) return null
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-black/[0.06] pt-2.5">
      <span className="text-[0.56rem] font-bold uppercase tracking-[0.06em] text-subtle">
        {tone === 'bull' ? 'Strongest ranks' : 'Weakest ranks'}
      </span>
      {picks.map((m) => {
        const { bg, fg } = rankColor(m.pctl)
        return (
          <span
            key={m.key}
            className="inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 text-[0.68rem] font-semibold"
            style={{ background: bg, color: fg }}
            title={`${INPUT_LABELS[m.key] ?? m.key}: ${Math.round(m.pctl)}th percentile in the universe`}
          >
            {INPUT_LABELS[m.key] ?? m.key}
            {m.value != null && (
              <span className="font-extrabold">
                {fmtInput(m.key, m.value, m.key === 'roic' && m.roicIsProxy)}
              </span>
            )}
            <span className="opacity-60">· {Math.round(m.pctl)}</span>
          </span>
        )
      })}
    </div>
  )
}


const DAY_MS = 86_400_000

/** The most distant snapshot within ~31 days of the latest, for deltas. */
function compareBaseline(trend: FactorTrendPoint[]): FactorTrendPoint | null {
  if (trend.length < 2) return null
  const latest = new Date(trend[trend.length - 1].score_date).getTime()
  const inWindow = trend
    .slice(0, -1)
    .filter((p) => latest - new Date(p.score_date).getTime() <= 31 * DAY_MS)
  return inWindow[0] ?? trend[trend.length - 2]
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    Math.abs(new Date(b).getTime() - new Date(a).getTime()) / DAY_MS,
  )
}


/** Factor-rank trend chips — rendered from our own score history, present even
 * before (or without) an AI brief. `liveRank`/`liveRankTotal` come from
 * /live-factors, computed the same way the screener's # column is: same
 * complete-factor universe, live-adjusted composite substituted for the
 * bounded quoted set — so when present, the Rank chip matches the screener
 * right now instead of only the last nightly close. */
function TrendChips({
  trend,
  liveRank,
  liveRankTotal,
}: {
  trend: FactorTrendPoint[]
  liveRank?: number | null
  liveRankTotal?: number | null
}) {
  const latest = trend[trend.length - 1]
  if (!latest) return null
  const base = compareBaseline(trend)
  const span = base ? daysBetween(base.score_date, latest.score_date) : 0

  const factors: Array<[string, number | null, number | null]> = [
    ['Growth', latest.growth_pctl, base?.growth_pctl ?? null],
    ['Value', latest.value_pctl, base?.value_pctl ?? null],
    ['Quality', latest.quality_pctl, base?.quality_pctl ?? null],
    ['Momentum', latest.momentum_pctl, base?.momentum_pctl ?? null],
  ]

  const nightlyTitle = `As of the ${fmtDate(latest.score_date)} nightly close — not the live-adjusted number you may see elsewhere while the market is open.`
  const shownRank = liveRank ?? latest.rank
  const rankTitle =
    liveRank != null
      ? `Live-adjusted rank — matches the screener right now${
          liveRankTotal != null ? ` (of ${liveRankTotal} complete-factor names)` : ''
        }. Last nightly close was #${latest.rank ?? '—'}.`
      : nightlyTitle

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="inline-flex items-baseline gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-[0.78rem] font-semibold text-accent"
        title={nightlyTitle}
      >
        Composite {latest.composite?.toFixed(1) ?? '—'}
        {base?.composite != null && latest.composite != null && (
          <Delta value={latest.composite - base.composite} zeroDash />
        )}
        <span className="text-[0.6rem] font-bold uppercase tracking-[0.05em] text-accent">
          nightly
        </span>
      </span>
      {shownRank != null && (
        <span
          className="inline-flex items-baseline gap-1.5 rounded-lg bg-surface-3 px-2.5 py-1.5 text-[0.78rem] font-semibold text-ink"
          title={rankTitle}
        >
          Rank #{shownRank}
          {base?.rank != null && base.rank !== shownRank && (
            <span
              className={shownRank < base.rank ? 'text-pos' : 'text-neg'}
            >
              {shownRank < base.rank ? '▲' : '▼'} from #{base.rank}
            </span>
          )}
          <span className="text-[0.6rem] font-bold uppercase tracking-[0.05em] text-subtle">
            {liveRank != null ? 'live' : 'nightly'}
          </span>
        </span>
      )}
      {factors.map(([name, now, then]) => (
        <span
          key={name}
          className="inline-flex items-baseline gap-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-[0.72rem] font-medium text-muted"
        >
          {name} {now != null ? Math.round(now) : '—'}
          {then != null && now != null && Math.round(now - then) !== 0 && (
            <Delta value={Math.round(now - then)} />
          )}
        </span>
      ))}
      <span className="text-[0.68rem] text-subtle">
        {base
          ? `vs ${span} day${span === 1 ? '' : 's'} ago · history builds nightly`
          : 'trend appears as nightly score history accrues'}
      </span>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: DataConfidence }) {
  const styles: Record<DataConfidence['level'], string> = {
    high: 'bg-pos-soft text-pos border-pos-border',
    medium: 'bg-warn-soft text-warn border-warn',
    low: 'bg-neg-soft text-neg border-neg-border',
  }
  return (
    <span
      title={confidence.reason}
      className={`inline-flex cursor-help items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-[0.04em] ${styles[confidence.level]}`}
    >
      {confidence.level} confidence
    </span>
  )
}

function CaseList({ items, tone }: { items: string[]; tone: 'bull' | 'bear' }) {
  const dot = tone === 'bull' ? 'bg-pos-strong' : 'bg-neg-strong'
  return (
    <ul className="mt-1.5 space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[0.85rem] leading-relaxed text-ink">
          <span className={`mt-[7px] h-1.5 w-1.5 flex-none rounded-full ${dot}`} />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

/** Hostname (sans www.) for a compact source chip. */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** "What's behind the move" — a web-searched explanation of a notable price
 * drop, attached to the brief only when the move was large. */
function MoveContext({ ctx }: { ctx: PriceMoveContext }) {
  return (
    <div className="rounded-xl border border-warn bg-warn-soft p-3.5">
      <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-warn">
        What’s behind the move
      </div>
      <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink">
        {ctx.summary}
      </p>
      {ctx.sources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {ctx.sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.title}
              className="text-[0.72rem] font-medium text-accent hover:underline"
            >
              ↗ {sourceHost(s.url)}
            </a>
          ))}
        </div>
      )}
      <p className="mt-2 text-[0.65rem] text-subtle">
        Summarized from public news via web search — not investment advice.
      </p>
    </div>
  )
}

function BriefBody({
  cached,
  header,
  onOpenDiligence,
}: {
  cached: DecisionBrief
  header: SecurityHeader
  onOpenDiligence?: () => void
}) {
  const b = cached.brief
  return (
    <div className="space-y-4">
      <p className="text-[0.95rem] font-medium leading-relaxed text-ink">
        {b.one_liner}
      </p>

      {b.price_move_context && <MoveContext ctx={b.price_move_context} />}

      {b.score_read && (
        <div className="rounded-xl border border-accent bg-accent-soft p-3.5">
          <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-accent">
            How to read this score
          </div>
          <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink">
            <span className="font-semibold text-accent">
              Drives the rank:{' '}
            </span>
            {b.score_read.drivers}
          </p>
          <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink">
            <span className="font-semibold text-warn">
              What the score can’t see:{' '}
            </span>
            {b.score_read.blind_spot}
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-pos-border bg-pos-soft p-3.5">
          <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-pos">
            Bull case
          </div>
          <CaseList items={b.bull_case} tone="bull" />
          <QuantChips header={header} tone="bull" />
        </div>
        <div className="rounded-xl border border-neg-border bg-neg-soft p-3.5">
          <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-neg">
            Bear case
          </div>
          <CaseList items={b.bear_case} tone="bear" />
          <QuantChips header={header} tone="bear" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className={LABEL}>Key catalyst</div>
          <p className="mt-1 text-[0.85rem] leading-relaxed text-ink">
            {b.key_catalyst}
          </p>
        </div>
        <div>
          <div className={LABEL}>Main risk</div>
          <p className="mt-1 text-[0.85rem] leading-relaxed text-ink">
            {b.main_risk}
          </p>
        </div>
      </div>

      <div>
        <div className={LABEL}>What to investigate next</div>
        <ul className="mt-1 space-y-1.5">
          {b.next_questions.map((q, i) => (
            <li key={i} className="flex gap-2 text-[0.85rem] leading-relaxed text-ink">
              <span className="font-bold text-accent">{i + 1}.</span>
              <span>{q}</span>
            </li>
          ))}
        </ul>
        {onOpenDiligence && (
          <button
            type="button"
            onClick={onOpenDiligence}
            className="mt-2.5 flex w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-[0.78rem] transition-colors hover:border-accent"
          >
            <span className="min-w-0 text-muted">
              These are exactly what the factor score can&apos;t see — a citation-grounded
              filing read can answer several.
            </span>
            <span className="ml-auto flex-none whitespace-nowrap font-bold text-accent">
              Run deep filing analysis →
            </span>
          </button>
        )}
      </div>

      <p className="border-t border-line pt-3 text-[0.7rem] text-subtle">
        AI synthesis of StockBud&apos;s own factor data (snapshot{' '}
        {fmtDate(cached.score_date)}) via {cached.model ?? 'Claude'} — an
        organized read of the evidence, not investment advice.
      </p>
    </div>
  )
}

/**
 * Decision Brief (Phase 11) — the decision layer at the top of the deep-dive:
 * factor-rank trend chips (always, from score history) plus an AI-synthesized
 * bull/bear/catalyst/risk brief grounded strictly in StockBud's own data.
 * Auto-generates once per scoring snapshot on first open; cached after.
 */
export function DecisionBriefPanel({
  ticker,
  header,
  onOpenDiligence,
}: {
  ticker: string
  header: SecurityHeader
  /** Opens the Filings pane's deep filing analysis (cross-link from the
   *  "what to investigate next" card). */
  onOpenDiligence?: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()

  const { data, isPending, error } = useQuery({
    queryKey: ['brief', ticker],
    queryFn: () => getBriefStatus(ticker),
    staleTime: 10 * 60 * 1000,
    // Poll every 5s while the server is generating in the background
    refetchInterval: (q) =>
      q.state.data && !q.state.data.brief && q.state.data.generating ? 5000 : false,
  })

  // Same query key/shape as FactorCards — shared cache, and gives us this
  // ticker's live-adjusted universe rank (matches the screener's # column).
  const { data: liveFactors } = useQuery({
    queryKey: ['live-factors', ticker],
    queryFn: () => getLiveFactors(ticker),
    staleTime: 60 * 1000,
    refetchInterval: (q) =>
      q.state.data?.live && !q.state.data.stale ? 90 * 1000 : false,
  })

  const gen = useMutation({
    mutationFn: () => generateBrief(ticker),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brief', ticker] })
      toast('success', 'Decision brief generated')
    },
    onError: (e) =>
      toast(
        'error',
        e instanceof ApiError ? e.message : 'Could not generate the brief',
      ),
  })


  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="text-base font-bold text-ink">Decision brief</div>
          {data?.brief && (
            <ConfidenceBadge confidence={data.brief.brief.data_confidence} />
          )}
        </div>
        {data?.brief && (
          <button
            type="button"
            onClick={() => gen.mutate()}
            disabled={gen.isPending}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.78rem] font-semibold text-muted hover:bg-surface-2 disabled:opacity-50"
          >
            {gen.isPending ? 'Regenerating…' : 'Regenerate'}
          </button>
        )}
      </div>

      <div className="mt-3 space-y-4">
        {isPending ? (
          <p className="text-[0.85rem] text-subtle">Loading…</p>
        ) : error ? (
          <p className="text-[0.85rem] text-neg">
            Couldn’t load the decision brief.
          </p>
        ) : !data.has_scores ? (
          <p className="text-[0.85rem] text-subtle">
            {ticker} hasn’t been scored yet — the brief appears after the first
            scoring run.
          </p>
        ) : (
          <>
            <TrendChips
              trend={data.trend}
              liveRank={liveFactors?.rank}
              liveRankTotal={liveFactors?.rank_total}
            />
            {data.brief ? (
              <BriefBody cached={data.brief} header={header} onOpenDiligence={onOpenDiligence} />
            ) : gen.isError ? (
              <div className="rounded-xl border border-dashed border-neg-border bg-[var(--neg-soft)] p-5 text-center">
                <p className="text-[0.85rem] font-semibold text-neg">
                  Couldn&apos;t generate the brief
                </p>
                <p className="mx-auto mt-1 max-w-md text-[0.8rem] text-subtle">
                  {gen.error instanceof ApiError
                    ? gen.error.message
                    : "Something went wrong reaching the model."}
                </p>
                <button
                  type="button"
                  onClick={() => gen.mutate()}
                  className="mt-3 inline-flex items-center rounded-lg bg-accent-solid px-4 py-1.5 text-[0.82rem] font-semibold text-accent-ink hover:bg-accent-hover"
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-accent bg-[var(--surface)] p-4">
                <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-accent-soft border-t-accent" />
                <p className="text-[0.85rem] text-muted">
                  Preparing brief for {ticker} — usually just a few seconds…
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
