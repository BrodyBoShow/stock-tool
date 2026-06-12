"""Pydantic request/response models for the Stock Research API.

These models ARE the contract the React frontend builds against.
FastAPI's /docs exposes the live Swagger spec derived from them.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel

# ── screener ──────────────────────────────────────────────────────────────────

class ScreenerRow(BaseModel):
    rank: int
    ticker: str
    name: str | None
    sector: str | None
    exchange: str | None
    composite: float | None
    growth_pctl: float | None
    value_pctl: float | None
    quality_pctl: float | None
    momentum_pctl: float | None
    last_price: float | None
    prev_close: float | None
    market_cap: float | None = None
    security_id: int


class ScreenerResponse(BaseModel):
    score_date: date | None
    rows: list[ScreenerRow]


# ── live quotes (Phase 15 — intraday price overlay, context only) ─────────────

class QuoteRow(BaseModel):
    price: float | None
    prev_close: float | None
    change_pct: float | None


class QuotesResponse(BaseModel):
    as_of_epoch: float          # server fetch time (unix seconds)
    age_seconds: float          # how old the served quotes are
    stale: bool                 # true if a refresh failed and this is fallback
    quotes: dict[str, QuoteRow] # ticker -> latest (delayed ~15m) quote


class BacktestRunResponse(BaseModel):
    """Latest stored backtest run for the Lab page.

    results/benchmarks are the engine's self-contained jsonb document (bucket
    stats, win rates, growth-of-$1 curves; SPY + universe equal-weight). Typed
    loosely as dicts — the frontend owns the chart-shaped typing.
    """
    has_results: bool
    backtest_id: int | None = None
    config_version: str | None = None
    generated_at: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    params: dict | None = None
    results: dict | None = None
    benchmarks: dict | None = None


# ── securities (deep-dive) ────────────────────────────────────────────────────

class SecurityHeader(BaseModel):
    security_id: int
    ticker: str
    name: str | None
    sector: str | None
    exchange: str | None
    industry: str | None
    score_date: date | None
    composite: float | None
    growth_pctl: float | None
    value_pctl: float | None
    quality_pctl: float | None
    momentum_pctl: float | None
    details: dict[str, Any] | None
    last_price: float | None
    price_date: date | None


class PricePoint(BaseModel):
    date: date
    adj_close: float | None
    close: float | None


class FundamentalPoint(BaseModel):
    as_of_date: date
    metric: str
    value: float | None


class FilingRow(BaseModel):
    accession_no: str
    form: str
    filed_date: date
    period_of_report: date | None
    primary_doc_url: str | None


class SecurityResponse(BaseModel):
    header: SecurityHeader
    prices: list[PricePoint]
    fundamentals: list[FundamentalPoint]
    filings: list[FilingRow]


# ── AI filing summaries (Phase 10) ────────────────────────────────────────────

class FilingSummaryContent(BaseModel):
    overview: str
    what_changed: list[str]
    risk_factors: list[str]
    key_metrics: list[str]


class FilingSummary(BaseModel):
    accession_no: str
    form: str | None
    summary: FilingSummaryContent
    model: str | None
    generated_at: datetime


class SummaryStatusResponse(BaseModel):
    ticker: str
    has_filing: bool                  # is there a 10-K to summarize?
    latest_accession: str | None
    latest_filed_date: date | None
    summary: FilingSummary | None     # cached summary if one exists


# ── AI decision briefs (Phase 11) ─────────────────────────────────────────────

class FactorTrendPoint(BaseModel):
    score_date: date
    composite: float | None
    growth_pctl: float | None
    value_pctl: float | None
    quality_pctl: float | None
    momentum_pctl: float | None
    rank: int | None                  # 1 = best composite in the universe


class DataConfidence(BaseModel):
    level: str                        # "high" | "medium" | "low"
    reason: str


class ScoreRead(BaseModel):
    drivers: str          # what mechanically drove the composite rank
    blind_spot: str       # the biggest real-world driver the score can't see


class DecisionBriefContent(BaseModel):
    one_liner: str
    score_read: ScoreRead
    bull_case: list[str]
    bear_case: list[str]
    key_catalyst: str
    main_risk: str
    data_confidence: DataConfidence
    next_questions: list[str]


class DecisionBrief(BaseModel):
    score_date: date
    brief: DecisionBriefContent
    model: str | None
    generated_at: datetime


class BriefStatusResponse(BaseModel):
    ticker: str
    has_scores: bool                  # scored at least once (brief possible)?
    trend: list[FactorTrendPoint]     # oldest first; shown even without a brief
    brief: DecisionBrief | None       # cached brief for the latest snapshot


# ── insider transactions (Phase 12 — context only) ───────────────────────────

class InsiderTransaction(BaseModel):
    transaction_date: date | None
    filed_date: date
    owner_name: str
    owner_title: str | None
    is_director: bool
    is_officer: bool
    is_ten_pct: bool
    transaction_code: str             # P, S, A, M, F, G, ... (SEC Form 4 codes)
    acquired_disposed: str | None     # 'A' | 'D'
    shares: float | None
    price: float | None
    value: float | None
    plan_10b5_1: bool | None          # Rule 10b5-1(c) plan trade (None pre-2023)
    form: str


class InsiderWindow(BaseModel):
    months: int
    buy_count: int                    # open-market purchases (code P) only
    sell_count: int                   # open-market sales (code S) only
    buy_value: float | None
    sell_value: float | None
    distinct_buyers: int
    distinct_sellers: int
    sells_under_plan: int


class InsiderResponse(BaseModel):
    ticker: str
    windows: list[InsiderWindow]      # [3m, 12m]
    transactions: list[InsiderTransaction]  # newest first


# ── material events (Phase 13 — 8-K, context only) ────────────────────────────

class MaterialEvent(BaseModel):
    event_date: date | None
    filed_date: date
    form: str
    items: list[str]                  # raw SEC item codes, e.g. ["2.02","9.01"]
    labels: list[str]                 # plain-English labels for those codes
    high_signal: bool                 # any genuinely market-moving item present
    primary_doc_url: str | None
    accession_no: str


class EventsResponse(BaseModel):
    ticker: str
    events: list[MaterialEvent]       # newest first


# ── filing diligence Q&A (Phase 14 — context only) ────────────────────────────

class FilingTopicAnswer(BaseModel):
    topic: str
    disclosed: bool
    finding: str
    evidence: str


class FilingAnswersContent(BaseModel):
    executive_read: str
    topics: list[FilingTopicAnswer]
    notable_disclosures: list[str]
    unanswered: list[str]


class FilingAnswers(BaseModel):
    accession_no: str
    form: str | None
    answers: FilingAnswersContent
    model: str | None
    generated_at: datetime


class FilingQaStatusResponse(BaseModel):
    ticker: str
    has_filing: bool
    latest_accession: str | None
    latest_filed_date: date | None
    answers: FilingAnswers | None     # cached diligence answers if generated


# ── watchlist ─────────────────────────────────────────────────────────────────

class WatchlistRow(BaseModel):
    ticker: str
    name: str | None
    sector: str | None
    added_at: datetime
    composite: float | None
    growth_pctl: float | None
    value_pctl: float | None
    quality_pctl: float | None
    momentum_pctl: float | None
    last_price: float | None
    watchlist_id: int
    security_id: int


class WatchlistResponse(BaseModel):
    rows: list[WatchlistRow]


class WatchlistAddRequest(BaseModel):
    ticker: str


class WatchlistMutationResponse(BaseModel):
    ticker: str
    security_id: int
    status: str  # "added" | "already_present"


# ── theses ────────────────────────────────────────────────────────────────────

class ThesisRow(BaseModel):
    thesis_id: int
    security_id: int
    ticker: str
    name: str | None
    sector: str | None
    summary: str
    invalidation_rules: str | None
    review_date: date | None
    conviction: str | None
    updated_at: datetime
    composite: float | None
    review_due: bool


class ThesesResponse(BaseModel):
    rows: list[ThesisRow]


class ThesisUpsertRequest(BaseModel):
    summary: str
    invalidation_rules: str | None = None
    review_date: date | None = None


class ThesisMutationResponse(BaseModel):
    ticker: str
    security_id: int
    status: str  # "created" | "updated"


# ── portfolio tracker (derived from the user ledger, migration 0014) ─────────

class PortfolioTransactionCreate(BaseModel):
    txn_type: str                     # buy|sell|dividend|deposit|withdrawal|fee
    trade_date: date
    ticker: str | None = None         # required for buy/sell/dividend
    shares: float | None = None       # buy/sell
    price: float | None = None        # buy/sell (per share)
    amount: float | None = None       # cash moved (required for cash types)
    note: str | None = None


class PortfolioTransactionsCreateRequest(BaseModel):
    transactions: list[PortfolioTransactionCreate]


class PortfolioTransactionRow(BaseModel):
    id: int
    txn_type: str
    trade_date: str
    ticker: str | None
    name: str | None
    shares: float | None
    price: float | None
    amount: float | None
    note: str | None


class PortfolioTransactionsResponse(BaseModel):
    rows: list[PortfolioTransactionRow]


class PortfolioMutationResponse(BaseModel):
    inserted: int
    errors: list[str]


class PortfolioResponse(BaseModel):
    """Everything on the Portfolio tab, computed in one pass from the ledger.

    summary/performance/allocation/factor_tilt/income are the engine's
    self-contained document — typed loosely as dicts (same convention as
    BacktestRunResponse); the frontend owns the chart-shaped typing.
    """
    has_transactions: bool
    cash_tracking: bool | None = None
    summary: dict | None = None
    holdings: list[dict] = []
    performance: dict | None = None
    allocation: dict | None = None
    factor_tilt: dict | None = None
    income: dict | None = None
    flags: list[dict] = []
    warnings: list[str] = []


# ── market overview (Market tab — whole-market context, never feeds scores) ──

class MarketOverviewResponse(BaseModel):
    """Self-contained market-overview document (same loose-dict convention as
    BacktestRunResponse/PortfolioResponse — the frontend owns display typing).
    brief is computed sentences, NOT AI-generated (free + deterministic).
    ai_brief is the cached once-per-day Haiku narrative, or null until the tab
    is first opened that day (the frontend then POSTs /market/brief to make it)."""
    as_of: str
    cache_age_seconds: float
    brief: list[str]
    ai_brief: dict | None = None
    market: dict
    sectors: list[dict]
    breadth: dict
    movers: dict
    macro: dict
    filings: list[dict]
    insider_buys: list[dict]
    headlines: list[dict]


class MarketBriefResponse(BaseModel):
    """Result of generating (or fetching today's cached) AI market brief.
    ai_brief is null only if generation failed (e.g. no API key/credits) — the
    page keeps showing the computed brief in that case."""
    ai_brief: dict | None = None


# ── macro (FRED context — never feeds factor scores) ──────────────────────────

class MacroObservation(BaseModel):
    date: date
    value: float | None


class MacroSeriesLatest(BaseModel):
    series_id: str
    observations: list[MacroObservation]  # latest first, up to two


class MacroLatestResponse(BaseModel):
    series: list[MacroSeriesLatest]


class MacroSeriesResponse(BaseModel):
    series_id: str
    observations: list[MacroObservation]  # full history, oldest first


# ── health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    db: str  # "ok" | "error"
