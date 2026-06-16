/** Shared dashboard section card: bold title + optional hint + body.
 * Used across the Lab, Market, and Portfolio pages. */
export function SectionCard({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="text-base font-bold text-[#111827]">{title}</div>
      {hint && <p className="mt-0.5 text-[0.78rem] text-[#9ca3af]">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}
