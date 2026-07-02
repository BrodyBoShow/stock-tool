import { useState } from 'react'

import { SectionCard } from '@/components/ui/SectionCard'
import { sectorColor } from '@/components/portfolio/portfolioUi'
import { fmtMoney } from '@/lib/format'
import type {
  PortfolioAllocation,
  PortfolioFactorTilt,
  PortfolioHolding,
} from '@/types/api'

// ---------------------------------------------------------------------------
// FactorTiltRadar
// ---------------------------------------------------------------------------

export interface FactorTiltRadarProps {
  tilt: PortfolioFactorTilt
}

const RADAR_R = 90

/** Axis order: Growth (top), Value (right), Quality (bottom), Momentum (left). */
const RADAR_AXES: { name: string; dx: number; dy: number; lx: number; ly: number }[] = [
  { name: 'Growth', dx: 0, dy: -1, lx: 0, ly: -(RADAR_R + 18) },
  { name: 'Value', dx: 1, dy: 0, lx: RADAR_R + 16, ly: -3 },
  { name: 'Quality', dx: 0, dy: 1, lx: 0, ly: RADAR_R + 14 },
  { name: 'Momentum', dx: -1, dy: 0, lx: -(RADAR_R + 16), ly: -3 },
]

function ringPoints(r: number): string {
  return `0,${-r} ${r},0 0,${r} ${-r},0`
}

/** Radar of the portfolio's market-value-weighted factor percentiles vs the
 * universe median (50th percentile — the honest "neutral" for percentile scores). */
