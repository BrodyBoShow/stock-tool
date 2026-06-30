import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { scoreHeat } from '@/lib/colors'
import { getBriefStatus, getPeers } from '@/lib/api'
import { DASH, fmtMoney } from '@/lib/format'
import type { PeerRow } from '@/types/api'

const xMult = (v: number | null) => (v == null ? DASH : `${v.toFixed(1)}×`)
const pctYield = (v: number | null) => (v == null ? DASH : `${(v * 100).toFixed(1)}%`)

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function Chip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[0.62rem] font-bold uppercase tracking-[0.05em] text-slate-400">{label}</div>
      <div className="numeric text-[0.92rem] font-extrabold text-slate-800">{value}</div>
      {sub && <div className="text-[0.62rem] text-slate-400">{sub}</div>}
    </div>
  )
}

function Cell({ children, heat }: { children: React.ReactNode; heat?: number | null }) {
  return (
    <td
      className="numeric px-2.5 py-1.5 text-right text-[0.8rem] font-semibold text-slate-700"
      style={heat != null ? { background: scoreHeat(heat).tint } : undefined}
    >
      {children}
    </td>
  )
}

/** 3-layer context (universe / sector / peers) + a same-sector peer comparison
 *  by nearest market cap. Composite IS the universe percentile, so universe
 *  "top X%" = 100 − composite; rank comes from the cached brief trend. */
export function PeerStrip({ ticker, composite }: { ticker: string; composite: number | null }) {
  const { data } = useQuery({
    queryKey: ['peers', ticker],
    queryFn: () => getPeers(ticker),
    staleTime: 10 * 60 * 1000,
  })
  const { data: brief } = useQuery({
    queryKey: ['brief', ticker],
    queryFn: () => getBriefStatus(ticker),
    staleTime: 5 * 60 * 1000,
  })

  if (!data || data.peers.length < 2) return null
  const rank = brief?.trend?.[brief.trend.length - 1]?.rank ?? null
  const others = data.peers.filter((p) => !p.is_focal)
  const focal = data.peers.find((p) => p.is_focal)

  // peer rank by composite (1 = best in the strip)
  const byComp = [...data.peers].sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1))
  const peerRank = byComp.findIndex((p) => p.is_focal) + 1

  // valuation discount vs peer median
  const medPe = median(others.map((p) => p.pe).filter((v): v is number => v != null && v > 0))
  const medEv = median(others.map((p) => p.ev_ebitda).filter((v): v is number => v != null && v > 0))
  const peDisc = focal?.pe != null && medPe ? focal.pe / medPe - 1 : null
  const evDisc = focal?.ev_ebitda != null && medEv ? focal.ev_ebitda / medEv - 1 : null
  const discBits: string[] = []
  if (peDisc != null && Math.abs(peDisc) >= 0.05)
    discBits.push(`${Math.abs(peDisc * 100).toFixed(0)}% ${peDisc < 0 ? 'discount' : 'premium'} on P/E`)
  if (evDisc != null && Math.abs(evDisc) >= 0.05)
    discBits.push(`${Math.abs(evDisc * 100).toFixed(0)}% on EV/EBITDA`)

  return (
    <section className="overflow-hidden rounded-card border border-gray-200 bg-white shadow-card">
      <div className="px-4 pb-2 pt-3.5">
        <div className="text-base font-bold text-gray-900">Peers &amp; context</div>
        <div className="mt-0.5 text-[0.78rem] text-gray-500">
          Closest {others.length} by market cap in {data.sector}
        </div>
      </div>

      {/* 3-layer context */}
      <div className="grid grid-cols-3 gap-2 px-4 pb-2.5">
        <Chip
          label="Universe"
          value={composite == null ? DASH : `Top ${Math.max(1, Math.round(100 - composite))}%`}
          sub={rank != null ? `rank #${rank} of all` : 'percentile rank'}
        />
        <Chip
          label="Sector"
          value={data.sector_pctl == null ? DASH : `Top ${Math.max(1, 100 - data.sector_pctl)}%`}
          sub={`of ${data.sector_count} ${data.sector}`}
        />
        <Chip label="Peers" value={`#${peerRank} of ${data.peers.length}`} sub="by composite" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-y border-gray-100 bg-gray-50 text-[0.64rem] font-bold uppercase tracking-[0.05em] text-slate-400">
              <th className="px-3 py-1.5 text-left">Company</th>
              <th className="px-2.5 py-1.5 text-right">Comp</th>
              <th className="px-2.5 py-1.5 text-right">P/E</th>
              <th className="px-2.5 py-1.5 text-right">EV/EBITDA</th>
              <th className="px-2.5 py-1.5 text-right">FCF yld</th>
              <th className="px-3 py-1.5 text-right">Mkt cap</th>
            </tr>
          </thead>
          <tbody>
            {data.peers.map((p: PeerRow) => (
              <tr
                key={p.ticker}
                className={
                  'border-b border-gray-50 ' + (p.is_focal ? 'bg-indigo-50/50' : 'hover:bg-slate-50')
                }
              >
                <td className="px-3 py-1.5">
                  {p.is_focal ? (
                    <span className="text-[0.82rem] font-extrabold text-gray-900">
                      {p.ticker}
                      <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-px text-[0.58rem] font-bold text-indigo-700">
                        you
                      </span>
                    </span>
                  ) : (
                    <Link
                      to={`/securities/${p.ticker}`}
                      className="text-[0.82rem] font-bold text-gray-800 hover:text-indigo-600 hover:underline"
                    >
                      {p.ticker}
                    </Link>
                  )}
                </td>
                <Cell heat={p.composite}>{p.composite == null ? DASH : p.composite.toFixed(1)}</Cell>
                <Cell>{xMult(p.pe)}</Cell>
                <Cell>{xMult(p.ev_ebitda)}</Cell>
                <Cell>{pctYield(p.fcf_yield)}</Cell>
                <td className="numeric px-3 py-1.5 text-right text-[0.78rem] text-slate-500">
                  {fmtMoney(p.market_cap)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {discBits.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2.5 text-[0.8rem] text-slate-600">
          {ticker} trades at a <span className="font-semibold">{discBits.join(', ')}</span> vs the
          peer median.
        </div>
      )}
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-[0.7rem] text-gray-400">
        Same-sector names nearest by market cap · valuation from the latest nightly snapshot ·
        click a peer to open its deep-dive.
      </div>
    </section>
  )
}
