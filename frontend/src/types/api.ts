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
  rank_prev: number | null
  rank_delta: number | null
  composite_prev: number | null
  composite_delta: number | null
  composite_delta_7d: number | null
  sub_pctls: Record<string, number | null> | null
  composite_history: number[] | null
  // Upstream oil & gas producer whose trailing valuation depends on the forward
  // commodity curve (context marker; never affects rank). Paths ride on the
  // response-level commodity_backdrops.
  commodity_producer: boolean
  // Historical risk band 1-5 (realized vol/beta/drawdown over the past year).
  // Context only — never affects rank. null = under a year of trading history.
  risk_band: number | null
  risk_score: number | null
  security_id: number
}

// Per-user risk profile — a stated PREFERENCE the user declares (quiz or
// manual pick), not an assessment; bands/guardrails always derived server-side.
export interface RiskProfileResponse {
  has_profile: boolean
  profile: 'conservative' | 'balanced' | 'aggressive' | null
  source: 'quiz' | 'manual' | null
  answers: Record<string, number> | null
  band_min: number | null
  band_max: number | null
  ideas_min: number | null
  ideas_max: number | null
  guardrails: { max_position_pct: number; max_sector_pct: number } | null
  updated_at: string | null
}

export interface RiskAlignmentHolding {
  ticker: string | null
  weight: number
  risk_band: number | null
  band_reason: string | null
  fit: 'in_band' | 'above' | 'below' | 'no_band'
}

export interface RiskAlignmentIdea {
  ticker: string
  name: string | null
  sector: string | null
  composite: number | null
  risk_band: number | null
  vol_252d: number | null
}

export interface RiskAlignmentResponse {
  has_profile: boolean
  profile: {
    profile: string
    band_min: number
    band_max: number
    ideas_min: number
    ideas_max: number
    guardrails: { max_position_pct: number; max_sector_pct: number }
  } | null
  portfolio: {
    weighted_band: number | null
    in_band_weight_pct: number
    above_band_weight_pct: number
    no_band_weight_pct: number
    volatility: number | null
    beta: number | null
  } | null
  holdings: RiskAlignmentHolding[]
  threshold_flags: Array<{
    kind: string
    subject: string | null
    actual: number | null
    threshold: number | null
    text: string | null
  }>
  ideas: RiskAlignmentIdea[]
  methodology: string
}

export interface ScreenerResponse {
  score_date: string | null
  rows: ScreenerRow[]
  // Oil + gas forward paths (EIA STEO) shared by every producer row's marker;
  // null before the first ingest. Context only — never feeds the ranking.
  commodity_backdrops: CommodityBackdrop[] | null
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
  volume: number | null
  open: number | null
  high: number | null
  low: number | null
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
  label: string | null // plain-English form name
  category: string | null // display grouping (e.g. "Proxy & governance")
  analyzable: boolean // can the AI Overview read this filing?
}

export interface CommodityBackdropPoint {
  period: string // 'YYYY-MM-DD'
  value: number
  is_forecast: boolean
}

export interface CommodityBackdrop {
  series_id: string
  commodity: string // 'oil' | 'natural gas'
  label: string // e.g. 'WTI crude'
  unit: string // e.g. '$/bbl'
  vintage: string // retrieval month (first-of-month)
  near_price: number
  near_period: string
  forward_price: number
  forward_period: string
  slope_pct: number | null // (forward-near)/near, percent
  direction: string // 'declining' | 'rising' | 'flat' | 'unknown'
  path: CommodityBackdropPoint[]
}

export interface ForwardSensitivityDriver {
  driver: string // 'curve' | 'credit' | 'inflation' | 'rate10y'
  label: string
  value: number
  unit: string // 'bps' | '%'
  bucket: string | null // level bucket (null for rate10y)
  delta: number | null
  direction: string
  stress: boolean
  note: string // why this driver matters for the sector
}

export interface ForwardSensitivity {
  sector: string | null
  drivers: ForwardSensitivityDriver[]
  diffuse_note: string | null // set when no single driver dominates the sector
}

export interface NewsArticle {
  title: string
  url: string
  domain: string | null
  seendate: string | null // GDELT 'YYYYMMDDTHHMMSSZ'
}

