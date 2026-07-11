import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { CompareDrawer } from '@/components/deepdive/CompareDrawer'
import { AskStockBudPanel } from '@/components/deepdive/AskStockBudPanel'
import { ClinicalPipelinePanel } from '@/components/deepdive/ClinicalPipelinePanel'
import { DecisionBriefPanel } from '@/components/deepdive/DecisionBriefPanel'
import { EventsPanel } from '@/components/deepdive/EventsPanel'
import { FactorCards } from '@/components/deepdive/FactorCards'
import { FactorInputsTable } from '@/components/deepdive/FactorInputsTable'
import { FilingIntelligencePanel } from '@/components/deepdive/FilingIntelligencePanel'
import { FilingsListPanel } from '@/components/deepdive/FilingsListPanel'
import { CommodityBackdropCard } from '@/components/deepdive/CommodityBackdropCard'
import { ForwardSensitivityCard } from '@/components/deepdive/ForwardSensitivityCard'
import { FundamentalsTable } from '@/components/deepdive/FundamentalsTable'
import { HeaderCard } from '@/components/deepdive/HeaderCard'
import { InsiderPanel } from '@/components/deepdive/InsiderPanel'
import { IntrinsicValuePanel } from '@/components/deepdive/IntrinsicValuePanel'
import { MacroStrip } from '@/components/deepdive/MacroStrip'
import { NewsNarrativePanel } from '@/components/deepdive/NewsNarrativePanel'
import { OverviewPane } from '@/components/deepdive/OverviewPane'
import { PeerStrip } from '@/components/deepdive/PeerStrip'
import { PriceChart } from '@/components/deepdive/PriceChart'
import { RightRail } from '@/components/deepdive/RightRail'
import { ScoreForensicsPanel } from '@/components/deepdive/ScoreForensicsPanel'
import { ScoreStoryPanel } from '@/components/deepdive/ScoreStoryPanel'
import { ScoreWaterfall } from '@/components/deepdive/ScoreWaterfall'
import { ShortcutsOverlay } from '@/components/deepdive/ShortcutsOverlay'
import { ThesisPanel } from '@/components/deepdive/ThesisPanel'
import { ErrorCard } from '@/components/ErrorCard'
import { Skeleton } from '@/components/ui/skeleton'
import { WatchlistButton } from '@/components/WatchlistButton'
import { getSecurity } from '@/lib/api'
import { pushRecent } from '@/lib/recentlyViewed'
import { pagerFor } from '@/lib/screenerOrder'

/**
 * Deep dive — grouped-pane IA (mock: stockbud_deep_dive_mock.html).
 * 10 flat scroll-sections became 4 grouped sections of sub-panes with
 * `?pane=` routing (default: brief — the most useful landing view), a
 * breadcrumb + J/K screener pager, a right rail on the reading panes, and a
 * keyboard layer (J/K tickers · g+letter panes · ? overlay).
 */

export type PaneId =
  | 'overview' | 'brief'
  | 'story' | 'chart' | 'score' | 'factors' | 'value'
  | 'financials' | 'filings'
  | 'insiders'

const PANE_GROUPS: Array<{ label: string; panes: Array<{ id: PaneId; label: string }> }> = [
  { label: 'Summary', panes: [{ id: 'overview', label: 'Overview' }, { id: 'brief', label: 'Brief' }] },
  {
    label: 'Analysis',
    panes: [
      { id: 'story', label: 'Story' },
      { id: 'chart', label: 'Chart' },
      { id: 'score', label: 'Score' },
      { id: 'factors', label: 'Factors' },
      { id: 'value', label: 'Value' },
    ],
  },
  { label: 'Data', panes: [{ id: 'financials', label: 'Financials' }, { id: 'filings', label: 'Filings' }] },
  { label: 'Activity', panes: [{ id: 'insiders', label: 'Insiders' }] },
]

const PANE_IDS = PANE_GROUPS.flatMap((g) => g.panes.map((p) => p.id))

/** g+<key> pane jumps (spec §7.3, extended to every pane). */
const G_KEYS: Record<string, PaneId> = {
  o: 'overview', b: 'brief', s: 'story', c: 'chart', r: 'score',
  f: 'factors', v: 'value', n: 'financials', l: 'filings', i: 'insiders',
}

/** Panes that read better with the right rail; charts/tables take full width. */
const RAIL_PANES: PaneId[] = ['overview', 'brief', 'factors', 'value']

function DeepDiveSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[100px] w-full rounded-card" />
      <Skeleton className="h-9 w-full rounded-card" />
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[130px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-[400px] w-full rounded-card" />
    </div>
  )
}

export function DeepDivePage() {
  const { ticker = '' } = useParams<{ ticker: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawPane = searchParams.get('pane')
  const pane: PaneId = PANE_IDS.includes(rawPane as PaneId) ? (rawPane as PaneId) : 'brief'
  const [days, setDays] = useState(365)
  const [compareOpen, setCompareOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const pendingG = useRef(false)
  const gTimer = useRef<number | null>(null)

  useEffect(() => {
    if (ticker) pushRecent(ticker)
  }, [ticker])

  const setPane = (id: PaneId) => {
    setSearchParams(id === 'brief' ? {} : { pane: id })
    window.scrollTo({ top: 0 })
  }

  const pager = pagerFor(ticker)

  // Keyboard layer: J/K ticker pager, g+<key> pane jumps, ? shortcuts, Esc.
  // The effect only wires the listener; handlers do the navigation/setState.
  useEffect(() => {
    const goto = (t: string | null) => {
      if (t) navigate(`/securities/${t}${window.location.search}`)
    }
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      const typing =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable
      if (e.key === 'Escape') {
        setShortcutsOpen(false)
        setCompareOpen(false)
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (pendingG.current) {
        pendingG.current = false
        if (gTimer.current) window.clearTimeout(gTimer.current)
        const target = G_KEYS[e.key.toLowerCase()]
        if (target) {
          e.preventDefault()
          setPane(target)
        }
        return
      }
      if (e.key === 'g') {
        pendingG.current = true
        gTimer.current = window.setTimeout(() => {
          pendingG.current = false
        }, 900)
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
      } else if (e.key === 'j' || e.key === 'J') {
        goto(pagerFor(ticker)?.next ?? null)
      } else if (e.key === 'k' || e.key === 'K') {
        goto(pagerFor(ticker)?.prev ?? null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, navigate])

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['security', ticker.toUpperCase(), days],
    queryFn: () => getSecurity(ticker, days),
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  })

  // Breadcrumb + pager strip (always rendered, even while loading).
  const crumb = (
    <div className="flex flex-wrap items-center gap-2 text-[0.78rem]">
      <Link to="/" className="font-semibold text-muted hover:text-accent">
        ← Screener
      </Link>
      <span className="text-subtle">/</span>
      <span className="text-subtle">Securities</span>
      <span className="text-subtle">/</span>
      <span className="font-semibold text-ink">{ticker.toUpperCase()}</span>
      {pager && (
        <span className="ml-auto flex items-center gap-1.5 text-[0.7rem] text-subtle">
          Screener result {pager.index} of {pager.total}
          <button
            type="button"
            disabled={!pager.prev}
            onClick={() => pager.prev && navigate(`/securities/${pager.prev}${window.location.search}`)}
            title="Previous ticker (K)"
            className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[0.68rem] text-muted hover:border-accent hover:text-accent disabled:opacity-40"
          >
            ← K
          </button>
          <button
            type="button"
            disabled={!pager.next}
            onClick={() => pager.next && navigate(`/securities/${pager.next}${window.location.search}`)}
            title="Next ticker (J)"
            className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[0.68rem] text-muted hover:border-accent hover:text-accent disabled:opacity-40"
          >
            J →
          </button>
        </span>
      )}
      <button
        type="button"
        onClick={() => setShortcutsOpen(true)}
        title="Keyboard shortcuts (?)"
        className={`rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[0.68rem] text-subtle hover:border-accent hover:text-accent ${pager ? '' : 'ml-auto'}`}
      >
        ?
      </button>
    </div>
  )

  if (isPending) {
    return (
      <div className="space-y-4">
        {crumb}
        <DeepDiveSkeleton />
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-4">
        {crumb}
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
  const showRail = RAIL_PANES.includes(pane)

  const paneBody = (
    <div className="min-h-[60vh] space-y-5">
      {pane === 'overview' && (
        <div className="space-y-4">
          <OverviewPane
            header={header}
            prices={prices}
            fundamentals={fundamentals}
            filings={data.filings}
            onNavigate={setPane}
          />
          <NewsNarrativePanel ticker={header.ticker} />
        </div>
      )}

      {pane === 'brief' && (
        <>
          <DecisionBriefPanel
            ticker={header.ticker}
            header={header}
            onOpenDiligence={() => setSearchParams({ pane: 'filings', filing: 'diligence' })}
          />
          <AskStockBudPanel key={header.ticker} ticker={header.ticker} />
          {header.sector === 'Health Care' && (
            <ClinicalPipelinePanel ticker={header.ticker} />
          )}
          <ThesisPanel ticker={header.ticker} />
        </>
      )}

      {pane === 'story' && (
        <>
          <ScoreStoryPanel ticker={header.ticker} />
          <ScoreForensicsPanel ticker={header.ticker} />
          <ScoreWaterfall header={header} />
        </>
      )}

      {pane === 'chart' && (
        <PriceChart
          prices={prices}
          days={days}
          onDaysChange={setDays}
          isFetching={isFetching}
          ticker={header.ticker}
          filings={data.filings}
        />
      )}

      {pane === 'score' && <FactorInputsTable header={header} />}

      {pane === 'factors' && (
        <>
          <FactorCards header={header} ticker={header.ticker} prices={prices} />
          <p className="text-[0.72rem] text-subtle">
            Cross-sectional percentile ranks within the US-listed universe (100 = top),
            as of {header.score_date ?? 'n/a'} (nightly)
            {weightStr ? ` · Weights: ${weightStr}` : ''}.
          </p>
          <PeerStrip ticker={header.ticker} composite={header.composite} />
        </>
      )}

      {pane === 'value' && (
        <>
          {data?.commodity_backdrops && data.commodity_backdrops.length > 0 ? (
            <CommodityBackdropCard backdrops={data.commodity_backdrops} />
          ) : data?.forward_sensitivity ? (
            <ForwardSensitivityCard sensitivity={data.forward_sensitivity} />
          ) : null}
          <IntrinsicValuePanel ticker={header.ticker} />
          <MacroStrip />
        </>
      )}

      {pane === 'financials' && (
        <>
          <FundamentalsTable
            fundamentals={fundamentals}
            sector={header.sector}
            ticker={header.ticker}
            roicIsProxy={roicIsProxy}
          />
          <EventsPanel ticker={header.ticker} />
        </>
      )}

      {pane === 'filings' && (
        <>
          <FilingIntelligencePanel ticker={header.ticker} filings={data.filings} />
          <FilingsListPanel ticker={header.ticker} filings={data.filings} />
        </>
      )}

      {pane === 'insiders' && <InsiderPanel ticker={header.ticker} />}
    </div>
  )

  return (
    <div className="space-y-4">
      {crumb}

      <HeaderCard
        header={header}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[0.78rem] font-bold text-muted transition-colors hover:border-accent hover:text-accent"
            >
              Compare
            </button>
            <WatchlistButton ticker={header.ticker} variant="button" />
          </div>
        }
      />

      {/* grouped pane nav — Summary | Analysis | Data | Activity */}
      <nav
        aria-label="Deep-dive sections"
        className="sticky top-0 z-30 -mx-4 overflow-x-auto border-b border-line bg-surface px-4 backdrop-blur-sm"
      >
        <div className="flex items-center gap-4">
          {PANE_GROUPS.map((g) => (
            <div key={g.label} className="flex items-center gap-1.5">
              <span className="mr-1 flex h-5 items-center rounded bg-surface-3 px-1.5 text-[0.66rem] font-bold uppercase tracking-[0.08em] text-muted">
                {g.label}
              </span>
              {g.panes.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-current={pane === p.id ? 'page' : undefined}
                  onClick={() => setPane(p.id)}
                  className={`whitespace-nowrap border-b-2 px-2.5 py-2 text-[0.78rem] transition-colors ${
                    pane === p.id
                      ? 'border-accent font-semibold text-ink'
                      : 'border-transparent text-muted hover:text-ink'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>

      {showRail ? (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-8">{paneBody}</div>
          <div className="col-span-12 lg:col-span-4">
            <RightRail
              pane={pane}
              header={header}
              fundamentals={fundamentals}
              onNavigate={setPane}
              onCompare={() => setCompareOpen(true)}
            />
          </div>
        </div>
      ) : (
        paneBody
      )}

      <CompareDrawer
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        baseTicker={header.ticker}
      />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}
