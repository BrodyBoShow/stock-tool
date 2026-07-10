import type {
  AlertRule,
  AlertRuleCreate,
  AlertsResponse,
  BacktestRunResponse,
  FundsResponse,
  FundsOverviewResponse,
  FundDetailResponse,
  FundsBridgeResponse,
  FundOverlapResponse,
  BriefStatusResponse,
  DecisionBrief,
  EventsResponse,
  ValuationResponse,
  FilingAnswers,
  FilingQaStatusResponse,
  FilingSummary,
  InsiderResponse,
  LinkConnectResponse,
  LinkedAccountsResponse,
  LinkSyncResponse,
  LiveFactorsResponse,
  NewsNarrativeResponse,
  MacroLatestResponse,
  MacroSeriesResponse,
  MarketBriefResponse,
  MarketOverviewResponse,
  MarketPulseResponse,
  PeerStripResponse,
  PortfolioMutationResponse,
  PortfolioAnalyticsResponse,
  PortfolioResponse,
  ProjectionResponse,
  ProjectionRunRequest,
  PortfolioTransactionCreate,
  PortfolioTransactionsResponse,
  QuotesResponse,
  TickerTapeResponse,
  RiskAlignmentResponse,
  RiskProfileResponse,
  ScreenerResponse,
  SearchResponse,
  SecurityResponse,
  SummaryStatusResponse,
  ThesesResponse,
  ThesisMutationResponse,
  ThesisUpsertRequest,
  WatchlistMutationResponse,
  WatchlistChangesResponse,
  WatchlistPlanResponse,
  WatchlistPlanUpdate,
  WatchlistResponse,
  WhatsChangedResponse,
} from '@/types/api'

import { supabase } from '@/lib/supabase'

/** Single config point for the API origin — components never hardcode it. */
const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

/**
 * The current Supabase access token, kept in a module-level cache so request
 * helpers stay synchronous. Seeded once from getSession() and then updated by
 * onAuthStateChange (login, logout, and the SDK's silent token refresh all
 * fire this), so it tracks the live session without an await per request.
 */
let accessToken: string | null = null

void supabase.auth.getSession().then(({ data }) => {
  accessToken = data.session?.access_token ?? null
})
supabase.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token ?? null
})

/** Headers common to every request, including the bearer token when signed in. */
function authHeaders(base: Record<string, string>): Record<string, string> {
  return accessToken ? { ...base, Authorization: `Bearer ${accessToken}` } : base
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * On a 401, force a token refresh once and report whether it produced a new
 * token to retry with. If the refresh fails (refresh token expired/revoked),
 * sign out so AuthGate falls back to the login screen instead of looping.
 */
async function refreshAccessToken(): Promise<boolean> {
  const { data, error } = await supabase.auth.refreshSession()
  const token = data.session?.access_token ?? null
  if (error || !token) {
    await supabase.auth.signOut()
    accessToken = null
    return false
  }
  accessToken = token
  return true
}

/** Pull `detail` out of a JSON error body, falling back to the status text. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string }
    if (body.detail) return body.detail
  } catch {
    /* non-JSON error body — keep statusText */
  }
  return res.statusText
}

async function getJson<T>(path: string): Promise<T> {
  const run = (): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      headers: authHeaders({ Accept: 'application/json' }),
    })

  let res: Response
  try {
    res = await run()
    if (res.status === 401 && (await refreshAccessToken())) {
      res = await run()
    }
  } catch {
    throw new ApiError(0, 'API unreachable — is the FastAPI server running?')
  }
  if (!res.ok) {
    throw new ApiError(res.status, await errorDetail(res))
  }
  return (await res.json()) as T
}

export function getQuotes(): Promise<QuotesResponse> {
  return getJson<QuotesResponse>('/quotes')
}

export function getTickerTape(): Promise<TickerTapeResponse> {
  return getJson<TickerTapeResponse>('/market/ticker-tape')
}

