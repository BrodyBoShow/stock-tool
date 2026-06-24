import { FACTOR_TABLE, LOW_SCORE_TINT, type FactorKey } from '@/lib/constants'
import { DASH } from '@/lib/format'

/** Factor score cell: numeric value + colored percentile bar, tinted bg.
 *
 * `live` is an optional live-adjusted percentile (price-driven factors only).
 * When it meaningfully differs from the nightly `value`, the cell shows the
 * live number tinted sky-blue with the nightly value on hover — the board's
 * rank/sort still runs on `value` (nightly), so this is display-only. */
export function ScoreCell({
  factor,
  value,
  live,
}: {
  factor: FactorKey
  value: number | null
  live?: number | null
}) {
  const { bar, tint } = FACTOR_TABLE[factor]
  const moved =
    live != null && value != null && Math.abs(live - value) >= 0.1
  const shown = moved ? (live as number) : value

  let bg: string | undefined
  if (shown !== null && shown >= 75) bg = tint
  else if (shown !== null && shown < 25) bg = LOW_SCORE_TINT

  return (
    <div
      className="flex h-full flex-col items-center justify-center px-3 py-2"
      style={bg ? { background: bg } : undefined}
      title={
        moved
          ? `Live ${(live as number).toFixed(1)} · ${value!.toFixed(1)} nightly ` +
            `(${live! > value! ? '+' : '−'}${Math.abs(live! - value!).toFixed(1)})`
          : undefined
      }
    >
      {shown === null ? (
        <span className="text-[0.82rem] text-gray-400">{DASH}</span>
      ) : (
        <>
          <span
            className={
              'text-[0.82rem] font-bold ' +
              (moved ? 'text-sky-700' : 'text-gray-900')
            }
          >
            {shown.toFixed(1)}
            {moved && <span className="align-super text-[0.6em] text-sky-400">●</span>}
          </span>
          <span className="relative mt-1 block h-1 w-12 overflow-hidden rounded-full bg-gray-200">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, shown))}%`,
                background: moved ? '#0ea5e9' : bar,
              }}
            />
            {/* 50th-percentile (median) reference line */}
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-500/45"
            />
          </span>
        </>
      )}
    </div>
  )
}
