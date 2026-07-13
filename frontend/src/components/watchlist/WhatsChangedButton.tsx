import { useMutation } from '@tanstack/react-query'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { ApiError, getWhatsChanged } from '@/lib/api'

/** On-demand "what changed" AI narrative for one watched name. A click POSTs to
 *  the Haiku-backed endpoint (cached server-side by a signal fingerprint, so a
 *  repeat click on an unchanged name costs nothing). Descriptive, not advice.
 *
 *  When the change involved a recent 8-K, filingUrl links straight to that
 *  filing on SEC EDGAR so the reader can open the primary source the narrative
 *  is describing. */
export function WhatsChangedButton({
  ticker,
  filingUrl,
  filingLabel,
  filingForm,
}: {
  ticker: string
  filingUrl?: string | null
  filingLabel?: string | null
  filingForm?: string | null
}) {
  const [text, setText] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: () => getWhatsChanged(ticker),
    onSuccess: (r) => setText(r.narrative),
  })

  if (text) {
    return (
      <div className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-[0.76rem] leading-snug text-ink">
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[0.68rem] font-bold text-accent">
            <Icon icon={Sparkles} size={12} /> What changed
          </span>
          <span className="text-[0.58rem] font-semibold uppercase tracking-wide text-muted">
            AI · not advice
          </span>
        </div>
        {text}
        {filingUrl && (
          <a
            href={filingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-[0.72rem] font-semibold text-accent hover:underline"
          >
            Read the {filingLabel ? `${filingLabel} ` : ''}
            {filingForm ?? 'filing'} on SEC EDGAR
            <Icon icon={ArrowUpRight} size={12} />
          </a>
        )}
      </div>
    )
  }

  const label = m.isPending
    ? 'Thinking…'
    : m.isError
      ? 'Unavailable — try again'
      : 'What changed?'

  return (
    <button
      type="button"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      title={
        m.isError && m.error instanceof ApiError
          ? m.error.message
          : 'A one-line AI read of what moved (Haiku, on-demand)'
      }
      className="mt-1 inline-flex items-center gap-1 text-[0.72rem] font-medium text-accent hover:text-accent disabled:opacity-50"
    >
      <Icon icon={Sparkles} size={12} />
      {label}
    </button>
  )
}