export function getScreener(completeOnly = true): Promise<ScreenerResponse> {
  return getJson<ScreenerResponse>(`/screener?complete_only=${completeOnly}`)
}

export function getBacktest(config?: string): Promise<BacktestRunResponse> {
  const qs = config ? `?config=${encodeURIComponent(config)}` : ''
  return getJson<BacktestRunResponse>(`/lab/backtest${qs}`)
}

export function getSecurity(ticker: string, days?: number): Promise<SecurityResponse> {
  const qs = days ? `?days=${days}` : ''
  return getJson<SecurityResponse>(`/securities/${encodeURIComponent(ticker)}${qs}`)
}

/** Writes (POST/PUT/DELETE). 204 responses resolve to undefined. */
async function sendJson<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const run = (): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      method,
      headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  let res: Response
  try {
    res = await run()
    if (res.status === 401 && (await refreshAccessToken())) {
      res = await run()
    }
  } catch {
    throw new ApiError(0, 'API unreachable — is the FastAPI server running?')
  }
  if (!res.ok) {
    throw new ApiError(res.status, await errorDetail(res))
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function getRiskProfile(): Promise<RiskProfileResponse> {
  return getJson<RiskProfileResponse>('/settings/risk-profile')
}

export function getRiskAlignment(
  benchmark = 'SPY',
  sector?: string,
): Promise<RiskAlignmentResponse> {
  const q = new URLSearchParams({ benchmark })
  if (sector) q.set('sector', sector)
  return getJson<RiskAlignmentResponse>(`/portfolio/risk-alignment?${q.toString()}`)
}

/** Set the risk profile from quiz answers OR a direct manual pick. The server
 * derives the profile/bands/guardrails — the client never sends them. */
export function putRiskProfile(
  body: { answers: Record<string, number> } | { profile: string },
): Promise<RiskProfileResponse> {
  return sendJson<RiskProfileResponse>('PUT', '/settings/risk-profile', body)
}

export function getWatchlist(): Promise<WatchlistResponse> {
  return getJson<WatchlistResponse>('/watchlist')
}

export function getWatchlistChanges(): Promise<WatchlistChangesResponse> {
  return getJson<WatchlistChangesResponse>('/watchlist/changes')
}

export function getAlerts(): Promise<AlertsResponse> {
  return getJson<AlertsResponse>('/alerts')
}

export function getFunds(): Promise<FundsResponse> {
  return getJson<FundsResponse>('/funds')
}

export function getFundsOverview(): Promise<FundsOverviewResponse> {
  return getJson<FundsOverviewResponse>('/funds/overview')
}

export function getFundDetail(ticker: string): Promise<FundDetailResponse> {
  return getJson<FundDetailResponse>(`/funds/${encodeURIComponent(ticker)}`)
}

export function getFundsBridge(): Promise<FundsBridgeResponse> {
  return getJson<FundsBridgeResponse>('/funds/bridge')
}

export function getFundsOverlap(tickers: string[]): Promise<FundOverlapResponse> {
  return sendJson<FundOverlapResponse>('POST', '/funds/overlap', { tickers })
}

export function searchSecurities(q: string): Promise<SearchResponse> {
  return getJson<SearchResponse>(`/search?q=${encodeURIComponent(q)}`)
}

export function createAlertRule(body: AlertRuleCreate): Promise<AlertRule> {
  return sendJson<AlertRule>('POST', '/alerts/rules', body)
}

export function toggleAlertRule(id: number, enabled: boolean): Promise<AlertRule> {
  return sendJson<AlertRule>('PATCH', `/alerts/rules/${id}`, { enabled })
}

export function deleteAlertRule(id: number): Promise<void> {
  return sendJson<void>('DELETE', `/alerts/rules/${id}`)
}

export function getTheses(): Promise<ThesesResponse> {
  return getJson<ThesesResponse>('/theses')
}

export function getMacroLatest(): Promise<MacroLatestResponse> {
  return getJson<MacroLatestResponse>('/macro/latest')
}

export function getMacroSeries(seriesId: string): Promise<MacroSeriesResponse> {
  return getJson<MacroSeriesResponse>(`/macro/series/${encodeURIComponent(seriesId)}`)
}

export function getSummaryStatus(
  ticker: string,
  opts?: { accession?: string },
): Promise<SummaryStatusResponse> {
  const q = opts?.accession ? `?accession=${encodeURIComponent(opts.accession)}` : ''
  return getJson<SummaryStatusResponse>(
    `/securities/${encodeURIComponent(ticker)}/summary${q}`,
  )
}

// TODO(auth): generation hits the Anthropic API and costs money — gate before public.
// Default target is the primary annual report; pass {accession} to summarize a
// specific filing (proxy, S-1, 6-K, …) the user picked from the Filings list.
export function generateSummary(
  ticker: string,
  opts?: { accession?: string; force?: boolean },
): Promise<FilingSummary> {
  const params = new URLSearchParams()
  if (opts?.accession) params.set('accession', opts.accession)
  if (opts?.force) params.set('force', 'true')
  const q = params.toString() ? `?${params.toString()}` : ''
  return sendJson<FilingSummary>(
    'POST',
    `/securities/${encodeURIComponent(ticker)}/summary${q}`,
  )
}

export function getInsiders(ticker: string): Promise<InsiderResponse> {
  return getJson<InsiderResponse>(
    `/securities/${encodeURIComponent(ticker)}/insiders`,
  )
}

export function getEvents(ticker: string): Promise<EventsResponse> {
  return getJson<EventsResponse>(
    `/securities/${encodeURIComponent(ticker)}/events`,
  )
}

export function getValuation(ticker: string): Promise<ValuationResponse> {
  return getJson<ValuationResponse>(
    `/securities/${encodeURIComponent(ticker)}/valuation`,
  )
}

export function getPeers(ticker: string): Promise<PeerStripResponse | null> {
  return getJson<PeerStripResponse | null>(
    `/securities/${encodeURIComponent(ticker)}/peers`,
  )
}

export function getFilingQaStatus(ticker: string): Promise<FilingQaStatusResponse> {
  return getJson<FilingQaStatusResponse>(
    `/securities/${encodeURIComponent(ticker)}/filing-qa`,
  )
}

// TODO(auth): the deepest/most expensive call (Opus over a large filing) — gate before public.
export function generateFilingQa(ticker: string): Promise<FilingAnswers> {
  return sendJson<FilingAnswers>(
    'POST',
    `/securities/${encodeURIComponent(ticker)}/filing-qa`,
  )
}

export function getBriefStatus(ticker: string): Promise<BriefStatusResponse> {
  return getJson<BriefStatusResponse>(
    `/securities/${encodeURIComponent(ticker)}/brief`,
  )
}

export function getLiveFactors(ticker: string): Promise<LiveFactorsResponse> {
  return getJson<LiveFactorsResponse>(
    `/securities/${encodeURIComponent(ticker)}/live-factors`,
  )
}

export function getNews(ticker: string): Promise<NewsNarrativeResponse> {
  return getJson<NewsNarrativeResponse>(
    `/securities/${encodeURIComponent(ticker)}/news`,
  )
}

// TODO(auth): generation hits the Anthropic API and costs money — gate before public.
export function generateBrief(ticker: string): Promise<DecisionBrief> {
  return sendJson<DecisionBrief>(
    'POST',
    `/securities/${encodeURIComponent(ticker)}/brief`,
  )
}

// TODO(auth): the write endpoints below are "auth-required before public" —
// gate them (and CORS) before any public deploy. No auth this stage.

export function addToWatchlist(ticker: string): Promise<WatchlistMutationResponse> {
  return sendJson<WatchlistMutationResponse>('POST', '/watchlist', { ticker })
}

export function removeFromWatchlist(ticker: string): Promise<void> {
  return sendJson<void>('DELETE', `/watchlist/${encodeURIComponent(ticker)}`)
}

export function updateWatchlistPlan(
  ticker: string,
  body: WatchlistPlanUpdate,
): Promise<WatchlistPlanResponse> {
  return sendJson<WatchlistPlanResponse>(
    'PATCH',
    `/watchlist/${encodeURIComponent(ticker)}/plan`,
    body,
  )
}

/** On-demand AI "what changed" narrative for a watched name (Haiku, cached). */
export function getWhatsChanged(ticker: string): Promise<WhatsChangedResponse> {
  return sendJson<WhatsChangedResponse>(
    'POST',
    `/watchlist/${encodeURIComponent(ticker)}/whats-changed`,
  )
}

export function upsertThesis(
  ticker: string,
  body: ThesisUpsertRequest,
): Promise<ThesisMutationResponse> {
  return sendJson<ThesisMutationResponse>(
    'PUT',
    `/theses/${encodeURIComponent(ticker)}`,
    body,
  )
}

export function deleteThesis(ticker: string): Promise<void> {
  return sendJson<void>('DELETE', `/theses/${encodeURIComponent(ticker)}`)
}

export function getMarketOverview(): Promise<MarketOverviewResponse> {
  return getJson<MarketOverviewResponse>('/market/overview')
}

export function getMarketPulse(): Promise<MarketPulseResponse> {
  return getJson<MarketPulseResponse>('/market/pulse')
}

// TODO(auth): generation hits the Anthropic API — gate before public.
export function generateMarketBrief(): Promise<MarketBriefResponse> {
  return sendJson<MarketBriefResponse>('POST', '/market/brief')
}

export function getPortfolio(benchmark = 'SPY'): Promise<PortfolioResponse> {
  return getJson<PortfolioResponse>(
    `/portfolio?benchmark=${encodeURIComponent(benchmark)}`)
}

export function getPortfolioAnalytics(
  benchmark = 'SPY',
): Promise<PortfolioAnalyticsResponse> {
  return getJson<PortfolioAnalyticsResponse>(
    `/portfolio/analytics?benchmark=${encodeURIComponent(benchmark)}`)
}

export function getProjection(p: {
  years: number
  monthly: number
  annual_fee: number
  stress: boolean
}): Promise<ProjectionResponse> {
  const qs = new URLSearchParams({
    years: String(p.years),
    monthly: String(p.monthly),
    annual_fee: String(p.annual_fee),
    stress: String(p.stress),
  })
  return getJson<ProjectionResponse>(`/portfolio/projection?${qs.toString()}`)
}

/** Extended projection (POST): custom weights, goal probability, benchmark cone. */
export function runProjection(body: ProjectionRunRequest): Promise<ProjectionResponse> {
  return sendJson<ProjectionResponse>('POST', '/portfolio/projection', body)
}

export function getPortfolioTransactions(): Promise<PortfolioTransactionsResponse> {
  return getJson<PortfolioTransactionsResponse>('/portfolio/transactions')
}

export function addPortfolioTransactions(
  transactions: PortfolioTransactionCreate[],
): Promise<PortfolioMutationResponse> {
  return sendJson<PortfolioMutationResponse>('POST', '/portfolio/transactions', {
    transactions,
  })
}

export function deletePortfolioTransaction(id: number): Promise<void> {
  return sendJson<void>('DELETE', `/portfolio/transactions/${id}`)
}

// ── linked brokerage accounts (scaffold — providers not implemented yet) ──────
export function getPortfolioLinks(): Promise<LinkedAccountsResponse> {
  return getJson<LinkedAccountsResponse>('/portfolio/links')
}

export function connectPortfolioLink(provider: string): Promise<LinkConnectResponse> {
  return sendJson<LinkConnectResponse>('POST', '/portfolio/links/connect', { provider })
}

export function syncPortfolioLink(id: number): Promise<LinkSyncResponse> {
  return sendJson<LinkSyncResponse>('POST', `/portfolio/links/${id}/sync`)
}

export function deletePortfolioLink(id: number): Promise<void> {
  return sendJson<void>('DELETE', `/portfolio/links/${id}`)
}
