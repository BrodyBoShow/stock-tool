import type {
  BacktestRunResponse,
  BriefStatusResponse,
  DecisionBrief,
  EventsResponse,
  FilingAnswers,
  FilingQaStatusResponse,
  FilingSummary,
  InsiderResponse,
  MacroLatestResponse,
  MacroSeriesResponse,
  QuotesResponse,
  ScreenerResponse,
  SecurityResponse,
  SummaryStatusResponse,
  ThesesResponse,
  ThesisMutationResponse,
  ThesisUpsertRequest,
  WatchlistMutationResponse,
  WatchlistResponse,
} from '@/types/api'

/** Single config point for the API origin — components never hardcode it. */
const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

const APP_PW_KEY = 'stockbud.appPassword'

/** Access password (private-mode gate). Stored locally; sent on every call. */
export function getAppPassword(): string {
  return localStorage.getItem(APP_PW_KEY) ?? ''
}
export function setAppPassword(pw: string): void {
  if (pw) localStorage.setItem(APP_PW_KEY, pw)
  else localStorage.removeItem(APP_PW_KEY)
}

/** Headers common to every request, including the access password when set. */
function authHeaders(base: Record<string, string>): Record<string, string> {
  const pw = getAppPassword()
  return pw ? { ...base, 'X-App-Password': pw } : base
}

/** Probe the auth gate. ok=false means a password is required and missing/wrong. */
export async function checkAuth(): Promise<{ ok: boolean; authRequired: boolean }> {
  try {
    const res = await fetch(`${API_URL}/auth/check`, {
      headers: authHeaders({ Accept: 'application/json' }),
    })
    if (res.status === 401) return { ok: false, authRequired: true }
    if (!res.ok) return { ok: false, authRequired: false }
    return (await res.json()) as { ok: boolean; authRequired: boolean }
  } catch {
    return { ok: false, authRequired: false }
  }
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      headers: authHeaders({ Accept: 'application/json' }),
    })
  } catch {
    throw new ApiError(0, 'API unreachable — is the FastAPI server running?')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      /* non-JSON error body — keep statusText */
    }
    throw new ApiError(res.status, detail)
  }
  return (await res.json()) as T
}

export function getQuotes(): Promise<QuotesResponse> {
  return getJson<QuotesResponse>('/quotes')
}

export function getScreener(completeOnly = true): Promise<ScreenerResponse> {
  return getJson<ScreenerResponse>(`/screener?complete_only=${completeOnly}`)
}

export function getBacktest(): Promise<BacktestRunResponse> {
  return getJson<BacktestRunResponse>('/lab/backtest')
}

export function getSecurity(ticker: string, days?: number): Promise<SecurityResponse> {
  const qs = days ? `?days=${days}` : ''
  return getJson<SecurityResponse>(`/securities/${encodeURIComponent(ticker)}${qs}`)
}

/** Writes (POST/PUT/DELETE). 204 responses resolve to undefined. */
async function sendJson<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'API unreachable — is the FastAPI server running?')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const b = (await res.json()) as { detail?: string }
      if (b.detail) detail = b.detail
    } catch {
      /* non-JSON error body — keep statusText */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function getWatchlist(): Promise<WatchlistResponse> {
  return getJson<WatchlistResponse>('/watchlist')
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

export function getSummaryStatus(ticker: string): Promise<SummaryStatusResponse> {
  return getJson<SummaryStatusResponse>(
    `/securities/${encodeURIComponent(ticker)}/summary`,
  )
}

// TODO(auth): generation hits the Anthropic API and costs money — gate before public.
export function generateSummary(ticker: string): Promise<FilingSummary> {
  return sendJson<FilingSummary>(
    'POST',
    `/securities/${encodeURIComponent(ticker)}/summary`,
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
