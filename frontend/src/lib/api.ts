import type {
  ScreenerResponse,
  SecurityResponse,
  WatchlistResponse,
} from '@/types/api'

/** Single config point for the API origin — components never hardcode it. */
const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

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
      headers: { Accept: 'application/json' },
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

export function getScreener(): Promise<ScreenerResponse> {
  return getJson<ScreenerResponse>('/screener')
}

export function getSecurity(ticker: string, days?: number): Promise<SecurityResponse> {
  const qs = days ? `?days=${days}` : ''
  return getJson<SecurityResponse>(`/securities/${encodeURIComponent(ticker)}${qs}`)
}

export function getWatchlist(): Promise<WatchlistResponse> {
  return getJson<WatchlistResponse>('/watchlist')
}
