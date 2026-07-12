import { useState } from 'react'
import type { PortfolioHolding, StressPreset } from '@/types/api'
import { plColor } from '@/lib/colors'
import { fmtPrice, fmtSignedPct } from '@/lib/format'

export interface StressTestPanelProps {
  stress: StressPreset[] // from analytics (may be empty)
  benchmark: string
  holdings: PortfolioHolding[] // for avg-cost context lines
}

function MethodChip({ method }: { method: StressPreset['method'] }): JSX.Element {
  const isReplay = method === 'replay'
  return (
    <span
      className={`text-[0.58rem] rounded px-1 font-bold ${
        isReplay ? 'bg-pos-soft text-pos' : 'bg-warn-soft text-warn'
      }`}
    >
      {isReplay ? 'replayed' : 'β-mapped est.'}
    </span>
  )
}

export function StressTestPanel({ stress, benchmark, holdings }: StressTestPanelProps): JSX.Element | null {
  const [selectedKey, setSelectedKey] = useState<string>(() => stress[0]?.key ?? '')

  if (stress.length === 0) return null

  const preset = stress.find((p) => p.key === selectedKey) ?? stress[0]

  const deltaPp = (preset.portfolio_dd - preset.bench_dd) * 100
  const deltaWorse = deltaPp < 0 // portfolio fell further than the benchmark
  const best = preset.contributors.length > 0 ? preset.contributors[preset.contributors.length - 1] : null

  const showCoverage = preset.coverage != null && preset.coverage < 0.999

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="mb-3">
        <h3 className="text-[0.82rem] font-semibold text-ink">
          Stress test — how would this portfolio have held up?
        </h3>
        <p className="mt-0.5 text-[0.66rem] text-muted">
          Historical episodes mapped to your current weights. 2022 is replayed from your holdings&apos; actual
          prices; 2008/2020 are β-mapped estimates (our price data starts 2021). Not a forecast.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        {stress.map((p) => {
          const active = p.key === preset.key
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setSelectedKey(p.key)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                active
                  ? 'border-accent bg-accent-soft ring-2 ring-accent-soft'
                  : 'border-line hover:border-accent'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.78rem] font-semibold text-ink">{p.label}</span>
                <MethodChip method={p.method} />
              </div>
              <div className="mt-0.5 text-[0.64rem] text-muted">{p.sub}</div>
            </button>
          )
        })}
      </div>

      <div className="mt-3 rounded-lg bg-surface-2 border border-line p-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[0.78rem] text-ink">Selected: {preset.label}</span>
          <MethodChip method={preset.method} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-2">
          <div>
            <div className="text-[0.6rem] uppercase text-muted">Estimated portfolio drawdown</div>
            <div className="text-[1.15rem] font-bold tabular-nums" style={{ color: '#dc2626' }}>
              {fmtSignedPct(preset.portfolio_dd)}
            </div>
          </div>
          <div>
            <div className="text-[0.6rem] uppercase text-muted">vs {benchmark}</div>
            <div className="text-[1.15rem] font-bold tabular-nums text-ink">
              {fmtSignedPct(preset.bench_dd)}
            </div>
            <div
              className="text-[0.66rem]"
              style={{ color: deltaWorse ? '#dc2626' : '#16a34a' }}
            >
              {deltaWorse
                ? `you'd have lost ${Math.abs(deltaPp).toFixed(1)} pp more`
                : `you'd have held up ${Math.abs(deltaPp).toFixed(1)} pp better`}
            </div>
          </div>
          <div>
            <div className="text-[0.6rem] uppercase text-muted">Best holdup</div>
            {best ? (
              <div
                className="text-[1.15rem] font-bold tabular-nums"
                style={{ color: best.ret > preset.portfolio_dd ? '#16a34a' : '#dc2626' }}
              >
                {best.ticker} {fmtSignedPct(best.ret)}
              </div>
            ) : (
              <div className="text-[1.15rem] font-bold tabular-nums text-muted">—</div>
            )}
          </div>
        </div>

        {showCoverage ? (
          <div className="mt-2 text-[0.66rem] text-warn">
            Covers {Math.round((preset.coverage ?? 0) * 100)}% of the book
            {preset.skipped?.length ? ` — no data for ${preset.skipped.join(', ')}` : ''}
          </div>
        ) : null}

        <div className="mt-3 text-[0.74rem]">
          <div className="text-[0.6rem] uppercase text-muted mb-1">Top contributors to loss</div>
          {preset.contributors.slice(0, 5).map((c) => {
            const holding = holdings.find((h) => h.ticker === c.ticker)
            return (
              <div key={c.ticker} className="flex gap-3 py-1 border-b border-line last:border-0 items-baseline">
                <span className="w-14 font-semibold text-ink">{c.ticker}</span>
                <span className="w-16 text-right tabular-nums" style={{ color: plColor(c.ret) }}>
                  {fmtSignedPct(c.ret)}
                </span>
                <span className="flex-1 text-muted text-[0.68rem]">
                  {holding ? `your cost ${fmtPrice(holding.avg_cost)}` : ''}
                </span>
                <span
                  className="w-20 text-right tabular-nums font-medium"
                  style={{ color: plColor(c.contrib_pp) }}
                >
                  {c.contrib_pp.toFixed(1)} pp
                </span>
              </div>
            )
          })}
        </div>

        <p className="text-[0.66rem] text-muted mt-2">{preset.note}</p>
      </div>
    </div>
  )
}
