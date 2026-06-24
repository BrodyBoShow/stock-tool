import { InfoTip } from '@/components/ui/InfoTip'

/** Headline metric tile used on the Portfolio page and its projection cards.
 * `tip` adds an accessible "?" explainer next to the label — the metric names
 * (TWR, IRR, beta, Sharpe…) aren't self-evident to a retail user. */
export function StatCard({
  label,
  value,
  sub,
  color,
  tip,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  tip?: string
}) {
  return (
    <div className="rounded-card border border-gray-200 bg-white px-4 py-3.5 shadow-card">
      <div className="flex items-center text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-slate-400">
        <span>{label}</span>
        {tip && <InfoTip text={tip} />}
      </div>
      <div
        className="mt-1 text-[1.25rem] font-extrabold tabular-nums leading-tight"
        style={{ color: color ?? '#0f172a' }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.72rem] text-slate-500">{sub}</div>}
    </div>
  )
}
