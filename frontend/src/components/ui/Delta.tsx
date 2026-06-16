/** Signed delta chip: ▲/▼ + magnitude, green when the move is "good".
 * `goodWhenUp` flips the color polarity (e.g. a falling rank# is good).
 * `zeroDash` shows a muted "·" for a zero delta instead of rendering nothing. */
export function Delta({
  value,
  goodWhenUp = true,
  zeroDash = false,
}: {
  value: number
  goodWhenUp?: boolean
  zeroDash?: boolean
}) {
  if (value === 0) return zeroDash ? <span className="text-[#9ca3af]">·</span> : null
  const up = value > 0
  const good = up === goodWhenUp
  return (
    <span className={good ? 'text-[#059669]' : 'text-[#dc2626]'}>
      {up ? '▲' : '▼'}
      {Math.abs(value).toFixed(1).replace(/\.0$/, '')}
    </span>
  )
}
