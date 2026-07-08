import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RiskQuizModal } from '@/components/portfolio/risk/RiskQuizModal'
import { getRiskProfile, putRiskProfile } from '@/lib/api'
import type { RiskProfileResponse } from '@/types/api'

/** The user's stated risk preference on the Portfolio page (PR2).
 *
 * No profile yet -> a "set your risk preference" prompt opening the quiz.
 * Profile set -> a compact card: profile chip, target band range, guardrails,
 * retake / direct-pick controls. A preference the user declares — not advice.
 * (PR3 wires this into holdings alignment + guardrail-aware action cards.)
 */

const PROFILE_STYLES: Record<string, string> = {
  conservative: 'bg-sky-50 text-sky-700 border-sky-200',
  balanced: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  aggressive: 'bg-orange-50 text-orange-700 border-orange-200',
}

const PROFILES = ['conservative', 'balanced', 'aggressive'] as const

export function RiskProfileCard() {
  const qc = useQueryClient()
  const [quizOpen, setQuizOpen] = useState(false)
  // Incremented on every open so the modal remounts with fresh quiz state
  // (a retake must not arrive pre-filled with the previous answers).
  const [quizKey, setQuizKey] = useState(0)
  const [saved, setSaved] = useState<RiskProfileResponse | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['risk-profile'],
    queryFn: getRiskProfile,
    staleTime: 5 * 60_000,
  })

  const save = useMutation({
    mutationFn: putRiskProfile,
    onSuccess: (resp, variables) => {
      qc.setQueryData(['risk-profile'], resp)
      // The profile drives the alignment panels AND the action-card thresholds
      // inside /portfolio — refetch both so the page reflects the new setting
      // immediately (not after the 1-5 min staleTime).
      void qc.invalidateQueries({ queryKey: ['portfolio'] })
      // Only quiz submissions show the mapping-disclosure result screen.
      if ('answers' in variables) setSaved(resp)
      else setQuizOpen(false)
    },
  })

  if (isPending) return null

  const profile = data?.has_profile ? data : null

  return (
    <>
      {profile ? (
        <section className="rounded-card border border-gray-200 bg-white px-4 py-3 shadow-card">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="text-[0.66rem] font-bold uppercase tracking-[0.05em] text-slate-400">
              Your risk preference
            </div>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.78rem] font-bold capitalize ${
                PROFILE_STYLES[profile.profile ?? 'balanced']
              }`}
            >
              {profile.profile}
            </span>
            <span className="text-[0.74rem] text-slate-500">
              Holdings are compared to risk bands {profile.band_min}–{profile.band_max} below;
              positions above {Math.round((profile.guardrails?.max_position_pct ?? 0) * 100)}%
              / sectors above {Math.round((profile.guardrails?.max_sector_pct ?? 0) * 100)}%
              are flagged (alerts, not enforced limits)
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {PROFILES.filter((p) => p !== profile.profile).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={save.isPending}
                  onClick={() => save.mutate({ profile: p })}
                  className="rounded-md border border-gray-200 px-2 py-1 text-[0.68rem] font-semibold capitalize text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
                  title={`Switch directly to ${p} (no quiz)`}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setSaved(null)
                  setQuizKey((k) => k + 1)
                  setQuizOpen(true)
                }}
                className="rounded-md bg-slate-800 px-2 py-1 text-[0.68rem] font-semibold text-white transition hover:bg-slate-700"
              >
                Retake quiz
              </button>
            </div>
          </div>
          {save.isError && (
            <div className="mt-1.5 text-[0.72rem] font-semibold text-rose-600">
              Couldn’t save your preference — the server may be waking up. Please try again.
            </div>
          )}
          <div className="mt-1 text-[0.64rem] text-gray-400">
            A preference you set — not advice. Bands are historical measurements (realized
            volatility over the past year), not predictions.
          </div>
        </section>
      ) : (
        <section className="rounded-card border border-indigo-200 bg-indigo-50/50 px-4 py-3 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[0.9rem] font-bold text-gray-900">
                How much risk do you want?
              </div>
              <div className="mt-0.5 text-[0.76rem] text-slate-500">
                Answer 5 quick questions to set a risk preference. StockBud then shows which
                of your holdings — and which screener names — fall inside the historical
                risk bands you chose.
              </div>
            </div>
            <button
              type="button"
              id="risk-profile-quiz-btn"
              onClick={() => {
                setSaved(null)
                setQuizKey((k) => k + 1)
                setQuizOpen(true)
              }}
              className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Set my risk preference
            </button>
          </div>
        </section>
      )}

      <RiskQuizModal
        key={quizKey}
        open={quizOpen}
        onClose={() => setQuizOpen(false)}
        pending={save.isPending}
        error={save.isError}
        result={saved}
        onSubmit={(answers) => save.mutate({ answers })}
      />
    </>
  )
}
