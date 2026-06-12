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
  market_cap: number | null
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

export interface ScoreRead {
  drivers: string
  blind_spot: string
}

export interface DecisionBriefContent {
  one_liner: string
  score_read: ScoreRead
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

export interface InsiderTransaction {
  transaction_date: string | null
  filed_date: string
  owner_name: string
  owner_title: string | null
  is_director: boolean
  is_officer: boolean
  is_ten_pct: boolean
  transaction_code: string // P, S, A, M, F, G, ... (SEC Form 4 codes)
  acquired_disposed: string | null
  shares: number | null
  price: number | null
  value: number | null
  plan_10b5_1: boolean | null // Rule 10b5-1(c) plan trade (null pre-2023)
  form: string
}

export interface InsiderWindow {
  months: number
  buy_count: number // open-market purchases (P) only
  sell_count: number // open-market sales (S) only
  buy_value: number | null
  sell_value: number | null
  distinct_buyers: number
  distinct_sellers: number
  sells_under_plan: number
}

export interface InsiderResponse {
  ticker: string
  windows: InsiderWindow[] // [3m, 12m]
  transactions: InsiderTransaction[] // newest first
}

export interface QuoteRow {
  price: number | null
  prev_close: number | null
  change_pct: number | null
}

export interface QuotesResponse {
  as_of_epoch: number
  age_seconds: number
  stale: boolean
  quotes: Record<string, QuoteRow>
}



export interface FilingTopicAnswer {
  topic: string
  disclosed: boolean
  finding: string
  evidence: string
}

export interface FilingAnswersContent {
  executive_read: string
  topics: FilingTopicAnswer[]
  notable_disclosures: string[]
  unanswered: string[]
}

export interface FilingAnswers {
  accession_no: string
  form: string | null
  answers: FilingAnswersContent
  model: string | null
  generated_at: string
}

export interface FilingQaStatusResponse {
  ticker: string
  has_filing: boolean
  latest_accession: string | null
  latest_filed_date: string | null
  answers: FilingAnswers | null
}

export interface MaterialEvent {
  event_date: string | null
  filed_date: string
  form: string
  items: string[] // raw SEC item codes
  labels: string[] // plain-English labels
  high_signal: boolean
  primary_doc_url: string | null
  accession_no: string
}

export interface EventsResponse {
  ticker: string
  events: MaterialEvent[] // newest first
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
