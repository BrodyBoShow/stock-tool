import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ErrorCard } from '@/components/ErrorCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/SectionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { getFunds } from '@/lib/api'
import { plColor } from '@/lib/colors'
import { fmtPrice, fmtSignedPct } from '@/lib/format'
import type { FundRow } from '@/types/api'

const CATEGORY_ORDER = ['Commodity', 'Crypto', 'Leveraged/Inverse', 'Other']

function Ret({ v }: { v: number | null }) {
  if (v == null) return <span className="text-slate-300">—</span>
  return (
    <span className="font-semibold tabular-nums" style={{ color: plColor(v) }}>
      {fmtSignedPct(v)}
    </span>
  )
}

function FundTable({ rows }: { rows: FundRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[0.84rem]">
        <thead>
          <tr className="border-b border-[#eef1f6] text-left text-[0.66rem] font-semibold uppercase tracking-[0.09em] text-slate-400">
            <th className="py-2 pr-3">Ticker</th>
            <th className="py-2 pr-3">Name</th>
            <th className="py-2 pr-3 text-right">Price</th>
            <th className="py-2 pr-3 text-right">1W</th>
            <th className="py-2 pr-3 text-right">1M</th>
            <th className="py-2 pr-3 text-right">3M</th>
            <th className="py-2 text-right">YTD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const price = f.price ?? f.last_close
            return (
              <tr key={f.security_id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-2.5 pr-3 font-bold text-slate-800">{f.ticker}</td>
                <td className="max-w-[280px] truncate py-2.5 pr-3 text-slate-500">{f.name}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-gray-900">
                  {fmtPrice(price)}
                  {f.change_pct != null && (
                    <span
                      className="ml-1.5 text-[0.72rem] font-semibold"
                      style={{ color: plColor(f.change_pct / 100) }}
                    >
                      {f.change_pct >= 0 ? '▲' : '▼'}
                      {Math.abs(f.change_pct).toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right"><Ret v={f.r1w} /></td>
                <td className="py-2.5 pr-3 text-right"><Ret v={f.r1m} /></td>
                <td className="py-2.5 pr-3 text-right"><Ret v={f.r3m} /></td>
                <td className="py-2.5 text-right"><Ret v={f.rytd} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function FundsPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['funds'],
    queryFn: getFunds,
    staleTime: 60 * 1000,
    refetchInterval: 90 * 1000,
    refetchOnWindowFocus: true,
  })

  const byCategory = useMemo(() => {
    const m = new Map<string, FundRow[]>()
    for (const f of data?.rows ?? []) {
      const list = m.get(f.category) ?? []
      list.push(f)
      m.set(f.category, list)
    }
    // sort each category by YTD desc (nulls last)
    for (const list of m.values()) {
      list.sort((a, b) => (b.rytd ?? -Infinity) - (a.rytd ?? -Infinity))
    }
    return m
  }, [data])

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-[300px] w-full rounded-card" />
      </div>
    )
  }
  if (error) return <ErrorCard error={error} onRetry={() => void refetch()} />

  const cats = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Funds & ETFs">
        Commodity &amp; crypto ETFs and trusts (gold, silver, oil, bitcoin…). These hold
        assets rather than run a business, so they carry no factor scores — this is a
        returns view, kept separate from the operating-company screener. Price is live
        (~15-min delayed); returns are from nightly closes.
      </PageHeader>

      {data.rows.length === 0 ? (
        <SectionCard title="No funds">
          <p className="text-[0.85rem] text-gray-400">No funds classified yet.</p>
        </SectionCard>
      ) : (
        cats.map((cat) => (
          <SectionCard key={cat} title={`${cat} (${byCategory.get(cat)!.length})`}>
            <FundTable rows={byCategory.get(cat)!} />
          </SectionCard>
        ))
      )}
    </div>
  )
}
