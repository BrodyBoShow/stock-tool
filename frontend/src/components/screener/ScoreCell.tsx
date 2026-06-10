import { FACTOR_TABLE, LOW_SCORE_TINT, type FactorKey } from '@/lib/constants'
import { DASH } from '@/lib/format'

/** Factor score cell: numeric value + colored percentile bar, tinted bg. */
export function ScoreCell({
  factor,
  value,
}: {
  factor: FactorKey
  value: number | null
}) {
  const { bar, tint } = FACTOR_TABLE[factor]
  let bg: string | undefined
  if (value !== null && value >= 75) bg = tint
  else if (value !== null && value < 25) bg = LOW_SCORE_TINT

  return (
    <div
      className="flex h-full flex-col items-center justify-center px-3 py-2"
      style={bg ? { background: bg } : undefined}
    >
      {value === null ? (
        <span className="text-[0.82rem] text-[#9ca3af]">{DASH}</span>
      ) : (
        <>
          <span className="text-[0.82rem] font-bold text-[#111827]">
            {value.toFixed(1)}
          </span>
          <span className="mt-1 block h-1 w-12 overflow-hidden rounded-full bg-[#e5e7eb]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: bar }}
            />
          </span>
        </>
      )}
    </div>
  )
}
