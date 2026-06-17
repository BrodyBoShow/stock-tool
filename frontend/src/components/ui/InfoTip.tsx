import { useId } from 'react'

/** Accessible info tooltip — hover OR keyboard-focus reveals the definition.
 * The button carries a short fixed name and points at the description via
 * aria-describedby (not a giant aria-label), so screen readers announce
 * "More information" then read the definition. Shared across Market / Lab. */
export function InfoTip({ text, className = '' }: { text: string; className?: string }) {
  const id = useId()
  return (
    <span className={`group relative ml-1 inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label="More information"
        aria-describedby={id}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#cbd5e1] text-[0.55rem] font-bold leading-none text-[#94a3b8] transition-colors hover:border-[#94a3b8] hover:text-[#475569] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4f46e5]/40"
      >
        <span aria-hidden="true">?</span>
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-56 -translate-x-1/2 rounded-lg bg-[#0f172a] px-2.5 py-1.5 text-left text-[0.7rem] font-normal normal-case leading-snug tracking-normal text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}
