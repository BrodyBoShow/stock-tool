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
  volume: number | null
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

export interface AlertTrigger {
  rule_id: number
  rule_type: AlertRuleType
  rule_label: string
  severity: 'warn' | 'info'
  security_id: number
  ticker: string
  name: string | null
  sector: string | null
  message: string
}

export interface AlertsResponse {
  triggered: AlertTrigger[]
  rules: AlertRule[]
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
}

export interface MarketMover {
  security_id: number
  ticker: string
  name: string | null
  sector: string | null
  market_cap: number | null
  r1d: number
  close: number
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
  }
  filings: MarketFilingRow[]
  insider_buys: MarketInsiderBuy[]
  headlines: MarketHeadline[]
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

export interface PortfolioHolding {
  security_id: number
  ticker: string | null
  name: string | null
  sector: string | null
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
  spy_total: number | null
}

export interface PortfolioPerformance {
  dates: string[]
  value: number[]
  net_invested: number[]
  twr_curve: number[]
  spy_curve: number[]
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

export interface PortfolioIncome {
  ttm_received: number
  forward_12m: number
  yield_on_cost: number | null
  yield_on_value: number | null
}

export interface PortfolioFlag {
  level: 'warn' | 'info'
  kind: string
  text: string
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

export interface BacktestKeyResult {
  buckets: Record<string, BacktestBucketStats> // "1".."5"
  long_short: BacktestCurveStats
  avg_turnover: number | null
  periods: number
  win_rate_top: number | null
  win_rate_ls: number | null
  curves: BacktestCurveSet
  bucket_cagrs: Record<string, number | null>
}

export interface BacktestBenchmarks {
  dates: string[]
  spy: number[]
  universe_ew: number[]
  spy_stats: BacktestCurveStats
  universe_ew_stats: BacktestCurveStats
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
  benchmarks: BacktestBenchmarks | null
}
