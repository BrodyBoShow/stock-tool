import { useQuery } from '@tanstack/react-query'

import { getClinical } from '@/lib/api'
import type { ClinicalTrial } from '@/types/api'

/** Biotech clinical-trial pipeline for the deep-dive (ClinicalTrials.gov, free).
 *  Renders nothing for non-health-care names (server returns available:false).
 *  Context only — trial counts, phases, active late-stage studies, conditions. */

function statusClasses(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('recruit') || s.includes('active') || s.includes('enroll'))
    return 'border-pos-border bg-pos-soft text-pos'
  if (s.includes('terminat') || s.includes('withdraw') || s.includes('suspend'))
    return 'border-neg-border bg-neg-soft text-neg'
  if (s.includes('complet')) return 'border-info bg-info-soft text-info'
  return 'border-line bg-surface-2 text-muted'
}

function Chip({ label, count, cls }: { label: string; count: number; cls: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold ${cls}`}
    >
      {label}
      <span className="tabular-nums opacity-80">{count}</span>
    </span>
  )
}

function TrialRow({ t }: { t: ClinicalTrial }) {
  const inner = (
    <div className="flex items-start gap-2">
      {t.phase && (
        <span className="mt-0.5 shrink-0 rounded-md border border-accent bg-accent-soft px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.03em] text-accent">
          {t.phase.replace('PHASE', 'P')}
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[0.82rem] font-medium leading-snug text-ink">
          {t.title || t.nct_id}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.68rem] text-subtle">
          {t.status && <span>{t.status}</span>}
          {t.conditions.length > 0 && <span>· {t.conditions.slice(0, 2).join(', ')}</span>}
          {t.nct_id && <span className="text-muted">· {t.nct_id}</span>}
        </div>
      </div>
    </div>
  )
  if (!t.nct_id) return <div className="py-1.5">{inner}</div>
  return (
    <a
      href={`https://clinicaltrials.gov/study/${t.nct_id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2"
      title="Open on ClinicalTrials.gov"
    >
      {inner}
    </a>
  )
}

export function ClinicalPipelinePanel({ ticker }: { ticker: string }) {
  const { data, isPending } = useQuery({
    queryKey: ['clinical', ticker],
    queryFn: () => getClinical(ticker),
    staleTime: 6 * 60 * 60 * 1000, // trials change slowly
  })

  // Self-hiding: nothing while loading, nothing for non-biotech / no trials.
  if (isPending || !data || !data.available) return null

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-ink">Clinical pipeline</span>
          {data.total != null && (
            <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[0.7rem] font-semibold text-muted">
              {data.total} trials
            </span>
          )}
        </div>
        <span className="text-[0.7rem] text-subtle">Source: {data.source}</span>
      </div>

      {/* phase breakdown */}
      {data.by_phase.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[0.62rem] font-bold uppercase tracking-[0.06em] text-subtle">
            By phase
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.by_phase.map((p) => (
              <Chip
                key={p.phase}
                label={p.phase}
                count={p.count}
                cls="border-accent bg-accent-soft text-accent"
              />
            ))}
          </div>
        </div>
      )}

      {/* status breakdown */}
      {data.by_status.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[0.62rem] font-bold uppercase tracking-[0.06em] text-subtle">
            By status
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.by_status.map((s) => (
              <Chip key={s.status} label={s.status} count={s.count} cls={statusClasses(s.status)} />
            ))}
          </div>
        </div>
      )}

      {/* active late-stage trials */}
      {data.active_late_stage.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[0.62rem] font-bold uppercase tracking-[0.06em] text-subtle">
            Active late-stage studies (Phase 2+)
          </div>
          <div className="divide-y divide-line">
            {data.active_late_stage.map((t) => (
              <TrialRow key={t.nct_id || t.title} t={t} />
            ))}
          </div>
        </div>
      )}

      {/* conditions */}
      {data.top_conditions.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          <span className="text-[0.6rem] font-bold uppercase tracking-[0.06em] text-subtle">
            Focus areas
          </span>
          {data.top_conditions.map((c) => (
            <span
              key={c.condition}
              className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.68rem] font-medium text-muted"
            >
              {c.condition}
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 text-[0.66rem] leading-relaxed text-subtle">
        Trials where this company is listed as a sponsor on ClinicalTrials.gov. Counts reflect
        registered studies, not FDA approvals or trial success — context only, not investment advice.
      </p>
    </section>
  )
}
