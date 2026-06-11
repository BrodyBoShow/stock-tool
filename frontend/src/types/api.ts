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

export interface FilingRow {
  accession_no: string
  form: string
  filed_date: string
  period_of_report: string | null
  primary_doc_url: string | null
}

export interface SecurityResponse {
  header: SecurityHeader
  prices: PricePoint[]
  fundamentals: FundamentalPoint[]
  filings: FilingRow[]
}

export interface FilingSummaryContent {
  overview: string
  what_changed: string[]
  risk_factors: string[]
  key_metrics: string[]
}

export interface FilingSummary {
  accession_no: string
  form: string | null
  summary: FilingSummaryContent
  model: string | null
  generated_at: string
}

export interface SummaryStatusResponse {
  ticker: string
  has_filing: boolean
  latest_accession: string | null
  latest_filed_date: string | null
  summary: FilingSummary | null
}

export interface FactorTrendPoint {
  score_date: string
  composite: number | null
  growth_pctl: number | null
  value_pctl: number | null
  quality_pctl: number | null
  momentum_pctl: number | null
  rank: number | null // 1 = best composite in the universe
}

export interface DataConfidence {
  level: 'high' | 'medium' | 'low'
  reason: string
}

export interface DecisionBriefContent {
  one_liner: string
  bull_case: string[]
  bear_case: string[]
  key_catalyst: string
  main_risk: string
  data_confidence: DataConfidence
  next_questions: string[]
}

export interface DecisionBrief {
  score_date: string
  brief: DecisionBriefContent
  model: string | null
  generated_at: string
}

export interface BriefStatusResponse {
  ticker: string
  has_scores: boolean
  trend: FactorTrendPoint[] // oldest first
  brief: DecisionBrief | null
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

export interface MacroSeriesResponse {
  series_id: string
  observations: MacroObservation[]
}

export interface HealthResponse {
  status: string
  db: string
}
