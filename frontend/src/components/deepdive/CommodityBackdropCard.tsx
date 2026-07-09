import { Sparkline } from '@/components/screener/Sparkline'
import type { CommodityBackdrop } from '@/types/api'

/**
 * Forward commodity backdrop (forward-context layer, Slice 1) — a CONTEXT-only
 * caveat on the deep-dive Value pane for upstream oil & gas producers. The
 * factor score is backward-looking and honest; this card shows the forward EIA
 * STEO oil & gas price paths so the user can see when trailing cheapness (low
 * EV/EBITDA, high FCF yield on realized high-price earnings) may be flattered
 * by a commodity price forecast to fall. It never feeds the score.
 *
 * We show BOTH oil (WTI) and gas (Henry Hub) because a name's oil/gas weighting
 * isn't knowable from its SIC industry — the user applies whichever matches the
 * company's mix. The near anchor is the STEO's near-term month, not a claimed
 * realized spot.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** 'YYYY-MM-DD' -> 'Mon YYYY'. */
function fmtMonth(iso: string): string {
  const [y, m] = iso.split('-')
  const mi = Number(m) - 1
  return `${MONTHS[mi] ?? m} ${y}`
}

const DIRECTION_STYLE: Record<string, { color: string; verb: string }> = {
  declining: { color: 'var(--neg)', verb: 'forecast to fall' },
  rising: { color: 'var(--pos-strong)', verb: 'forecast to rise' },
  flat: { color: 'var(--muted)', verb: 'forecast roughly flat' },
  unknown: { color: 'var(--muted)', verb: 'forecast' },
}

function BackdropRow({ b }: { b: CommodityBackdrop }) {
  const s = DIRECTION_STYLE[b.direction] ?? DIRECTION_STYLE.unknown
  const values = b.path.map((p) => p.value)
  return (
    <div className="border-t border-black/[0.06] pt-2.5 first:border-t-0 first:pt-0">
      <p className="text-[0.85rem] leading-relaxed text-ink">
        <span className="font-semibold">
          {b.label} {s.verb}
        </span>
        {b.slope_pct != null && (
          <>
            {' '}
            <span className="font-bold tabular-nums" style={{ color: s.color }}>
              {b.slope_pct > 0 ? '+' : ''}
              {b.slope_pct}%
            </span>
          </>
        )}{' '}
        <span className="text-muted">
          — near-term {b.unit} {b.near_price.toFixed(2)} ({fmtMonth(b.near_period)}) →{' '}
          {b.forward_price.toFixed(2)} forecast ({fmtMonth(b.forward_period)})
        </span>
      </p>
      {values.length >= 2 && (
        <div className="mt-1">
          <Sparkline
            data={values}
            fluid
            height={40}
            color={s.color}
            title={`${b.label} STEO path (${fmtMonth(b.near_period)} → ${fmtMonth(b.forward_period)})`}
          />
        </div>
      )}
    </div>
  )
}

export function CommodityBackdropCard({ backdrops }: { backdrops: CommodityBackdrop[] }) {
  if (backdrops.length === 0) return null
  const anyDeclining = backdrops.some((b) => b.direction === 'declining')
  const vintage = backdrops[0].vintage
  const tone = anyDeclining ? 'border-warn bg-warn-soft' : 'border-line bg-surface'

  return (
    <section className={`rounded-card border p-5 shadow-card ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[0.67rem] font-bold uppercase tracking-[0.06em] text-muted">
          Forward commodity backdrop
        </div>
        <span
          title="Context only — never feeds the factor score"
          className="cursor-help rounded bg-surface-3 px-1.5 text-[0.6rem] font-semibold text-muted"
        >
          CONTEXT
        </span>
      </div>

      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted">
        This producer&rsquo;s realized earnings track oil and/or gas prices — apply
        whichever matches its production mix.
      </p>

      <div className="mt-2.5 space-y-2.5">
        {backdrops.map((b) => (
          <BackdropRow key={b.series_id} b={b} />
        ))}
      </div>

      {anyDeclining && (
        <p className="mt-3 text-[0.8rem] leading-relaxed text-muted">
          A declining forecast for a commodity this name sells means today&rsquo;s
          cheap trailing multiples (low EV/EBITDA, high FCF yield on realized
          high-price earnings) may not persist — a forward factor the
          backward-looking score can&rsquo;t see.
        </p>
      )}

      <p className="mt-2 text-[0.65rem] leading-relaxed text-subtle">
        Source: EIA Short-Term Energy Outlook, retrieved {fmtMonth(vintage)}. Forward
        months are forecasts, not guarantees. Not investment advice.
      </p>
    </section>
  )
}
