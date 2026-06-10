/** Typed mirror of the Phase 9 FastAPI contract (api/schemas.py). */

export interface ScreenerRow {
  rank: number
  ticker: string
  name: string | null
  sector: string | null
  exchange: string | null
  composite: number | null
  growth_pctl: number | null
  value_pctl: number | null
  quality_pctl: number | null
  momentum_pctl: number | null
  last_price: number | null
  prev_close: number | null
  security_id: number
}

export interface ScreenerResponse {
  score_date: string | null
  rows: ScreenerRow[]
}

/** factor_scores.details JSON — shape confirmed against the live API. */
export interface ScoreDetails {
  flags?: {
    roic_pool?: string
    momentum_basis?: string
  }
  inputs?: Record<string, number | null>
  weights?: Record<string, number>
  sub_pctls?: Record<string, number | null>
}

export interface SecurityHeader {
  security_id: number
  ticker: string
  name: string | null
  sector: string | null
  exchange: string | null
  industry: string | null
  score_date: string | null
  composite: number | null
  growth_pctl: number | null
  value_pctl: number | null
  quality_pctl: number | null
  momentum_pctl: number | null
  details: ScoreDetails | null
  last_price: number | null
  price_date: string | null
}

export interface PricePoint {
  date: string
  adj_close: number | null
  close: number | null
}

export interface FundamentalPoint {
  as_of_date: string
  metric: string
  value: number | null
}

export interface SecurityResponse {
  header: SecurityHeader
  prices: PricePoint[]
  fundamentals: FundamentalPoint[]
  filings: unknown[]
}

export interface WatchlistRow {
  ticker: string
  name: string | null
  sector: string | null
  added_at: string
  composite: number | null
  growth_pctl: number | null
  value_pctl: number | null
  quality_pctl: number | null
  momentum_pctl: number | null
  last_price: number | null
  watchlist_id: number
  security_id: number
}

export interface WatchlistResponse {
  rows: WatchlistRow[]
}

export interface WatchlistMutationResponse {
  ticker: string
  security_id: number
  status: 'added' | 'already_present'
}

export interface ThesisRow {
  thesis_id: number
  security_id: number
  ticker: string
  name: string | null
  sector: string | null
  summary: string
  invalidation_rules: string | null
  review_date: string | null
  conviction: string | null
  updated_at: string
  composite: number | null
  review_due: boolean
}

export interface ThesesResponse {
  rows: ThesisRow[]
}

export interface ThesisUpsertRequest {
  summary: string
  invalidation_rules?: string | null
  review_date?: string | null
}

export interface ThesisMutationResponse {
  ticker: string
  security_id: number
  status: 'created' | 'updated'
}

export interface MacroObservation {
  date: string
  value: number | null
}

export interface MacroSeriesLatest {
  series_id: string
  observations: MacroObservation[]
}

export interface MacroLatestResponse {
  series: MacroSeriesLatest[]
}

export interface HealthResponse {
  status: string
  db: string
}
