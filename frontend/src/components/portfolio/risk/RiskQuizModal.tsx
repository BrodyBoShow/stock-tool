import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import type { RiskProfileResponse } from '@/types/api'

/** 5-question risk-preference quiz (risk-personalization layer, PR2).
 *
 * Honesty contract: this records a PREFERENCE the user declares — it is not an
 * assessment, a suitability test, or advice. The result screen discloses the
 * exact answers→profile mapping table so nothing is hidden, and the profile is
 * editable any time (retake, or pick a profile directly).
 */

interface QuizQuestion {
  key: string
  question: string
  options: [string, string, string] // 1 / 2 / 3 points
}

const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    key: 'q1',
    question: 'When will you need this money?',
    options: ['Within 3 years', 'In 3–10 years', 'Not for 10+ years'],
  },
  {
    key: 'q2',
    question: 'Your portfolio drops 25% in a bad market. You…',
    options: ['Sell to stop the losses', 'Hold and wait it out', 'Add more while it’s down'],
  },
  {
    key: 'q3',
    question: 'How much do you rely on this money?',
    options: ['I’ll be living on it soon', 'Partly — it matters', 'Not for a long time'],
  },
  {
    key: 'q4',
    question: 'How experienced an investor are you?',
    options: ['Just starting out', 'A few years of investing', 'Seasoned — many cycles'],
  },
  {
    key: 'q5',
    question: 'What’s the primary goal for this portfolio?',
    options: ['Preserve what I have', 'Steady long-term growth', 'Maximize growth'],
  },
]

/** The disclosed mapping (mirrors engine/risk_profile.py — shown to the user,
 * including the idea-discovery band range so nothing about the setting is hidden). */
const MAPPING_ROWS = [
  { range: '5–8 pts', profile: 'Conservative', bands: '1–2', ideas: '1–2', pos: '10%', sector: '30%' },
  { range: '9–12 pts', profile: 'Balanced', bands: '1–3', ideas: '2–3', pos: '15%', sector: '40%' },
  { range: '13–15 pts', profile: 'Aggressive', bands: '1–4', ideas: '3–4', pos: '20%', sector: '50%' },
]

export function RiskQuizModal({
  open,
  onClose,
  onSubmit,
  pending,
  error = false,
  result,
}: {
  open: boolean
  onClose: () => void
  /** Called with the 5 answers (each 1-3); parent PUTs and passes `result` back. */
  onSubmit: (answers: Record<string, number>) => void
  pending: boolean
  /** True when the last save attempt failed — surfaced so a failure is never silent. */
  error?: boolean
  /** The server-derived profile once saved — switches the modal to the result screen. */
  result: RiskProfileResponse | null
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pending, onClose])

  if (!open) return null

  const complete = QUIZ_QUESTIONS.every((q) => answers[q.key] != null)
  const points = QUIZ_QUESTIONS.reduce((s, q) => s + (answers[q.key] ?? 0), 0)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => !pending && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Risk preference quiz"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.25)]"
      >
        {result?.has_profile ? (
          /* ── result screen: disclose the mapping ── */
          <div>
            <h2 className="text-base font-bold text-gray-900">Your risk preference is saved</h2>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold capitalize text-indigo-700">
              {result.profile}
            </div>
            <p className="mt-2 text-[0.8rem] leading-relaxed text-slate-500">
              StockBud compares your holdings against historical risk bands{' '}
              {result.band_min}–{result.band_max} on the Portfolio page and flags positions
              above {Math.round((result.guardrails?.max_position_pct ?? 0) * 100)}% or sectors
              above {Math.round((result.guardrails?.max_sector_pct ?? 0) * 100)}% — these are
              alert thresholds, not limits StockBud enforces. This is a preference you set —
              not advice — and you can change it anytime.
            </p>
            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[0.66rem] font-bold uppercase tracking-[0.05em] text-slate-400">
                How we mapped your answers ({points} points)
              </div>
              <table className="mt-1.5 w-full text-[0.72rem]">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-0.5 font-semibold">Points</th>
                    <th className="font-semibold">Profile</th>
                    <th className="font-semibold">Compared bands</th>
                    <th className="font-semibold">Idea bands</th>
                    <th className="font-semibold">Position flag</th>
                    <th className="font-semibold">Sector flag</th>
                  </tr>
                </thead>
                <tbody>
                  {MAPPING_ROWS.map((r) => (
                    <tr
                      key={r.profile}
                      className={
                        r.profile.toLowerCase() === result.profile
                          ? 'font-bold text-indigo-700'
                          : 'text-slate-600'
                      }
                    >
                      <td className="py-0.5">{r.range}</td>
                      <td>{r.profile}</td>
                      <td>{r.bands}</td>
                      <td>{r.ideas}</td>
                      <td>&gt; {r.pos}</td>
                      <td>&gt; {r.sector}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── quiz screen ── */
          <div>
            <h2 className="text-base font-bold text-gray-900">How much risk do you want?</h2>
            <p className="mt-1 text-[0.78rem] leading-relaxed text-slate-500">
              Five quick questions set a risk preference StockBud will compare your
              portfolio against. It’s a setting, not advice — you can change it anytime.
            </p>
            <div className="mt-4 space-y-4">
              {QUIZ_QUESTIONS.map((q, qi) => (
                <fieldset key={q.key}>
                  <legend className="text-[0.82rem] font-semibold text-slate-800">
                    {qi + 1}. {q.question}
                  </legend>
                  <div className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-3">
                    {q.options.map((label, i) => {
                      const val = i + 1
                      const on = answers[q.key] === val
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setAnswers((a) => ({ ...a, [q.key]: val }))}
                          className={
                            'rounded-lg border px-2 py-1.5 text-[0.72rem] font-semibold leading-tight transition-all ' +
                            (on
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                              : 'border-gray-200 bg-white text-slate-500 hover:border-indigo-300')
                          }
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
            {error && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[0.74rem] font-semibold text-rose-700">
                Couldn’t save your preference — the server may be waking up. Your answers
                are still here; please try again.
              </div>
            )}
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="text-[0.8rem] font-semibold text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!complete || pending}
                onClick={() => onSubmit(answers)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? 'Saving…' : 'Save my preference'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
