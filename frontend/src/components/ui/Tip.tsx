import { InfoTip } from '@/components/ui/InfoTip'
import { glossary } from '@/lib/glossary'

/**
 * Glossary-backed term: renders the term text followed by an accessible
 * info-dot whose tooltip comes from the single glossary registry, so
 * definitions can't drift between panes. Unknown keys render children only.
 */
export function Tip({ k, children }: { k: string; children?: React.ReactNode }) {
  const text = glossary[k]
  return (
    <span className="inline-flex items-center whitespace-nowrap">
      {children ?? k}
      {text ? <InfoTip text={text} /> : null}
    </span>
  )
}
