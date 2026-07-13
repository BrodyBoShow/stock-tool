import type { LucideIcon } from 'lucide-react'

/**
 * App-standard Lucide rendering — the ONE way icons appear in StockBud:
 * 16px box, 1.5px stroke (the disciplined "pro tool" weight), currentColor,
 * decorative by default (aria-hidden) unless a `label` gives it standalone
 * meaning. Inline icons inside dense rows pass size={14}; section/nav icons
 * may pass 18–20. Never mix stroke weights.
 *
 * Replaces the emoji-as-icon pattern (the loudest "AI-generic" tell) — no
 * emoji remain as UI icons anywhere in the product.
 */
export function Icon({
  icon: I,
  size = 16,
  strokeWidth = 1.5,
  className,
  label,
}: {
  icon: LucideIcon
  size?: number
  strokeWidth?: number
  className?: string
  /** Accessible name for icons that carry meaning on their own. */
  label?: string
}) {
  return (
    <I
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      // Lucide renders width/height attrs from size; flex-none guards against
      // icons squashing inside flex rows.
      style={{ flex: 'none' }}
    />
  )
}
