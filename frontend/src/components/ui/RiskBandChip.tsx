/** Historical risk band chip (1-5) — shared by the screener and portfolio.
 *
 * Honesty contract: the band is a backward-looking MEASUREMENT (realized
 * volatility, beta and drawdown over the past year), never a prediction or a
 * recommendation, and the tooltip says so. A null band renders as "—" with an
 * "under 1 year of history" tooltip — missing history is disclosed, never
 * estimated. Colors read as intensity (cool → warm), not good/bad.
 */

const BAND_META: Record<number, { label: string; vol: string; cls: string }> = {
  1: { label: 'Very Low', vol: '< 18%', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  2: { label: 'Low', vol: '18–28%', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  3: { label: 'Moderate', vol: '28–40%', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  4: { label: 'High', vol: '40–60%', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  5: { label: 'Speculative', vol: '≥ 60%', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
}

const METHODOLOGY =
  'Historical risk band from realized volatility, market beta and drawdown over ' +
  'the past year. A backward-looking measurement, not a prediction — risk can ' +
  'change abruptly (e.g. around corporate events). Not investment advice.'

export function RiskBandChip({
  band,
  compact = false,
}: {
  band: number | null
  compact?: boolean
}) {
  const meta = band != null ? BAND_META[band] : undefined
  // Honesty: the vol range is the BAND's anchor, not this name's measurement —
  // a lower-volatility name can sit one band higher via the size/balance-sheet
  // modifiers, so never assert the range as the name's realized vol.
  const tip = meta
    ? `Risk band ${band} · ${meta.label} — volatility anchor ${meta.vol}/yr; micro-cap size or a weak balance sheet can place a lower-volatility name one band higher. ${METHODOLOGY}`
    : 'No risk band — under 1 year of trading history or no recent price data (never estimated).'
  return (
    <span className="group relative inline-flex">
      <span
        className={`inline-flex cursor-default items-center gap-1 rounded-full border px-1.5 py-px font-semibold tabular-nums ${
          compact ? 'text-[0.6rem]' : 'text-[0.66rem]'
        } ${meta ? meta.cls : 'border-gray-200 bg-gray-50 text-gray-400'}`}
      >
        {band != null ? band : '—'}
        {!compact && <span className="font-medium">{meta ? meta.label : 'No band'}</span>}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-64 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-left text-[0.68rem] font-normal normal-case leading-snug tracking-normal text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
      >
        {tip}
      </span>
    </span>
  )
}
