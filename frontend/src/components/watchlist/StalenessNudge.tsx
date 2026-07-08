import { Link } from 'react-router-dom'

import type { WatchlistRow } from '@/types/api'

const STALE_DAYS = 90

/** A name is a prune candidate when it has sat on the radar longer than
 *  STALE_DAYS with NO plan (target / note / entry / kill) and NO thesis — i.e.
 *  you starred it months ago and never wrote down why. Surfacing these is the
 *  "don't watch forever; set kill criteria" discipline from the research. It
 *  self-resolves: write a plan or thesis (or remove the name) and it drops off. */
function isStale(r: WatchlistRow): boolean {
  if (!r.added_at) return false
  const ageDays = (Date.now() - Date.parse(r.added_at)) / 86_400_000
  if (!(ageDays > STALE_DAYS)) return false
  const hasPlan =
    r.target_price != null || !!r.note || !!r.entry_trigger || !!r.kill_criteria
  return !hasPlan && !r.thesis_summary
}

/** Zone-B nudge listing prune candidates. Renders nothing when there are none. */
export function StalenessNudge({ rows }: { rows: WatchlistRow[] }) {
  const stale = rows.filter(isStale)
  if (stale.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--r-lg)] border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-[0.8rem] text-amber-900">
      <span aria-hidden="true">⏳</span>
      <span>
        {stale.length} name{stale.length > 1 ? 's have' : ' has'} sat on your radar 90+ days with
        no plan or thesis —
      </span>
      {stale.slice(0, 8).map((r) => (
        <Link
          key={r.security_id}
          to={`/securities/${r.ticker}`}
          className="font-semibold underline decoration-amber-300 underline-offset-2 hover:text-amber-700"
        >
          {r.ticker}
        </Link>
      ))}
      <span className="text-amber-700">· worth a quick review, or prune below.</span>
    </div>
  )
}
