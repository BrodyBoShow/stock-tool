/** Headline metric tile used on the Portfolio page and its projection cards. */
export function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-card border border-gray-200 bg-white px-4 py-3.5 shadow-card">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-slate-400">
        {label}
      </div>
      <div
        className="mt-1 text-[1.25rem] font-extrabold tabular-nums leading-tight"
        style={{ color: color ?? '#0f172a' }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.72rem] text-slate-400">{sub}</div>}
    </div>
  )
}
