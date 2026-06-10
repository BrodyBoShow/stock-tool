import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { FactorCards } from '@/components/deepdive/FactorCards'
import { FactorInputsTable } from '@/components/deepdive/FactorInputsTable'
import { FundamentalsTable } from '@/components/deepdive/FundamentalsTable'
import { HeaderCard } from '@/components/deepdive/HeaderCard'
import { PriceChart } from '@/components/deepdive/PriceChart'
import { ThesisPanel } from '@/components/deepdive/ThesisPanel'
import { ErrorCard } from '@/components/ErrorCard'
import { Skeleton } from '@/components/ui/skeleton'
import { WatchlistButton } from '@/components/WatchlistButton'
import { getSecurity } from '@/lib/api'

function DeepDiveSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[100px] w-full rounded-card" />
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[130px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-[400px] w-full rounded-card" />
      <Skeleton className="h-[320px] w-full rounded-card" />
    </div>
  )
}

export function DeepDivePage() {
  const { ticker = '' } = useParams<{ ticker: string }>()
  const [days, setDays] = useState(365)

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['security', ticker.toUpperCase(), days],
    queryFn: () => getSecurity(ticker, days),
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData, // range switches keep the chart mounted
  })

  const backLink = (
    <Link
      to="/"
      className="inline-flex items-center gap-1 text-[0.82rem] font-semibold text-[#64748b] hover:text-[#1e293b]"
    >
      ← Screener
    </Link>
  )

  if (isPending) {
    return (
      <div className="space-y-4">
        {backLink}
        <DeepDiveSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backLink}
        <ErrorCard error={error} onRetry={() => void refetch()} />
      </div>
    )
  }

  const { header, prices, fundamentals } = data
  const weights = header.details?.weights ?? {}
  const weightStr = Object.entries(weights)
    .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)} ${(v * 100).toFixed(0)}%`)
    .join(' · ')
  const roicIsProxy = header.details?.flags?.roic_pool === 'roa_proxy'

  return (
    <div className="space-y-5">
      {backLink}
      <HeaderCard
        header={header}
        action={<WatchlistButton ticker={header.ticker} variant="button" />}
      />

      <div>
        <FactorCards header={header} />
        <p className="mt-2 text-[0.72rem] text-[#9ca3af]">
          Cross-sectional percentile ranks within the S&amp;P 500 universe (100 =
          top), as of {header.score_date ?? 'n/a'} (nightly)
          {weightStr ? ` · Weights: ${weightStr}` : ''}.
        </p>
      </div>

      <ThesisPanel ticker={header.ticker} />

      <PriceChart
        prices={prices}
        days={days}
        onDaysChange={setDays}
        isFetching={isFetching}
      />

      <FactorInputsTable header={header} />

      <FundamentalsTable
        fundamentals={fundamentals}
        sector={header.sector}
        ticker={header.ticker}
        roicIsProxy={roicIsProxy}
      />
    </div>
  )
}
