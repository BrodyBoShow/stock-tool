import { useQuery } from '@tanstack/react-query'

import { getNews } from '@/lib/api'

/**
 * In-the-news panel (forward-context layer, Slice 3) — recent news coverage for
 * a company from GDELT (free, on-demand, cached). CONTEXT only: it shows how
 * much the company is being written about lately and the recent headlines, so
 * the user sees the narrative the backward-looking score can't. It deliberately
 * does NOT show a "sentiment" number — free per-company news tone is a noisy,
 * weak signal — and it's honest that matching is name-based (may catch unrelated
 * same-name coverage), which is why it surfaces the headlines to judge.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** GDELT 'YYYYMMDDTHHMMSSZ' -> 'Mon D'. */
function fmtSeen(s: string | null): string {
  if (!s || s.length < 8) return ''
  const mo = Number(s.slice(4, 6)) - 1
  const d = Number(s.slice(6, 8))
  return `${MONTHS[mo] ?? '?'} ${d}`
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-slate-500">
          In the news
        </div>
        <span
          title="Recent coverage from GDELT — context only, never feeds the score"
          className="cursor-help rounded bg-slate-100 px-1.5 text-[0.6rem] font-semibold text-slate-500"
        >
          CONTEXT
        </span>
      </div>
      {children}
    </section>
  )
}

export function NewsNarrativePanel({ ticker }: { ticker: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['news', ticker],
    queryFn: () => getNews(ticker),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })

  if (isPending) {
    return (
      <Shell>
        <p className="mt-2 text-[0.82rem] text-gray-400">Checking recent coverage…</p>
      </Shell>
    )
  }

  if (isError || !data?.available || data.articles.length === 0) {
    return (
      <Shell>
        <p className="mt-2 text-[0.82rem] text-gray-400">
          No recent news coverage found for this name.
        </p>
        <p className="mt-2 text-[0.64rem] leading-relaxed text-slate-400">
          Automated name-based matching (GDELT, free). Not a sentiment score. Not
          investment advice.
        </p>
      </Shell>
    )
  }

  const countLabel = data.capped
    ? `${data.article_count}+ articles`
    : `${data.article_count} article${data.article_count === 1 ? '' : 's'}`

  return (
    <Shell>
      <p className="mt-1.5 text-[0.82rem] text-slate-600">
        <span className="font-semibold text-slate-800">{countLabel}</span> in the last{' '}
        {data.window_days} days matching &ldquo;{data.query}&rdquo;.
      </p>
      <ul className="mt-2.5 space-y-2">
        {data.articles.map((a) => (
          <li key={a.url} className="flex items-baseline gap-2 text-[0.82rem]">
            <span className="w-10 flex-none text-[0.68rem] tabular-nums text-slate-400">
              {fmtSeen(a.seendate)}
            </span>
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 text-slate-700 hover:text-indigo-600 hover:underline"
            >
              {a.title}
              {a.domain && (
                <span className="ml-1.5 text-[0.68rem] text-slate-400">· {a.domain}</span>
              )}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[0.64rem] leading-relaxed text-slate-400">
        Automated name-based matching (GDELT, free) — may include unrelated same-name
        coverage, so read the headlines to judge relevance. Not a sentiment score, not a
        signal, not investment advice.
      </p>
    </Shell>
  )
}
