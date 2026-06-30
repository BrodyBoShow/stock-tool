import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { pushRecent } from '@/lib/recentlyViewed'
import { DecisionBriefPanel } from '@/components/deepdive/DecisionBriefPanel'
import { FactorCards } from '@/components/deepdive/FactorCards'
import { FactorInputsTable } from '@/components/deepdive/FactorInputsTable'
import { FilingIntelligencePanel } from '@/components/deepdive/FilingIntelligencePanel'
import { FilingsListPanel } from '@/components/deepdive/FilingsListPanel'
import { FundamentalsTable } from '@/components/deepdive/FundamentalsTable'
import { EventsPanel } from '@/components/deepdive/EventsPanel'
import { HeaderCard } from '@/components/deepdive/HeaderCard'
import { InsiderPanel } from '@/components/deepdive/InsiderPanel'
import { IntrinsicValuePanel } from '@/components/deepdive/IntrinsicValuePanel'
import { MacroStrip } from '@/components/deepdive/MacroStrip'
import { PriceChart } from '@/components/deepdive/PriceChart'
import { ScoreStoryPanel } from '@/components/deepdive/ScoreStoryPanel'
import { ScoreWaterfall } from '@/components/deepdive/ScoreWaterfall'
import { ThesisPanel } from '@/components/deepdive/ThesisPanel'
import { ErrorCard } from '@/components/ErrorCard'
import { Skeleton } from '@/components/ui/skeleton'
import { WatchlistButton } from '@/components/WatchlistButton'
import { getSecurity } from '@/lib/api'

const NAV_SECTIONS = [
  { id: 'brief', label: 'Brief' },
  { id: 'story', label: 'Story' },
  { id: 'chart', label: 'Chart' },
  { id: 'score', label: 'Score' },
  { id: 'factors', label: 'Factors' },
  { id: 'value', label: 'Value' },
  { id: 'financials', label: 'Financials' },
  { id: 'filings', label: 'Filings' },
  { id: 'insiders', label: 'Insiders' },
]

function SectionNav({ ticker }: { ticker: string }) {
  const [active, setActive] = useState('brief')
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id)
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    )
    for (const s of NAV_SECTIONS) {
      const el = document.getElementById(s.id)
      if (el) observerRef.current.observe(el)
    }
    return () => observerRef.current?.disconnect()
  }, [ticker])

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav className="sticky top-0 z-30 -mx-4 flex items-center gap-1 border-b border-gray-200 bg-white/95 px-4 py-2 backdrop-blur-sm shadow-[0_1px_6px_rgba(15,23,42,0.04)]">
      <span className="mr-2 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-slate-300">
        {ticker}
      </span>
      {NAV_SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => scrollTo(s.id)}
          className={`rounded-full px-3 py-1 text-[0.72rem] font-semibold transition-all ${
            active === s.id
              ? 'bg-slate-800 text-white'
              : 'text-gray-500 hover:bg-slate-100 hover:text-slate-800'
          }`}
        >
          {s.label}
        </button>
      ))}
    </nav>
  )
}

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

  useEffect(() => {
    if (ticker) pushRecent(ticker)
  }, [ticker])

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['security', ticker.toUpperCase(), days],
    queryFn: () => getSecurity(ticker, days),
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  })

  const backLink = (
    <Link
      to="/"
      className="inline-flex items-center gap-1 text-[0.82rem] font-semibold text-slate-500 hover:text-slate-800"
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

      <SectionNav ticker={header.ticker} />

      <div id="brief">
        <DecisionBriefPanel ticker={header.ticker} />
      </div>

      <div id="story">
        <ScoreStoryPanel ticker={header.ticker} />
      </div>

      <div id="chart">
        <PriceChart
          prices={prices}
          days={days}
          onDaysChange={setDays}
          isFetching={isFetching}
          ticker={header.ticker}
        />
      </div>

      <div id="score">
        <ScoreWaterfall header={header} />
      </div>

      <div id="factors">
        <FactorCards header={header} ticker={header.ticker} />
        <p className="mt-2 text-[0.72rem] text-gray-400">
          Cross-sectional percentile ranks within the US-listed universe (100 =
          top), as of {header.score_date ?? 'n/a'} (nightly)
          {weightStr ? ` · Weights: ${weightStr}` : ''}.
        </p>
      </div>

      <div id="value">
        <IntrinsicValuePanel ticker={header.ticker} />
      </div>

      <ThesisPanel ticker={header.ticker} />

      <MacroStrip />

      <div id="financials">
        <FactorInputsTable header={header} />
      </div>

      <FundamentalsTable
        fundamentals={fundamentals}
        sector={header.sector}
        ticker={header.ticker}
        roicIsProxy={roicIsProxy}
      />

      <div id="filings" className="space-y-5">
        <EventsPanel ticker={header.ticker} />
        <FilingIntelligencePanel ticker={header.ticker} filings={data.filings} />
        <FilingsListPanel ticker={header.ticker} filings={data.filings} />
      </div>

      <div id="insiders">
        <InsiderPanel ticker={header.ticker} />
      </div>
    </div>
  )
}