export function FactorTiltRadar({ tilt }: FactorTiltRadarProps) {
  const vals = [
    tilt.growth_pctl ?? 50,
    tilt.value_pctl ?? 50,
    tilt.quality_pctl ?? 50,
    tilt.momentum_pctl ?? 50,
  ]

  // You polygon points + vertex dots (plain loops — no closure accumulation).
  let youPoints = ''
  const dots: JSX.Element[] = []
  for (let i = 0; i < RADAR_AXES.length; i++) {
    const ax = RADAR_AXES[i]
    const r = (vals[i] / 100) * RADAR_R
    const x = ax.dx * r
    const y = ax.dy * r
    youPoints += `${youPoints ? ' ' : ''}${x},${y}`
    dots.push(<circle key={ax.name} cx={x} cy={y} r={2.5} fill="#7c3aed" />)
  }

  // Biggest tilt = largest distance from the neutral 50th percentile.
  let biggestIdx = 0
  let biggestDist = -1
  for (let i = 0; i < vals.length; i++) {
    const d = Math.abs(vals[i] - 50)
    if (d > biggestDist) {
      biggestDist = d
      biggestIdx = i
    }
  }
  const biggestName = RADAR_AXES[biggestIdx].name
  const biggestPctl = Math.round(vals[biggestIdx])
  const biggestDiff = biggestPctl - 50

  return (
    <SectionCard
      title="Factor tilt"
      hint="Market-value-weighted factor percentiles of your holdings vs a universe-neutral 50th percentile. Catches accidental style bets."
    >
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 260 240" className="w-[260px] flex-none" role="img" aria-label="Factor tilt radar">
          <g transform="translate(130,120)">
            {/* Guide rings (percentile grid) */}
            <polygon points={ringPoints(RADAR_R)} fill="none" stroke="#e2e8f0" strokeWidth={1} />
            <polygon points={ringPoints(0.75 * RADAR_R)} fill="none" stroke="#e2e8f0" strokeWidth={1} />
            <polygon points={ringPoints(0.5 * RADAR_R)} fill="none" stroke="#cbd5e1" strokeWidth={1.2} />
            <polygon points={ringPoints(0.25 * RADAR_R)} fill="none" stroke="#e2e8f0" strokeWidth={1} />
            {/* Axis lines */}
            {RADAR_AXES.map((ax) => (
              <line
                key={ax.name}
                x1={0}
                y1={0}
                x2={ax.dx * RADAR_R}
                y2={ax.dy * RADAR_R}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
            ))}
            {/* Universe median (50th percentile on every axis) */}
            <polygon
              points={ringPoints(0.5 * RADAR_R)}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={1.5}
              strokeDasharray="4,3"
            />
            {/* Your portfolio */}
            <polygon points={youPoints} fill="rgba(139,92,246,0.25)" stroke="#8b5cf6" strokeWidth={2} />
            {dots}
            {/* Axis labels */}
            {RADAR_AXES.map((ax, i) => (
              <text
                key={ax.name}
                x={ax.lx}
                y={ax.ly}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="#64748b"
              >
                {ax.name}
                <tspan x={ax.lx} dy={10} fontSize={8} fontWeight={400} fill="#94a3b8">
                  ({Math.round(vals[i])})
                </tspan>
              </text>
            ))}
          </g>
        </svg>

        <div className="flex-1 text-[0.72rem] text-slate-600">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 flex-none rounded-sm"
              style={{ backgroundColor: 'rgba(139,92,246,0.35)', border: '1.5px solid #8b5cf6' }}
            />
            <span className="font-medium text-slate-700">You</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className="h-3 w-3 flex-none rounded-sm"
              style={{ border: '1.5px dashed #3b82f6' }}
            />
            <span className="font-medium text-slate-700">Universe median (50th)</span>
          </div>
          <p className="mt-3">
            Biggest tilt: {biggestName} ({biggestPctl}th — {biggestDiff > 0 ? '+' : ''}
            {biggestDiff} vs neutral).
          </p>
          {tilt.coverage < 0.999 && (
            <p className="mt-1.5 text-[0.66rem] text-slate-400">
              Scores cover {Math.round(tilt.coverage * 100)}% of position value.
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// AllocationPanel
// ---------------------------------------------------------------------------

export interface AllocationPanelProps {
  holdings: PortfolioHolding[]
  allocation: PortfolioAllocation
}

type AllocTab = 'sector' | 'industry'

const INDUSTRY_PALETTE = [
  '#3b82f6',
  '#8b5cf6',
  '#b45309',
  '#15803d',
  '#0d9488',
  '#dc2626',
  '#64748b',
  '#a16207',
]

interface AllocRow {
  name: string
  value: number
  weight: number
  color: string
}

const DONUT_C = 2 * Math.PI * 70

/** Donut + legend of where the position value sits, by GICS sector or by the
 * finer industry grouping (the view that exposes concentration the sector pie hides). */
export function AllocationPanel({ holdings, allocation }: AllocationPanelProps) {
  const [tab, setTab] = useState<AllocTab>('sector')

  // --- Sector rows (weights are of position value, from the API) -----------
  let sectorTotal = 0
  for (const s of allocation.sectors) sectorTotal += s.value
  const sectorRows: AllocRow[] = []
  for (const s of allocation.sectors) {
    sectorRows.push({
      name: s.sector,
      value: s.value,
      weight: s.weight ?? (sectorTotal > 0 ? s.value / sectorTotal : 0),
      color: sectorColor(s.sector),
    })
  }
  sectorRows.sort((a, b) => b.value - a.value)

  // --- Industry rows (aggregated client-side from holdings) ----------------
  const industryTotals: Record<string, number> = {}
  let industryTotal = 0
  for (const h of holdings) {
    const mv = h.market_value
    if (mv == null || mv <= 0) continue
    const key = h.industry ?? 'Unknown'
    industryTotals[key] = (industryTotals[key] ?? 0) + mv
    industryTotal += mv
  }
  const industryRows: AllocRow[] = []
  for (const name of Object.keys(industryTotals)) {
    industryRows.push({
      name,
      value: industryTotals[name],
      weight: industryTotal > 0 ? industryTotals[name] / industryTotal : 0,
      color: '',
    })
  }
  industryRows.sort((a, b) => b.value - a.value)
  for (let i = 0; i < industryRows.length; i++) {
    industryRows[i].color = INDUSTRY_PALETTE[i % INDUSTRY_PALETTE.length]
  }

  const rows = tab === 'sector' ? sectorRows : industryRows
  const total = tab === 'sector' ? sectorTotal : industryTotal

  // --- Donut slices (plain for..of, cumulative offset — no closure mutation)
  const slices: JSX.Element[] = []
  let cum = 0
  for (const row of rows) {
    const frac = total > 0 ? row.value / total : 0
    if (frac <= 0) continue
    slices.push(
      <circle
        key={row.name}
        cx={100}
        cy={100}
        r={70}
        fill="none"
        stroke={row.color}
        strokeWidth={28}
        strokeDasharray={`${frac * DONUT_C} ${DONUT_C}`}
        strokeDashoffset={-cum * DONUT_C}
        transform="rotate(-90 100 100)"
      />,
    )
    cum += frac
  }

  // --- Legend rows (append Cash when tracked) -------------------------------
  const legendRows: AllocRow[] = [...rows]
  if (allocation.cash != null) {
    const denom = sectorTotal + allocation.cash
    legendRows.push({
      name: 'Cash',
      value: allocation.cash,
      weight: denom > 0 ? allocation.cash / denom : 0,
      color: '#94a3b8',
    })
  }

  let hasConcentratedSector = false
  for (const s of sectorRows) {
    if (s.weight > 0.4) hasConcentratedSector = true
  }

  const tabBtn = (key: AllocTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`rounded-full px-3 py-1 text-[0.7rem] font-semibold transition-colors ${
        tab === key
          ? 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-600'
          : 'text-gray-500 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  )

  return (
    <section className="rounded-card border border-gray-200 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-bold text-gray-900">Allocation</div>
          <p className="mt-0.5 text-[0.78rem] text-gray-400">
            Where the money sits — GICS sector or finer industry. Industry view reveals
            concentration the sector pie hides.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {tabBtn('sector', 'By Sector')}
          {tabBtn('industry', 'By Sub-industry')}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-5">
        <svg viewBox="0 0 200 200" className="w-[190px] flex-none" role="img" aria-label="Allocation donut">
          {slices}
          <text x={100} y={97} textAnchor="middle" fontSize={12} fontWeight={700} fill="#0f172a">
            {fmtMoney(total)}
          </text>
          <text x={100} y={112} textAnchor="middle" fontSize={9} fill="#94a3b8">
            {holdings.length} positions
          </text>
        </svg>

        <div className="min-w-0 flex-1">
          <div className="space-y-1.5">
            {legendRows.map((row) => (
              <div key={row.name} className="flex items-center gap-2 text-[0.75rem]">
                <span className="h-3 w-3 flex-none rounded" style={{ backgroundColor: row.color }} />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{row.name}</span>
                <span className="tabular-nums text-slate-600">{(row.weight * 100).toFixed(0)}%</span>
                {row.weight > 0.4 && <span className="text-amber-600">⚠</span>}
              </div>
            ))}
          </div>
          {tab === 'sector' && hasConcentratedSector && (
            <p className="mt-3 text-[0.7rem] text-amber-600">
              ⚠ Check the Sub-industry tab — sector concentration can hide deeper overlap (e.g.
              multiple semis-adjacent names).
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
