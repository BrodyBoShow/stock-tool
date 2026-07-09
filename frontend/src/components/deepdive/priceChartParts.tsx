import { fmtDate, fmtVol } from '@/lib/format'

import { MA200_COLOR, MA50_COLOR, OVERLAY_COLOR } from './priceChartUtils'

interface TooltipProps {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number | string | null }>
  label?: string
}

export function PriceTooltip({
  active,
  payload,
  label,
  overlayMeta,
  showMA,
}: TooltipProps & { overlayMeta?: { label: string; unit: string; dec: number } | null; showMA: boolean }) {
  if (!active || !payload?.length) return null
  const price = payload.find((p) => p.dataKey === 'v')?.value
  const macro = payload.find((p) => p.dataKey === 'macro')?.value
  const ma50 = payload.find((p) => p.dataKey === 'ma50')?.value
  const ma200 = payload.find((p) => p.dataKey === 'ma200')?.value
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card">
      <div className="font-semibold text-ink">{fmtDate(label)}</div>
      <div className="mt-0.5 text-accent">
        {typeof price === 'number' ? `$${price.toFixed(2)}` : '—'}
      </div>
      {showMA && (
        <>
          {typeof ma50 === 'number' && <div style={{ color: MA50_COLOR }}>MA50: ${ma50.toFixed(2)}</div>}
          {typeof ma200 === 'number' && <div style={{ color: MA200_COLOR }}>MA200: ${ma200.toFixed(2)}</div>}
        </>
      )}
      {overlayMeta && typeof macro === 'number' && (
        <div style={{ color: OVERLAY_COLOR }}>
          {overlayMeta.label}: {macro.toFixed(overlayMeta.dec)}{overlayMeta.unit}
        </div>
      )}
    </div>
  )
}

export function VolumeTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null
  const vol = payload.find((p) => p.dataKey === 'vol')?.value
  return (
    <div className="rounded-lg border border-line bg-surface px-2 py-1 text-xs shadow-card">
      <div className="font-semibold text-ink">{fmtDate(label)}</div>
      <div className="text-muted">Vol {fmtVol(typeof vol === 'number' ? vol : null)}</div>
    </div>
  )
}

type OverlayToggleProps = {
  on: boolean
  onToggle: () => void
  label: string
  color: string
  bgOn: string
  textOn: string
  borderOn: string
}

export function OverlayToggle({ on, onToggle, label, color, bgOn, textOn, borderOn }: OverlayToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[0.76rem] font-semibold transition-colors ${
        on
          ? `${borderOn} ${bgOn} ${textOn}`
          : 'border-line bg-surface text-muted hover:bg-surface-2'
      }`}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: on ? color : 'var(--border-strong)' }} />
      {label}
    </button>
  )
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2 py-1.5">
      <div className="text-[0.58rem] font-semibold uppercase tracking-wide text-subtle">{label}</div>
      <div className="text-[0.95rem] font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[0.58rem] text-subtle">{sub}</div>}
    </div>
  )
}
