import { useMemo } from 'react'

import { InfoTip } from '@/components/ui/InfoTip'
import { fmtSignedPct } from '@/lib/format'
import type { EnrichedFund } from '@/types/api'

export interface CategoryHeatmapProps {
  funds: EnrichedFund[]
  onSelect: (categoryKey: string) => void
}

interface Bucket {
  name: string // display label (finer Morningstar category, or the coarse bucket)
  coarse: string // parent coarse category — the drill-in target
  count: number
  aum: number
  avg: number | null // average 1-day return across the bucket
}

/**
 * Soft (never saturated) heat tint from a daily return: a subtle pos/neg wash
 * scaled by magnitude, with the % rendered in the matching semantic color. This
 * is the "soft tints, never saturated fills" treatment from the spec mock — a
 * scannable field of tints rather than a wall of bold blocks.
 */
function tint(ret: number | null): { bg: string; fg: string } {
  if (ret == null || Number.isNaN(ret)) return { bg: 'var(--surface-2)', fg: 'var(--muted)' }
  const mag = Math.min(Math.abs(ret) / 0.02, 1) // saturate at ±2%
  const pct = (7 + mag * 21).toFixed(1) // 7% → 28% tint
  const token = ret >= 0 ? 'var(--pos)' : 'var(--neg)'
  return { bg: `color-mix(in srgb, ${token} ${pct}%, transparent)`, fg: token }
}

/**
 * Aggregate funds into heatmap buckets. Prefer the finer Morningstar
 * `category_name` (a denser, richer grid) and remember each bucket's dominant
 * coarse parent for drill-in; fall back to the 4 coarse buckets when the finer
 * labels are too sparse (< 6 usable buckets) to make a useful grid.
 */
function aggregate(funds: EnrichedFund[]): Bucket[] {
  const fine = new Map<
    string,
    { name: string; coarse: Map<string, number>; count: number; aum: number; sumR: number; nR: number }
  >()
  for (const f of funds) {
    const name = (f.category_name && f.category_name.trim()) || f.category || 'Other'
    const b = fine.get(name) ?? { name, coarse: new Map(), count: 0, aum: 0, sumR: 0, nR: 0 }
    b.count += 1
    b.aum += f.aum ?? 0
    b.coarse.set(f.category, (b.coarse.get(f.category) ?? 0) + 1)
    if (f.r1d != null) {
      b.sumR += f.r1d
      b.nR += 1
    }
    fine.set(name, b)
  }
  const finalize = (b: {
    name: string
    coarse: Map<string, number>
    count: number
    aum: number
    sumR: number
    nR: number
  }): Bucket => ({
    name: b.name,
    coarse: [...b.coarse.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? 'Other',
    count: b.count,
    aum: b.aum,
    avg: b.nR ? b.sumR / b.nR : null,
  })

  const fineBuckets = [...fine.values()].filter((b) => b.count >= 2).map(finalize)
  if (fineBuckets.length >= 6) {
    return fineBuckets.sort((a, b) => b.aum - a.aum).slice(0, 24)
  }

  // Fallback: the 4 coarse buckets (each is its own drill-in target).
  const coarse = new Map<string, { count: number; aum: number; sumR: number; nR: number }>()
  for (const f of funds) {
    const k = f.category || 'Other'
    const b = coarse.get(k) ?? { count: 0, aum: 0, sumR: 0, nR: 0 }
    b.count += 1
    b.aum += f.aum ?? 0
    if (f.r1d != null) {
      b.sumR += f.r1d
      b.nR += 1
    }
    coarse.set(k, b)
  }
  return [...coarse.entries()]
    .map(([k, b]) => ({ name: k, coarse: k, count: b.count, aum: b.aum, avg: b.nR ? b.sumR / b.nR : null }))
    .sort((a, b) => b.aum - a.aum)
}

export function CategoryHeatmap({ funds, onSelect }: CategoryHeatmapProps): JSX.Element {
  const buckets = useMemo(() => aggregate(funds), [funds])

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[0.82rem] font-bold text-ink">Category Heatmap</span>
          <InfoTip text="Each fund category's average 1-day return. A softer tint is a smaller move; green = up, red = down. Click a tile to drill into its group." />
        </div>
        {/* Worst ←→ Best legend */}
        <div className="flex flex-none items-center gap-1.5 text-[0.56rem] font-bold uppercase tracking-[0.07em] text-subtle">
          Worst
          <span
            className="h-2 w-16 rounded-full"
            style={{ background: 'linear-gradient(90deg, var(--neg), var(--surface-2) 50%, var(--pos))' }}
          />
          Best
        </div>
      </div>

      {buckets.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded border border-dashed border-line text-[0.7rem] text-subtle">
          No categories to display
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {buckets.map((b) => {
            const t = tint(b.avg)
            return (
              <button
                key={b.name}
                type="button"
                onClick={() => onSelect(b.coarse)}
                title={`${b.name} · ${b.count} fund${b.count === 1 ? '' : 's'} · avg ${fmtSignedPct(b.avg)}`}
                className="flex min-h-[52px] flex-col justify-between rounded-md border border-line px-2.5 py-2 text-left transition hover:border-accent"
                style={{ background: t.bg }}
              >
                <div className="truncate text-[0.58rem] font-bold uppercase tracking-[0.04em] text-muted">
                  {b.name}
                </div>
                <div
                  className="numeric mt-1 text-[0.92rem] font-bold leading-none tabular-nums"
                  style={{ color: t.fg }}
                >
                  {fmtSignedPct(b.avg)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
