import { FACTOR_TABLE, type FactorKey } from '@/lib/constants'
import { DASH } from '@/lib/format'
import type { SecurityHeader } from '@/types/api'

const ORDER: Array<{ key: FactorKey; label: string }> = [
  { key: 'composite', label: 'Composite' },
  { key: 'growth', label: 'Growth' },
  { key: 'value', label: 'Value' },
  { key: 'quality', label: 'Quality' },
  { key: 'momentum', label: 'Momentum' },
]

function pctlOf(header: SecurityHeader, key: FactorKey): number | null {
  switch (key) {
    case 'composite':
      return header.composite
    case 'growth':
      return header.growth_pctl
    case 'value':
      return header.value_pctl
    case 'quality':
      return header.quality_pctl
    case 'momentum':
      return header.momentum_pctl
  }
}

export function FactorCards({ header }: { header: SecurityHeader }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
      {ORDER.map(({ key, label }) => {
        const v = pctlOf(header, key)
        const dark = key === 'composite'
        const bar = FACTOR_TABLE[key].bar
        return (
          <div
            key={key}
            className={
              'rounded-card border p-4 shadow-card ' +
              (dark ? 'border-[#0f172a]' : 'border-[#e5e7eb] bg-white')
            }
            style={
              dark
                ? { background: 'linear-gradient(135deg, #0f172a, #1e293b)' }
                : undefined
            }
          >
            <div
              className={
                'text-[0.78rem] font-bold uppercase tracking-[0.04em] ' +
                (dark ? 'text-[#94a3b8]' : 'text-[#6b7280]')
              }
            >
              {label}
            </div>
            <div
              className={
                'mb-2 mt-1 text-[1.8rem] font-extrabold ' +
                (v === null
                  ? dark
                    ? 'text-[#64748b]'
                    : 'text-[#9ca3af]'
                  : dark
                    ? 'text-white'
                    : 'text-[#111827]')
              }
            >
              {v === null ? DASH : v.toFixed(1)}
            </div>
            <div
              className={
                'h-[7px] overflow-hidden rounded-full ' +
                (dark ? 'bg-white/15' : 'bg-[#f3f4f6]')
              }
            >
              {v !== null && (
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, v))}%`,
                    background: dark ? '#fff' : bar,
                  }}
                />
              )}
            </div>
            <div
              className={
                'mt-[7px] text-[0.72rem] ' +
                (dark ? 'text-[#94a3b8]' : 'text-[#9ca3af]')
              }
            >
              {v === null ? 'n/a' : `Top ${Math.max(1, Math.round(100 - v))}%`}
            </div>
          </div>
        )
      })}
    </div>
  )
}
