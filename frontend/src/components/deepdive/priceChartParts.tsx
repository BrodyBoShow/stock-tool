import { fmtDate, fmtVol } from '@/lib/format'

import type { ProChartRow } from './priceChartUtils'

interface TooltipProps {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number | string | null; payload?: ProChartRow }>
  label?: string
}

export function VolumeTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  const vol = payload.find((p) => p.dataKey === 'vol')?.value
  const v = typeof vol === 'number' ? vol : null
  const rel = v != null && row?.avgVol20 ? v / row.avgVol20 : null
  return (
    <div className="rounded-lg border border-line bg-surface px-2 py-1 text-xs shadow-[var(--sh-md)]">
      <div className="font-semibold text-ink">{fmtDate(label)}</div>
      <div className="tabular-nums text-muted">
        Vol {fmtVol(v)}
        {rel != null && ` · ${rel.toFixed(1)}× 20d avg`}
      </div>
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
