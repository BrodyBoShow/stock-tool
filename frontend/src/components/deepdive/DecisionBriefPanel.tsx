import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useToast } from '@/components/ui/Toast'
import { ApiError, generateBrief, getBriefStatus } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type {
  DataConfidence,
  DecisionBrief,
  FactorTrendPoint,
} from '@/types/api'


const LABEL =
  'text-[0.67rem] font-bold uppercase tracking-[0.06em] text-[#6b7280]'

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

function Delta({ value, goodWhenUp = true }: { value: number; goodWhenUp?: boolean }) {
  if (value === 0) return <span className="text-[#9ca3af]">·</span>
  const up = value > 0
  const good = up === goodWhenUp
  return (
    <span className={good ? 'text-[#059669]' : 'text-[#dc2626]'}>
      {up ? '▲' : '▼'}
      {Math.abs(value).toFixed(1).replace(/\.0$/, '')}
    </span>
  )
}

/** Factor-rank trend chips — rendered from our own score history, present even
 * before (or without) an AI brief. */
function TrendChips({ trend }: { trend: FactorTrendPoint[] }) {
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-baseline gap-1.5 rounded-lg bg-[#eef2ff] px-2.5 py-1.5 text-[0.78rem] font-semibold text-[#3730a3]">
        Composite {latest.composite?.toFixed(1) ?? '—'}
        {base?.composite != null && latest.composite != null && (
          <Delta value={latest.composite - base.composite} />
        )}
      </span>
      {latest.rank != null && (
        <span className="inline-flex items-baseline gap-1.5 rounded-lg bg-[#f1f5f9] px-2.5 py-1.5 text-[0.78rem] font-semibold text-[#334155]">
          Rank #{latest.rank}
          {base?.rank != null && base.rank !== latest.rank && (
            <span
              className={
                latest.rank < base.rank ? 'text-[#059669]' : 'text-[#dc2626]'
              }
            >
              {latest.rank < base.rank ? '▲' : '▼'} from #{base.rank}
            </span>
          )}
        </span>
      )}
      {factors.map(([name, now, then]) => (
        <span
          key={name}
          className="inline-flex items-baseline gap-1 rounded-lg border border-[#e5e7eb] bg-white px-2 py-1.5 text-[0.72rem] font-medium text-[#475569]"
        >
          {name} {now != null ? Math.round(now) : '—'}
          {then != null && now != null && Math.round(now - then) !== 0 && (
            <Delta value={Math.round(now - then)} />
          )}
        </span>
      ))}
      <span className="text-[0.68rem] text-[#9ca3af]">
        {base
          ? `vs ${span} day${span === 1 ? '' : 's'} ago · history builds nightly`
          : 'trend appears as nightly score history accrues'}
      </span>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: DataConfidence }) {
  const styles: Record<DataConfidence['level'], string> = {
    high: 'bg-[#ecfdf5] text-[#047857] border-[#a7f3d0]',
    medium: 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]',
    low: 'bg-[#fef2f2] text-[#b91c1c] border-[#fecaca]',
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
  const dot = tone === 'bull' ? 'bg-[#10b981]' : 'bg-[#ef4444]'
  return (
    <ul className="mt-1.5 space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-[0.85rem] leading-relaxed text-[#1e293b]">
          <span className={`mt-[7px] h-1.5 w-1.5 flex-none rounded-full ${dot}`} />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

function BriefBody({ cached }: { cached: DecisionBrief }) {
  const b = cached.brief
  return (
    <div className="space-y-4">
      <p className="text-[0.95rem] font-medium leading-relaxed text-[#111827]">
        {b.one_liner}
      </p>

      {b.score_read && (
        <div className="rounded-xl border border-[#e0e7ff] bg-[#f5f7ff] p-3.5">
          <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-[#4338ca]">
            How to read this score
          </div>
          <p className="mt-1.5 text-[0.85rem] leading-relaxed text-[#1e293b]">
            <span className="font-semibold text-[#3730a3]">
              Drives the rank:{' '}
            </span>
            {b.score_read.drivers}
          </p>
          <p className="mt-1.5 text-[0.85rem] leading-relaxed text-[#1e293b]">
            <span className="font-semibold text-[#b45309]">
              What the score can’t see:{' '}
            </span>
            {b.score_read.blind_spot}
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[#d1fae5] bg-[#f7fefb] p-3.5">
          <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-[#047857]">
            Bull case
          </div>
          <CaseList items={b.bull_case} tone="bull" />
        </div>
        <div className="rounded-xl border border-[#fee2e2] bg-[#fffafa] p-3.5">
          <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-[#b91c1c]">
            Bear case
          </div>
          <CaseList items={b.bear_case} tone="bear" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className={LABEL}>Key catalyst</div>
          <p className="mt-1 text-[0.85rem] leading-relaxed text-[#1e293b]">
            {b.key_catalyst}
          </p>
        </div>
        <div>
          <div className={LABEL}>Main risk</div>
          <p className="mt-1 text-[0.85rem] leading-relaxed text-[#1e293b]">
            {b.main_risk}
          </p>
        </div>
      </div>

      <div>
        <div className={LABEL}>What to investigate next</div>
        <ul className="mt-1 space-y-1.5">
          {b.next_questions.map((q, i) => (
            <li key={i} className="flex gap-2 text-[0.85rem] leading-relaxed text-[#334155]">
              <span className="font-bold text-[#4f46e5]">{i + 1}.</span>
              <span>{q}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="border-t border-[#f1f5f9] pt-3 text-[0.7rem] text-[#9ca3af]">
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
export function DecisionBriefPanel({ ticker }: { ticker: string }) {
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
    <section className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="text-base font-bold text-[#111827]">Decision brief</div>
          {data?.brief && (
            <ConfidenceBadge confidence={data.brief.brief.data_confidence} />
          )}
        </div>
        {data?.brief && (
          <button
            type="button"
            onClick={() => gen.mutate()}
            disabled={gen.isPending}
            className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-1.5 text-[0.78rem] font-semibold text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-50"
          >
            {gen.isPending ? 'Regenerating…' : 'Regenerate'}
          </button>
        )}
      </div>

      <div className="mt-3 space-y-4">
        {isPending ? (
          <p className="text-[0.85rem] text-[#9ca3af]">Loading…</p>
        ) : error ? (
          <p className="text-[0.85rem] text-[#b91c1c]">
            Couldn’t load the decision brief.
          </p>
        ) : !data.has_scores ? (
          <p className="text-[0.85rem] text-[#9ca3af]">
            {ticker} hasn’t been scored yet — the brief appears after the first
            scoring run.
          </p>
        ) : (
          <>
            <TrendChips trend={data.trend} />
            {data.brief ? (
              <BriefBody cached={data.brief} />
            ) : gen.isError ? (
              <div className="rounded-xl border border-dashed border-[#fecaca] bg-[#fff7f7] p-5 text-center">
                <p className="text-[0.85rem] font-semibold text-[#b91c1c]">
                  Couldn&apos;t generate the brief
                </p>
                <p className="mx-auto mt-1 max-w-md text-[0.8rem] text-[#9ca3af]">
                  {gen.error instanceof ApiError
                    ? gen.error.message
                    : "Something went wrong reaching the model."}
                </p>
                <button
                  type="button"
                  onClick={() => gen.mutate()}
                  className="mt-3 inline-flex items-center rounded-lg bg-[#4f46e5] px-4 py-1.5 text-[0.82rem] font-semibold text-white hover:bg-[#4338ca]"
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-[#e0e7ff] bg-[#fafbff] p-4">
                <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-[#c7d2fe] border-t-[#4f46e5]" />
                <p className="text-[0.85rem] text-[#475569]">
                  Preparing brief for {ticker} — usually ready in 15–30 seconds…
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
