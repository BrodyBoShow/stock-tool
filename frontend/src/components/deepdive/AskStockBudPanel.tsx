import { useMutation } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { ApiError, askStockBud } from '@/lib/api'
import type { AskResponse } from '@/types/api'

/** Ask StockBud AI — a grounded, cached Q&A over this stock's own data (factor
 *  scores, filings, insiders, valuation, news, macro). Docks under the Decision
 *  Brief. Not advice; every answer is generated only from data we already hold. */

const SUGGESTED = [
  'Why is this stock ranked where it is?',
  "What's the bull case and bear case?",
  'What are the biggest risks?',
  'Is it cheap or expensive, and why?',
  'What do the insider trades say?',
  'What changed recently?',
  'Explain the Quality score.',
  'What should I watch next quarter?',
]

const RESEARCH_STEPS = [
  'Reading factor scores…',
  'Checking filings, insiders & 8-Ks…',
  'Reviewing valuation & news…',
  'Writing a grounded answer…',
]

// ── tiny, dependency-free markdown renderer (headings, bullets, bold) ──────────

function inline(text: string, keyBase: string): React.ReactNode[] {
  // Split on **bold** — odd segments are bold.
  return text.split(/\*\*/).map((seg, i) =>
    i % 2 === 1 ? <strong key={`${keyBase}-b${i}`}>{seg}</strong> : <span key={`${keyBase}-t${i}`}>{seg}</span>,
  )
}

function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.replace(/\r/g, '').split('\n')
  const blocks: React.ReactNode[] = []
  let bullets: string[] = []
  let key = 0

  const flushBullets = () => {
    if (bullets.length === 0) return
    const items = bullets
    blocks.push(
      <ul key={`ul${key++}`} className="my-1.5 ml-1 list-disc space-y-1 pl-4 text-[0.86rem] text-ink">
        {items.map((b, i) => (
          <li key={i}>{inline(b, `li${key}-${i}`)}</li>
        ))}
      </ul>,
    )
    bullets = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const t = line.trim()
    if (!t) {
      flushBullets()
      continue
    }
    const bullet = /^[-*•]\s+/.exec(t)
    if (bullet) {
      bullets.push(t.slice(bullet[0].length))
      continue
    }
    flushBullets()
    const h = /^(#{1,4})\s+(.*)$/.exec(t)
    if (h) {
      blocks.push(
        <div key={`h${key++}`} className="mt-3 text-[0.82rem] font-bold uppercase tracking-[0.04em] text-ink first:mt-0">
          {inline(h[2], `h${key}`)}
        </div>,
      )
      continue
    }
    blocks.push(
      <p key={`p${key++}`} className="my-1.5 text-[0.86rem] leading-relaxed text-ink first:mt-0">
        {inline(t, `p${key}`)}
      </p>,
    )
  }
  flushBullets()
  return blocks
}

// ── confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: AskResponse['confidence'] }) {
  if (!level) return null
  const cls =
    level === 'high'
      ? 'border-pos-border bg-pos-soft text-pos'
      : level === 'low'
        ? 'border-neg-border bg-neg-soft text-neg'
        : 'border-warn bg-warn-soft text-warn'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.05em] ${cls}`}
      title="How completely the available data answers the question — not a measure of certainty about the stock."
    >
      {level} confidence
    </span>
  )
}

function ResearchLoader() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, RESEARCH_STEPS.length - 1)), 1400)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="mt-4 space-y-1.5 rounded-lg border border-line bg-surface-2 p-4">
      {RESEARCH_STEPS.map((label, i) => (
        <div
          key={label}
          className={`flex items-center gap-2 text-[0.8rem] ${i <= step ? 'text-ink' : 'text-subtle'}`}
        >
          <span
            className={
              'flex h-4 w-4 items-center justify-center rounded-full text-[0.6rem] ' +
              (i < step
                ? 'bg-pos-strong text-inverse'
                : i === step
                  ? 'bg-accent text-accent-ink'
                  : 'bg-surface-3 text-transparent')
            }
          >
            {i < step ? <Icon icon={Check} size={11} /> : '•'}
          </span>
          <span className={i === step ? 'font-semibold' : ''}>{label}</span>
        </div>
      ))}
    </div>
  )
}

export function AskStockBudPanel({ ticker }: { ticker: string }) {
  const toast = useToast()
  const [input, setInput] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>([])

  const ask = useMutation({
    mutationFn: (question: string) => askStockBud(ticker, question),
    onSuccess: (_data, question) =>
      setRecent((r) => [question, ...r.filter((q) => q !== question)].slice(0, 6)),
    onError: (e) =>
      toast('error', e instanceof ApiError ? e.message : 'Could not get an answer'),
  })

  // State resets between stocks via a `key={ticker}` remount at the call site.

  const submit = (question: string) => {
    const q = question.trim()
    if (!q || ask.isPending) return
    setAsked(q)
    ask.mutate(q)
  }

  const answer = ask.data

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-ink">Ask StockBud AI</span>
          <span className="rounded-full border border-accent bg-accent-soft px-1.5 py-0.5 text-[0.58rem] font-bold uppercase tracking-[0.06em] text-accent">
            Beta
          </span>
        </div>
        <span className="text-[0.72rem] text-subtle">Grounded in this stock's data · not advice</span>
      </div>

      {/* input */}
      <form
        className="mt-3 flex items-stretch gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask anything about ${ticker}…`}
          maxLength={500}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[0.9rem] text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={ask.isPending || input.trim().length === 0}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-[0.86rem] font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {ask.isPending ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {/* suggested prompts */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTED.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              setInput(q)
              submit(q)
            }}
            disabled={ask.isPending}
            className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[0.72rem] font-medium text-muted transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {/* recent questions (this session) */}
      {recent.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem]">
          <span className="font-semibold uppercase tracking-[0.06em] text-subtle">Recent</span>
          {recent.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => submit(q)}
              disabled={ask.isPending}
              className="text-accent hover:underline disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* loading */}
      {ask.isPending && <ResearchLoader />}

      {/* answer */}
      {answer && !ask.isPending && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
          {asked && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[0.86rem] font-bold text-ink">{asked}</span>
              <div className="flex items-center gap-1.5">
                <ConfidenceBadge level={answer.confidence} />
                {answer.cached && (
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.05em] text-subtle">
                    cached
                  </span>
                )}
              </div>
            </div>
          )}
          <div>{renderMarkdown(answer.answer)}</div>

          {answer.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.06em] text-subtle">
                Sources used
              </span>
              {answer.sources.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[0.66rem] font-medium text-muted"
                >
                  <Icon icon={Check} size={11} className="text-pos" />
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-[0.68rem] leading-relaxed text-subtle">
        Answers are generated only from StockBud's own data for this company and may be
        incomplete or wrong. This is research context, <strong>not investment advice</strong> —
        no recommendations, ratings, or price targets.
      </p>
    </section>
  )
}