export interface NewsNarrativeResponse {
  ticker: string
  available: boolean
  query: string | null
  window_days: number | null
  article_count: number | null // "at least N" when capped
  capped: boolean
  articles: NewsArticle[]
  as_of_epoch: number | null
}

export interface SecurityResponse {
  header: SecurityHeader
  prices: PricePoint[]
  fundamentals: FundamentalPoint[]
  filings: FilingRow[]
  // Forward commodity backdrops (oil + gas) for upstream oil & gas producers;
  // null for every other name.
  commodity_backdrops: CommodityBackdrop[] | null
  // Universal per-company forward sensitivity (sector's dominant macro driver);
  // null for producers (commodity backdrop covers them) and unknown sectors.
  forward_sensitivity: ForwardSensitivity | null
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
  latest_form: string | null
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
  sub_pctls: Record<string, number | null> | null
}

export interface DataConfidence {
  level: 'high' | 'medium' | 'low'
  reason: string
}

export interface ScoreRead {
  drivers: string
  blind_spot: string
}

export interface PriceMoveSource {
  title: string
  url: string
}

export interface PriceMoveContext {
  summary: string
  sources: PriceMoveSource[]
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
  price_move_context?: PriceMoveContext | null
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
  generating: boolean  // background task kicked off; poll until brief arrives
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

export interface PeerRow {
  ticker: string
  name: string | null
  is_focal: boolean
  composite: number | null
  pe: number | null
  ev_ebitda: number | null
  fcf_yield: number | null
  market_cap: number | null
}

export interface PeerStripResponse {
  sector: string
  sector_pctl: number | null
  sector_count: number
  peers: PeerRow[] // focal first, then 5 nearest by market cap
}

export interface QuoteRow {
  price: number | null
  prev_close: number | null
  change_pct: number | null
  // Live-adjusted factor percentiles (null unless a live price was applied).
  // Display overlay for the screener cells; the board's rank/sort stays nightly.
  composite_live: number | null
  value_live: number | null
  momentum_live: number | null
}

export interface FactorSet {
  growth: number | null
  value: number | null
  quality: number | null
  momentum: number | null
  composite: number | null
}

export interface LiveFactorsResponse {
  ticker: string
  has_scores: boolean
  live: boolean // true when a live price was actually applied
  price: number | null
  as_of_epoch: number | null
  stale: boolean
  live_factors: FactorSet | null // live-adjusted (== nightly when live=false)
  nightly: FactorSet | null // last night's baseline
  // This ticker's rank under the same method the screener's live-ranked #
  // column uses — matches the screener right now, not just the last close.
  rank: number | null
  rank_total: number | null
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
  latest_form: string | null
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

// ── intrinsic valuation panel ──────────────────────────────────────────────
export interface ValuationInputSource {
  type: string // stored_metric | xbrl_fact | price | derived | assumption
  table?: string
  metric?: string
  metric_version?: string
  concept?: string
  formula?: string
  components?: string[]
  basis?: string // shares: point_in_time | weighted_average
}

export interface ValuationInputQuality {
  status: 'ok' | 'proxied' | 'stale' | 'missing'
  flags: string[]
}

export interface ValuationInput {
  key: string
  label: string
  value: number | null
  unit: string
  source: ValuationInputSource
  as_of_date: string | null
  quality: ValuationInputQuality
  editable: boolean
}

export interface ValuationAssumption {
  key: string
  label: string
  seed: number
  seed_source: string
  min: number
  max: number
  step: number
  unit: string
}

export interface ScenarioBand {
  g_start: number
  discount_rate: number
  terminal_growth: number
}

export interface ValuationResponse {
  ticker: string
  name: string | null
  sector: string | null
  industry: string | null
  currency: string
  fx: { currency: string; usd_per_unit: number; rate_date: string | null } | null
  current_price: number | null
  as_of: { price_date: string | null; fundamentals_period: string | null }
  applicability: {
    path: string
    active_models: string[]
    suppressed_models: string[]
    reasons: string[]
  }
  inputs: ValuationInput[]
  assumptions: ValuationAssumption[]
  scenario_bands: { bear: ScenarioBand; base: ScenarioBand; bull: ScenarioBand }
  peer_context: {
    sector: string | null
    n: number
    medians: Record<string, number | null>
  }
  data_quality: { degraded: boolean; notes: string[] }
  schema_version: string
  disclaimer: string
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
  prev_close: number | null
  price_history: number[] | null
  risk_band: number | null
  // decision-plan capture (redesign P2b) — the user's own plan, not advice
  note: string | null
  target_price: number | null
  entry_trigger: string | null
  kill_criteria: string | null
  plan_updated_at: string | null
  // thesis folded in from the retired Theses tab (edited on the deep dive)
  thesis_summary: string | null
  thesis_invalidation: string | null
  thesis_review_date: string | null
  thesis_review_due: boolean
  watchlist_id: number
  security_id: number
}

/** Editable decision-plan fields for a watchlist entry (all optional). */
export interface WatchlistPlanUpdate {
  note?: string | null
  target_price?: number | null
  entry_trigger?: string | null
  kill_criteria?: string | null
}

export interface WatchlistPlanResponse {
  ticker: string
  status: string
}

export interface WatchlistResponse {
  rows: WatchlistRow[]
}

export interface WatchlistChange {
  security_id: number
  ticker: string
  name: string | null
  sector: string | null
  composite: number | null
  composite_prior: number | null
  rank: number | null
  rank_prior: number | null
  baseline_date: string | null
  composite_live: number | null
  new_events: number
  latest_event_label: string | null
  latest_event_date: string | null
  insider_buy_count: number
  insider_buy_value: number | null
  review_due: boolean
  // GDELT news coverage-volume spike (Slice 3.1) — context only, not a signal.
  news_spike: boolean
  news_ratio: number | null
  news_count: number | null
}

export interface WatchlistChangesResponse {
  as_of_epoch: number | null
  rows: WatchlistChange[]
}

// ── alerts (Wave 5) ───────────────────────────────────────────────────────────

export type AlertRuleType =
  | 'rank_drop'
  | 'composite_drop'
  | 'composite_rise'
  | 'insider_buy'
  | 'new_8k'
  | 'review_due'

export interface AlertRule {
  id: number
  scope: 'market' | 'watchlist' | 'ticker'
  security_id: number | null
  ticker: string | null
  name: string | null
  rule_type: AlertRuleType
  threshold: number | null
  enabled: boolean
  created_at: string | null
}

export type AlertTier = 'critical' | 'elevated' | 'routine'
export type AlertKind =
  | 'red_flag'
  | 'event_8k'
  | 'earnings'
  | 'insider'
  | 'factor_drop'
  | 'factor_rise'
  | 'review'

export interface AlertTrigger {
  rule_id: number
  rule_type: AlertRuleType
  rule_label: string
  severity: 'warn' | 'info' // legacy, kept for back-compat
  tier: AlertTier
  kind: AlertKind
  magnitude: number
  magnitude_label: string
  item_code: string | null
  item_label: string | null
  observed_date: string | null
  security_id: number
  ticker: string
  name: string | null
  sector: string | null
  message: string
}

export interface AlertsSummary {
  critical: number
  elevated: number
  routine: number
  by_kind: Record<string, number>
}

export interface AlertsResponse {
  triggered: AlertTrigger[]
  rules: AlertRule[]
  as_of: string | null
  summary: AlertsSummary
}

export interface AlertRuleCreate {
  rule_type: AlertRuleType
  scope?: 'market' | 'watchlist' | 'ticker'
  ticker?: string | null
  threshold?: number | null
}

// ── funds & ETFs ──────────────────────────────────────────────────────────────

export interface FundRow {
  security_id: number
  ticker: string
  name: string | null
  exchange: string | null
  category: string
  last_close: number | null
  price_date: string | null
  price: number | null
  change_pct: number | null
  r1w: number | null
  r1m: number | null
  r3m: number | null
  rytd: number | null
}

export interface FundsResponse {
  as_of_epoch: number | null
  rows: FundRow[]
}

// Rich Funds-tab payloads (Phase 1). Loose-typed where the engine ships open
// documents (same convention as MarketOverviewResponse). NO expense ratio /
// tracking error / bid-ask spread — that data does not exist.

export interface EnrichedFund {
  security_id: number
  ticker: string
  name: string | null
  exchange: string | null
  category: string                 // Commodity | Crypto | Leveraged/Inverse | Other
  category_name: string | null     // finer Morningstar label (e.g. "Large Blend")
  issuer: string | null
  last_close: number | null
  price_date: string | null
  aum: number | null
  avg_volume: number | null
  nav: number | null
  premium_discount: number | null  // (last_close - nav)/nav, null when nav absent
  spark: number[]                  // ~90 daily closes, oldest→newest
  has_holdings: boolean
  r1d: number | null
  r1w: number | null
  r1m: number | null
  r3m: number | null
  r90d: number | null
  rytd: number | null
  vol: number | null               // annualized stdev of daily returns (×√252)
  mdd: number | null               // max drawdown (negative fraction)
  sharpe: number | null            // mean/stdev ×√252, rf=0
  beta: number | null              // vs SPY daily returns (metadata fallback)
  ytd_rank: number | null          // rank of rytd within category (1 = best)
  ytd_rank_n: number | null        // category size
  best_access: boolean             // cluster winner: AUM + volume + tight prem/disc
  most_liquid: boolean             // cluster winner: highest avg volume
}

export interface FundCategoryAgg {
  key: string
  label: string
  count: number
  aum: number | null
  avg_r1d: number | null
  avg_rytd: number | null
  best: { ticker: string; r1d: number } | null
  worst: { ticker: string; r1d: number } | null
  spark: number[]                  // category-average normalized sparkline
}

export interface FundRotationRow {
  category: string
  r1d: number | null
  r5d: number | null               // ≈1W (calendar-window approximation)
  r20d: number | null              // ≈1M
  r90d: number | null
  rytd: number | null
}

export interface FundCluster {
  key: string
  label: string
  icon: string                     // emoji
  category: string
  funds: string[]                  // member tickers, highest-AUM first
  best_access_ticker: string | null
  most_liquid_ticker: string | null
}

export interface FundsOverviewResponse {
  as_of: string
  cache_age_seconds: number
  categories: FundCategoryAgg[]
  rotation: FundRotationRow[]
  clusters: FundCluster[]
  funds: EnrichedFund[]
}

export interface FundHolding {
  symbol: string
  name: string | null
  weight: number | null
}

export interface FundDetailResponse {
  as_of: string
  fund: EnrichedFund
  holdings: FundHolding[]
  cluster: { key: string; label: string; icon: string } | null
  peers: Array<Record<string, unknown>>
}

export interface FundBridgeEtf {
  ticker: string
  name: string | null
  category: string
  held_tickers: string[]
  held_count: number
  overlap_pct: number
}

export interface FundsBridgeResponse {
  as_of: string | null
  watchlist_size: number
  etfs: FundBridgeEtf[]
}

export interface FundOverlapResponse {
  tickers: string[]
  matrix: number[][]               // N×N weighted-Jaccard (diagonal 1.0)
}

export interface SearchRow {
  ticker: string
  name: string | null
  sector: string | null
}

export interface SearchResponse {
  rows: SearchRow[]
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

// ── Market overview (Market tab) ──────────────────────────────────────────────

export interface MarketSectorRow {
  sector: string
  n: number
  r1d: number | null
  r1w: number | null
  r1m: number | null
  r3m: number | null
  rytd: number | null
  adv_pct: number | null
}

export interface MarketBreadth {
  advancers: number
  decliners: number
  unchanged: number
  n: number
  pct_above_ma50: number | null
  pct_above_ma200: number | null
  new_highs: number
  new_lows: number
  divergence?: { state: 'narrow' | 'resilient' | 'aligned'; detail: string } | null
  drawdown?: { near_high_pct: number; correction_pct: number; bear_pct: number } | null
  calendar?: { date: string; adv_pct: number }[] // ~90-day advancer% history (regime heatmap)
  adv_pct_pctl?: number // percentile of today's advancer% within that 90-day history
}

export interface MarketFreshness {
  as_of: string
  expected_session: string
  sessions_behind: number
  tier: 'current' | 'lagging' | 'stale'
  pre_close: boolean
}

export interface MarketCoverage {
  priced: number
  priced_prev: number
  active: number
}

export interface MarketRotation {
  state: 'risk_on' | 'defensive' | 'mixed'
  cyc_r1d: number
  def_r1d: number
  spread: number
}

export interface MarketFactorDay {
  factor: 'growth' | 'value' | 'quality' | 'momentum'
  top_r1d: number
  bottom_r1d: number
  spread: number
  spread_1w?: number | null // top-minus-bottom over ~1 week (rotation compass)
  spread_1m?: number | null // …and over ~1 month
}

/** Factor percentiles attached to a mover for its mini heatmap. */
export interface MarketMoverFactors {
  growth: number | null
  value: number | null
  quality: number | null
  momentum: number | null
}

/** An auto-detected unusual market pattern (context, never advice). */
export interface MarketAnomaly {
  type: string
  title: string
  detail: string
  tickers: string[]
}

export interface MarketRead {
  tone: 'good' | 'warn' | 'bad' | 'neutral'
  state: string
  text: string
}

export interface MarketMover {
  security_id: number
  ticker: string
  name: string | null
  sector: string | null
  market_cap: number | null
  r1d: number
  close: number
  zscore?: number | null // today's move in σ of the name's own 90-day daily range
  has_8k?: boolean // an 8-K posted in the current filings window
  factors?: MarketMoverFactors | null // factor percentiles (null if unscored)
}

export interface MarketMacroCard {
  id: string
  label: string
  unit: string
  dec: number
  latest: number
  as_of: string
  delta: number | null
  spark_dates: string[]
  spark_values: number[]
}

export interface MarketForwardRegimeDim {
  key: string // 'curve' | 'credit' | 'inflation'
  label: string
  bucket: string // e.g. 'flat', 'tight', 'anchored'
  value: number
  unit: string // 'bps' | '%'
  delta: number | null // ~1-month change
  direction: string // 'steepening'|'flattening'|'widening'|'tightening'|'rising'|'falling'|'stable'
  stress: boolean // this dimension is in a genuine forward-stress state (single source for badge color)
}

export interface MarketForwardRegime {
  dims: MarketForwardRegimeDim[]
  synthesis: string // neutral, descriptive one-liner (never advice)
  stress: boolean // any dimension in a stress bucket
}

export interface MarketFilingRow {
  security_id: number
  ticker: string | null
  name: string | null
  sector: string | null
  market_cap: number | null
  filed_date: string
  event_date: string | null
  form: string
  items: string[]
  labels: string[]
  primary_doc_url: string | null
  accession_no: string
}

export interface MarketInsiderBuy {
  security_id: number
  ticker: string | null
  name: string | null
  sector: string | null
  market_cap: number | null
  total_value: number | null
  buyers: number
  last_filed: string
}

export interface MarketHeadline {
  source: string
  title: string
  url: string
  published_epoch: number
}

export interface MarketAiBrief {
  headline: string
  narrative: string[]
  regime: { label: string; rationale: string }
  watch: string[]
  _meta?: {
    model: string | null
    input_tokens: number | null
    output_tokens: number | null
    est_cost_usd: number | null
    generated_at: string | null
  }
}

export interface MarketBriefResponse {
  ai_brief: MarketAiBrief | null
}

export interface MarketPulseName {
  ticker: string
  name: string | null
  r1d: number | null
}

/** The signed-in user's watchlist at last close vs SPY (owner-scoped). */
export interface MarketPulseResponse {
  count: number // watchlist size
  scored: number // how many had a computable 1-day return
  avg_r1d: number | null
  spy_r1d: number | null
  top: MarketPulseName | null
  drag: MarketPulseName | null
}

export interface MarketOverviewResponse {
  as_of: string
  cache_age_seconds: number
  brief: string[]
  market: {
    spy_close: number | null
    spy_r1d: number | null
    universe_ew_r1d: number | null
  }
  ai_brief: MarketAiBrief | null
  sectors: MarketSectorRow[]
  breadth: MarketBreadth
  movers: { gainers: MarketMover[]; losers: MarketMover[] }
  macro: {
    cards: MarketMacroCard[]
    curve_bps: number | null
    cpi_yoy: number | null
    cpi_as_of: string | null
    regime: MarketForwardRegime | null
  }
  filings: MarketFilingRow[]
  insider_buys: MarketInsiderBuy[]
  headlines: MarketHeadline[]
  freshness?: MarketFreshness | null
  coverage?: MarketCoverage | null
  rotation?: MarketRotation | null
  factor_day?: MarketFactorDay[]
  read?: MarketRead | null
  anomalies?: MarketAnomaly[]
}

// ── Portfolio tracker (derived from the user ledger) ─────────────────────────

export type PortfolioTxnType =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'deposit'
  | 'withdrawal'
  | 'fee'

export interface PortfolioTransactionCreate {
  txn_type: PortfolioTxnType
  trade_date: string
  ticker?: string | null
  shares?: number | null
  price?: number | null
  amount?: number | null
  note?: string | null
}

export interface PortfolioTransactionRow {
  id: number
  txn_type: PortfolioTxnType
  trade_date: string
  ticker: string | null
  name: string | null
  shares: number | null
  price: number | null
  amount: number | null
  note: string | null
}

export interface PortfolioTransactionsResponse {
  rows: PortfolioTransactionRow[]
}

export interface PortfolioMutationResponse {
  inserted: number
  errors: string[]
}

export interface PortfolioLot {
  shares: number
  cost: number
  acquired: string // trade date of the lot (FIFO identity)
}

export interface PortfolioThesisLink {
  id: number
  summary: string | null
  status: string | null
  conviction: number | null // 1–5 int on the wire
}

export interface PortfolioHolding {
  security_id: number
  ticker: string | null
  name: string | null
  sector: string | null
  industry: string | null
  shares: number
  avg_cost: number | null
  cost_basis: number
  last_price: number | null
  prev_close: number | null
  price_date: string | null
  day_change_pct: number | null
  market_value: number | null
  weight: number | null
  unrealized_pl: number | null
  unrealized_pl_pct: number | null
  realized_pl: number
  dividends_received: number
  composite: number | null
  growth_pctl: number | null
  value_pctl: number | null
  quality_pctl: number | null
  momentum_pctl: number | null
  lots: PortfolioLot[]
  lt_unrealized: number | null // unrealized P/L in lots held ≥ 1y
  st_unrealized: number | null // unrealized P/L in lots held < 1y
  oldest_acquired: string | null
  wash_sale_risk: boolean // at a loss + bought within the last 30 days
  thesis: PortfolioThesisLink | null
  // Historical risk band (context only; null = fund/ETF, short history, or stale)
  risk_band: number | null
  band_reason: string | null
}

export interface PortfolioSummary {
  total_value: number
  positions_value: number
  cash: number | null
  cost_basis: number
  net_invested: number
  unrealized_pl: number
  realized_pl: number
  dividends_received: number
  day_change: number | null
  day_change_pct: number | null
  first_date: string
  as_of: string
  twr_total: number | null
  twr_cagr: number | null
  volatility: number | null
  sharpe: number | null
  sortino: number | null
  max_drawdown: number | null
  beta: number | null
  mwr: number | null
  benchmark: string // the reference ticker the *_total/curve values track
  spy_total: number | null // legacy name — holds the requested benchmark
  bench_total: number | null
}

export interface PortfolioEvent {
  date: string
  type: string // buy | sell | dividend | deposit | withdrawal | fee
  ticker: string | null
  amount: number
}

export interface PortfolioPerformance {
  dates: string[]
  value: number[]
  net_invested: number[]
  twr_curve: number[]
  spy_curve: number[] // legacy name — holds the requested benchmark
  bench_curve: number[]
  events: PortfolioEvent[]
}

export interface PortfolioAllocation {
  sectors: { sector: string; value: number; weight: number | null }[]
  cash: number | null
}

export interface PortfolioFactorTilt {
  coverage: number
  composite?: number
  growth_pctl?: number
  value_pctl?: number
  quality_pctl?: number
  momentum_pctl?: number
}

export interface IncomeMonth {
  month: string // 'YYYY-MM'
  total: number
  tickers: string[]
}

export interface IncomeUpcoming {
  ticker: string
  projected_date: string // PROJECTED from the trailing year's ex-date cadence
  per_share: number
  shares: number
  est_amount: number
}

export interface PortfolioIncome {
  ttm_received: number
  forward_12m: number
  yield_on_cost: number | null
  yield_on_value: number | null
  calendar: IncomeMonth[] // 13 zero-filled months (current + 12 — both end partials), projected; sums to forward_12m
  upcoming: IncomeUpcoming[] // next ~31 days, projected
  bench_yield: number | null // benchmark TTM dividends / last close
}

export interface PortfolioFixSuggestion {
  action: string
  sell_ticker?: string
  sell_shares?: number
  sell_amount?: number
  add_ticker?: string
  add_amount?: number
  target_weight?: number
  tax_lt?: number
  tax_st?: number
  wash_sale_risk?: boolean
}

export interface PortfolioFlag {
  level: 'warn' | 'info'
  kind: string
  text: string
  severity?: 'high' | 'med' | 'low'
  ticker?: string
  sector?: string
  tickers?: string[]
  weight?: number
  threshold?: number
  fix?: PortfolioFixSuggestion
}

export interface PortfolioResponse {
  has_transactions: boolean
  cash_tracking: boolean | null
  summary: PortfolioSummary | null
  holdings: PortfolioHolding[]
  performance: PortfolioPerformance | null
  allocation: PortfolioAllocation | null
  factor_tilt: PortfolioFactorTilt | null
  income: PortfolioIncome | null
  flags: PortfolioFlag[]
  warnings: string[]
}

// ── Linked brokerage accounts (sync into the ledger; scaffold) ────────────────

export interface LinkedProviderInfo {
  key: string // 'schwab' | 'snaptrade'
  label: string
  implemented: boolean // is the provider wired up yet?
  configured: boolean // are its credentials present?
}

export interface LinkedAccountRow {
  id: number
  provider: string
  external_id: string | null
  display_name: string | null
  status: string // pending|active|needs_reauth|error|revoked
  cursor: string | null
  last_synced_at: string | null
  last_error: string | null
  created_at: string | null
  updated_at: string | null
}

export interface LinkedAccountsResponse {
  ready: boolean // false until migration 0021 is applied
  accounts: LinkedAccountRow[]
  providers: LinkedProviderInfo[]
}

export interface LinkConnectResponse {
  status: string // 'authorize' | 'not_implemented' | 'not_configured'
  authorize_url: string | null
  link_id: number | null
  state: string | null
  detail: string | null
}

export interface LinkSyncResponse {
  inserted: number
  skipped_count: number
  skipped: string[]
  pending: boolean
  display_name: string | null
}

// ── Factor Lab (stored backtest) ──────────────────────────────────────────────

export interface BacktestCurveSet {
  dates: string[] // period-end dates, aligned with the value arrays
  top: number[] // growth of $1, top quintile
  bottom: number[]
  long_short: number[]
}

export interface BacktestCurveStats {
  total_return: number | null
  cagr: number | null
  sharpe: number | null
  max_drawdown: number | null
}

export interface BacktestBucketStats extends BacktestCurveStats {
  avg_names: number
}

export interface BacktestCI {
  lo: number
  hi: number
}

export interface BacktestICBlock {
  mean: number
  ir: number | null
  t_stat: number | null
  pct_positive: number
  n: number
  series: { date: string; ic: number | null }[]
}

export interface BacktestBootstrap {
  top: { cagr: BacktestCI | null; sharpe: BacktestCI | null; n_resamples: number } | null
  long_short: { cagr: BacktestCI | null; sharpe: BacktestCI | null; n_resamples: number } | null
}

export interface BacktestRandomPortfolio {
  actual_cagr: number
  p5: number
  p50: number
  p95: number
  percentile: number
  n_sims: number
  avg_basket: number
  periods: number
}

export interface BacktestSignificance {
  random_portfolio: BacktestRandomPortfolio | null
  seed: number
}

export type SubmetricVerdict =
  | 'predictive'
  | 'no_significant_ic'
  | 'predictive_wrong_sign'
  | 'insufficient_data'

export interface BacktestCoverage {
  median_valid_names: number
  n_periods: number
  evaluable: boolean
  t_bar: number
  verdict: SubmetricVerdict
}

export interface BacktestMonotonicity {
  rank_corr_meanret: number | null
  top_gt_bottom: boolean | null
  periods_with_buckets: number
  low_evidence: boolean
}

export interface BacktestKeyResult {
  buckets: Record<string, BacktestBucketStats> // "1".."5"
  long_short: BacktestCurveStats
  avg_turnover: number | null
  periods: number
  win_rate_top: number | null
  win_rate_ls: number | null
  curves: BacktestCurveSet
  bucket_cagrs: Record<string, number | null>
  ic?: BacktestICBlock | null
  bootstrap?: BacktestBootstrap | null
  coverage?: BacktestCoverage // present on sub-metric attribution entries
  monotonicity?: BacktestMonotonicity
}

export interface BacktestBenchmarks {
  dates: string[]
  spy: number[]
  universe_ew: number[]
  spy_stats: BacktestCurveStats
  universe_ew_stats: BacktestCurveStats
}

// ── Portfolio projection (Monte Carlo cone) ──────────────────────────────────

export interface ProjectionCone {
  years: number[]
  p10: number[]
  p50: number[]
  p90: number[]
}

export interface ProjectionAssumption {
  ticker: string | null
  weight: number
  ann_return: number
  ann_return_trailing: number
  ann_vol: number
}

export interface ProjectionBenchmark {
  ticker: string
  terminal: { p10: number; p50: number; p90: number }
  cone_p50: number[]
  assumptions: { ann_return: number; ann_vol: number }
  prob_beat: number // fraction of sims where the portfolio beats this benchmark
}

export interface ProjectionResponse {
  has_portfolio: boolean
  insufficient_history?: boolean | null
  stress?: boolean | null
  params?: { years: number; monthly: number; annual_fee: number; n_sims: number; lookback_days: number } | null
  start_balance?: number | null
  contributed?: number | null
  terminal?: { p10: number; p50: number; p90: number } | null
  cone?: ProjectionCone | null
  max_drawdown?: { p50: number; p10: number } | null
  prob_gain?: number | null
  prob_goal?: number | null
  goal?: number | null
  benchmark?: ProjectionBenchmark | null
  simulated_weights?: Record<string, number> | null
  portfolio_assumptions?: { ann_return: number; ann_vol: number; n_obs: number } | null
  holdings_assumptions?: ProjectionAssumption[] | null
  excluded?: string[] | null
  disclaimer?: string | null
  seed?: number | null
}

export interface ProjectionRunRequest {
  years?: number
  monthly?: number
  annual_fee?: number
  stress?: boolean
  weights?: Record<string, number> | null // ticker → weight (what-if allocation)
  goal?: number | null
  compare_bench?: string | null
}

// ── Portfolio analytics (betas, correlations, stress tests, simulator data) ──

export interface StressContributor {
  ticker: string
  ret: number
  contrib_pp: number
}

export interface StressPreset {
  key: string
  label: string
  sub: string
  method: 'replay' | 'beta_mapped'
  portfolio_dd: number
  portfolio_ret?: number
  bench_dd: number
  contributors: StressContributor[]
  coverage?: number
  skipped?: string[]
  note: string
}

export interface PortfolioAnalyticsResponse {
  has_portfolio: boolean
  error?: string | null
  as_of?: string | null
  benchmark?: string | null
  tickers?: string[] | null
  candidates?: string[] | null // benchmark/simulator buy candidates present in data
  axis_dates?: string[] | null
  returns?: Record<string, (number | null)[]> | null // aligned daily returns
  betas?: Record<string, number | null> | null
  corr?: (number | null)[][] | null // NxN over `tickers`
  sparks?: Record<string, number[]> | null // last ~30 closes per ticker
  expected?: Record<string, { exp_return: number | null; vol: number | null }> | null
  last_close?: Record<string, number | null> | null
  stress?: StressPreset[] | null
}

export interface BacktestRunResponse {
  has_results: boolean
  backtest_id: number | null
  config_version: string | null
  generated_at: string | null
  start_date: string | null
  end_date: string | null
  params: { n_buckets: number; cost_bps: number; rebalances: number } | null
  results: Record<string, BacktestKeyResult> | null
  submetrics?: Record<string, BacktestKeyResult> | null // per-sub-metric IC (Phase 0)
  benchmarks: BacktestBenchmarks | null
  significance?: BacktestSignificance | null
  available_configs?: string[] | null // config_versions with a stored run (A/B selector)
}
