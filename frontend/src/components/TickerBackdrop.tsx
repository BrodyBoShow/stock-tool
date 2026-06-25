/**
 * Faint scrolling stock-ticker backdrop (used behind the login screen), mirroring
 * the marketing landing page. Pure CSS marquee (keyframes in index.css), so it's
 * cheap and respects prefers-reduced-motion. Static, representative tickers — no
 * live data (decorative only).
 */

const TICKERS: ReadonlyArray<readonly [string, string, number]> = [
  ['AAPL', '229.35', 1.24], ['MSFT', '441.10', 0.62], ['NVDA', '131.26', -2.13],
  ['AMZN', '186.40', 0.91], ['GOOGL', '179.22', -0.44], ['META', '565.30', 1.83],
  ['TSLA', '248.50', -3.21], ['JPM', '214.05', 0.52], ['V', '289.66', 0.34],
  ['WMT', '81.12', 1.07], ['XOM', '114.48', -0.71], ['UNH', '512.30', 0.84],
  ['AVGO', '171.40', 2.41], ['COST', '905.10', 0.58], ['HD', '389.20', -0.49],
  ['LLY', '812.40', 1.32], ['NFLX', '702.10', 1.05], ['AMD', '158.30', -1.42],
  ['ORCL', '168.90', 0.77], ['CRM', '312.55', -0.58], ['ADBE', '556.20', 0.41],
  ['KO', '62.18', 0.19], ['PEP', '171.05', -0.33], ['DIS', '96.40', 1.12],
  ['BAC', '42.66', 0.47], ['INTC', '23.91', -1.88], ['CVX', '156.20', 0.63],
  ['MRK', '99.74', -0.52],
]

const ROWS = [
  { dir: 'tk-l', dur: '70s', rot: 0 },
  { dir: 'tk-r', dur: '95s', rot: 5 },
  { dir: 'tk-l', dur: '55s', rot: 10 },
  { dir: 'tk-r', dur: '80s', rot: 15 },
  { dir: 'tk-l', dur: '65s', rot: 20 },
  { dir: 'tk-r', dur: '105s', rot: 25 },
] as const

export function TickerBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="tk-wrap pointer-events-none absolute inset-0 z-0 flex flex-col justify-around overflow-hidden py-6 text-sm opacity-[0.12]"
    >
      {ROWS.map((row, ri) => {
        const rotated = [...TICKERS.slice(row.rot), ...TICKERS.slice(0, row.rot)]
        const doubled = [...rotated, ...rotated] // duplicate for a seamless loop
        return (
          <div key={ri} className={`tk-row ${row.dir}`} style={{ animationDuration: row.dur }}>
            {doubled.map(([sym, px, chg], i) => {
              const up = chg >= 0
              return (
                <span key={`${ri}-${sym}-${i}`} className="inline-flex items-center gap-1.5 px-6">
                  <span className="font-semibold text-slate-200">{sym}</span>
                  <span className="text-slate-400">${px}</span>
                  <span className={up ? 'text-emerald-400' : 'text-rose-400'}>
                    {up ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%
                  </span>
                </span>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
