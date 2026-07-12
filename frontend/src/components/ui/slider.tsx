import * as SliderPrimitive from '@radix-ui/react-slider'
import * as React from 'react'

import { cn } from '@/lib/utils'

interface FactorSliderProps
  extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /** Fill + thumb accent color (per-factor). */
  accent?: string
}

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  FactorSliderProps
>(({ className, accent = 'var(--ink)', ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex w-full touch-none select-none items-center py-1.5',
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-surface-3">
      <SliderPrimitive.Range
        className="absolute h-full rounded-full"
        style={{ background: accent }}
      />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className="block h-3.5 w-3.5 rounded-full border-2 bg-surface shadow transition-transform focus:outline-none focus-visible:scale-110 disabled:pointer-events-none"
      style={{ borderColor: accent }}
    />
  </SliderPrimitive.Root>
))
Slider.displayName = 'Slider'
