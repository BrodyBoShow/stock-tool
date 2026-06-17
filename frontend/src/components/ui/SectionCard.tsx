import { InfoTip } from '@/components/ui/InfoTip'

/** Shared dashboard section card: bold title + optional hint + body.
 * Used across the Lab, Market, and Portfolio pages. `tip` adds an accessible
 * "?" tooltip next to the title; `right` renders controls on the title row. */
export function SectionCard({
  title,
  hint,
  tip,
  right,
  children,
}: {
  title: string
  hint?: string
  tip?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-[#e5e7eb] bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center text-base font-bold text-[#111827]">
            <span>{title}</span>
            {tip && <InfoTip text={tip} />}
          </div>
          {hint && <p className="mt-0.5 text-[0.78rem] text-[#9ca3af]">{hint}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}
