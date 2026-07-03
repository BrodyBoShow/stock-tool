"""Pydantic request/response models for the Stock Research API.

These models ARE the contract the React frontend builds against.
FastAPI's /docs exposes the live Swagger spec derived from them.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field

# ── forward commodity backdrop (context only — used by screener + deep-dive) ──

class CommodityBackdropPoint(BaseModel):
    period: str          # 'YYYY-MM-DD' (first of month)
    value: float
    is_forecast: bool


class CommodityBackdrop(BaseModel):
    """Forward EIA STEO commodity-price path for a commodity an oil & gas
    producer sells. CONTEXT ONLY — never feeds the score; a caveat that trailing
    cheapness may be flattered by a commodity price forecast to fall. The near
    anchor is the STEO's near-term month (not a claimed realized spot)."""
    series_id: str
    commodity: str          # 'oil' | 'natural gas'
    label: str              # e.g. 'WTI crude'
    unit: str               # e.g. '$/bbl'
    vintage: str            # retrieval month (first-of-month) this path was pulled
    near_price: float
    near_period: str
    forward_price: float
    forward_period: str
    slope_pct: float | None  # (forward-near)/near, percent
    direction: str           # 'declining' | 'rising' | 'flat' | 'unknown'
    path: list[CommodityBackdropPoint]


class ForwardSensitivityDriver(BaseModel):
    """One forward-macro driver a company's sector is sensitive to, with its
    current level, ~1-month direction, and a factual relationship note."""
    driver: str              # 'curve' | 'credit' | 'inflation' | 'rate10y'
    label: str
    value: float
    unit: str                # 'bps' | '%'
    bucket: str | None       # level bucket (None for rate10y)
    delta: float | None      # ~1-month change
    direction: str
    stress: bool
    note: str                # why this driver matters for the sector


class ForwardSensitivity(BaseModel):
    """Universal per-company forward read: the sector's dominant free forward
    driver(s), or a diffuse-sector note. CONTEXT ONLY — never feeds the score."""
    sector: str | None
    drivers: list[ForwardSensitivityDriver]
    diffuse_note: str | None  # set when no single driver dominates the sector


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
    rank_prev: int | None = None   # rank ~1 week ago (None if no baseline / new name)
    rank_delta: int | None = None  # rank_prev - rank; + = climbed since last week
    composite_prev: float | None = None      # composite at the prior nightly run
    composite_delta: float | None = None     # composite - composite_prev (delta chip)
    composite_delta_7d: float | None = None  # composite vs ~1 week ago (signal dot)
    sub_pctls: dict[str, float | None] | None = None  # per-sub-metric percentiles
    composite_history: list[float] | None = None  # composite series (~45d) for sparkline
    # Upstream oil & gas producer whose trailing valuation depends on the
    # forward commodity curve (context marker; never affects rank). The actual
    # forward paths ride on ScreenerResponse.commodity_backdrops (shared).
    commodity_producer: bool = False
    security_id: int


class ScreenerResponse(BaseModel):
    score_date: date | None
    rows: list[ScreenerRow]
    # Oil + gas forward paths (EIA STEO), shared by every producer row's marker.
    # None before the first EIA ingest. Context only — never feeds the ranking.
    commodity_backdrops: list[CommodityBackdrop] | None = None


# ── live quotes (Phase 15 — intraday price overlay, context only) ─────────────

class QuoteRow(BaseModel):
    price: float | None
    prev_close: float | None
    change_pct: float | None
    # Live-adjusted factor percentiles (Phase 16), present only for names that
    # got a live price; null otherwise. Display overlay for the screener cells —
    # the board's rank/sort stays on the nightly score. Growth/Quality are
    # filing-driven, so they're never live-adjusted (no fields here).
    composite_live: float | None = None
    value_live: float | None = None
    momentum_live: float | None = None


class QuotesResponse(BaseModel):
    as_of_epoch: float          # server fetch time (unix seconds)
    age_seconds: float          # how old the served quotes are
    stale: bool                 # true if a refresh failed and this is fallback
    quotes: dict[str, QuoteRow] # ticker -> latest (delayed ~15m) quote


# ── live-adjusted factor scores (Phase 16 — intraday overlay, display only) ───

class FactorSet(BaseModel):
    growth: float | None
    value: float | None
    quality: float | None
    momentum: float | None
    composite: float | None


class LiveFactorsResponse(BaseModel):
    """Live-adjusted factor view for one security: price-driven Value & Momentum
    (and the composite) recomputed from the live price against last night's
    frozen cross-section; Growth & Quality held nightly. `live` is false when no
    live price applied (market closed / quote outage / at the close), in which
    case live_factors == nightly. Display only — never feeds factor_scores."""
    ticker: str
    has_scores: bool
    live: bool
    price: float | None
    as_of_epoch: float | None
    stale: bool
    live_factors: FactorSet | None  # live-adjusted (== nightly when live=False)
    nightly: FactorSet | None       # last night's baseline, for comparison
    # This ticker's rank under the exact method the screener's live-ranked #
    # column uses (complete-factor universe, live composite substituted for
    # the bounded quoted set) — matches what the screener shows right now,
    # not just the last nightly close. None if not in the complete universe.
    rank: int | None
    rank_total: int | None


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
    # Per-sub-metric IC attribution (Phase 0): which ranked sub-signals actually
    # predict, with coverage floor + verdict. None on runs predating the feature.
    submetrics: dict | None = None
    benchmarks: dict | None = None
    significance: dict | None = None
    # config_versions that have a stored backtest (for the Lab's A/B selector).
    available_configs: list[str] | None = None


class ProjectionResponse(BaseModel):
    """Portfolio Monte Carlo projection cone. Permissive nested types — the
    frontend owns the chart-shaped typing (mirrors BacktestRunResponse)."""
    has_portfolio: bool
    insufficient_history: bool | None = None
    stress: bool | None = None
    params: dict | None = None
    start_balance: float | None = None
    contributed: float | None = None
    terminal: dict | None = None
    cone: dict | None = None
    max_drawdown: dict | None = None
    prob_gain: float | None = None
    prob_goal: float | None = None
    goal: float | None = None
    benchmark: dict | None = None
    simulated_weights: dict | None = None
    portfolio_assumptions: dict | None = None
    holdings_assumptions: list | None = None
    excluded: list | None = None
    disclaimer: str | None = None
    seed: int | None = None


class ProjectionRunRequest(BaseModel):
    """POST body for the extended projection (Rebalance Simulator reruns)."""
    years: int = Field(10, ge=1, le=40)
    monthly: float = Field(0.0, ge=0.0, le=1_000_000.0)
    annual_fee: float = Field(0.0, ge=0.0, le=0.1)
    stress: bool = False
    # ticker → weight (what-if allocation). Capped hard: an unbounded dict would
    # let one request pull years of prices for thousands of sids and run an
    # O(N³) Cholesky on a free-tier worker. inf/NaN rejected (they'd NaN the
    # whole sim and 500 the response).
    weights: dict[str, Annotated[float, Field(gt=0.0, le=1e9,
                                              allow_inf_nan=False)]] | None = \
        Field(None, max_length=50)
    goal: float | None = Field(None, ge=0.0, le=1e12)
    compare_bench: str | None = Field(None, max_length=10)


class PortfolioAnalyticsResponse(BaseModel):
    """Portfolio diagnostics: betas, correlations, sparklines, the aligned 1Y
    returns matrix, shrunk expected returns, and stress tests. Loose nested
    types — the frontend owns the shaped typing."""
    has_portfolio: bool
    error: str | None = None
    as_of: str | None = None
    benchmark: str | None = None
    tickers: list[str] | None = None
    candidates: list[str] | None = None
    axis_dates: list[str] | None = None
    returns: dict | None = None
    betas: dict | None = None
    corr: list | None = None
    sparks: dict | None = None
    expected: dict | None = None
    last_close: dict | None = None
    stress: list | None = None


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
    volume: int | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None


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
    label: str | None = None          # plain-English form name (filing_taxonomy)
    category: str | None = None       # display grouping (e.g. "Proxy & governance")
    analyzable: bool = False          # can the AI Overview read this filing?


class NewsArticle(BaseModel):
    title: str
    url: str
    domain: str | None = None
    seendate: str | None = None   # GDELT 'YYYYMMDDTHHMMSSZ'


class NewsNarrativeResponse(BaseModel):
    """Recent GDELT news coverage for a company (on-demand). CONTEXT ONLY — name-
    based matching, no scored sentiment; the headlines let the user judge."""
    ticker: str
    available: bool
    query: str | None = None
    window_days: int | None = None
    article_count: int | None = None   # returned count; "at least N" when capped
    capped: bool = False
    articles: list[NewsArticle] = []
    as_of_epoch: float | None = None


class SecurityResponse(BaseModel):
    header: SecurityHeader
    prices: list[PricePoint]
    fundamentals: list[FundamentalPoint]
    filings: list[FilingRow]
    # Forward commodity backdrops (oil + gas) for upstream oil & gas producers;
    # None for every other name. The user applies whichever matches the
    # company's oil/gas weighting.
    commodity_backdrops: list[CommodityBackdrop] | None = None
    # Universal per-company forward sensitivity (sector's dominant macro driver)
    # for every non-producer; None for producers (the commodity backdrop covers
    # them) and unknown sectors.
    forward_sensitivity: ForwardSensitivity | None = None


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
    has_filing: bool                  # is there an analyzable filing to summarize?
    latest_accession: str | None
    latest_filed_date: date | None
    latest_form: str | None = None    # the resolved form (10-K, 20-F, 40-F, …)
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
    sub_pctls: dict[str, float | None] | None = None  # per-sub-metric percentiles


class DataConfidence(BaseModel):
    level: str                        # "high" | "medium" | "low"
    reason: str


class ScoreRead(BaseModel):
    drivers: str          # what mechanically drove the composite rank
    blind_spot: str       # the biggest real-world driver the score can't see


class PriceMoveSource(BaseModel):
    title: str
    url: str


class PriceMoveContext(BaseModel):
    """Web-searched explanation of a notable recent price move (drops), attached
    to the brief only when the move is large enough to warrant it."""
    summary: str
    sources: list[PriceMoveSource] = []


class DecisionBriefContent(BaseModel):
    one_liner: str
    score_read: ScoreRead
    bull_case: list[str]
    bear_case: list[str]
    key_catalyst: str
    main_risk: str
    data_confidence: DataConfidence
    next_questions: list[str]
    price_move_context: PriceMoveContext | None = None  # web-searched "why it moved"


class DecisionBrief(BaseModel):
    score_date: date
    brief: DecisionBriefContent
    model: str | None
    generated_at: datetime


class BriefStatusResponse(BaseModel):
    ticker: str
    has_scores: bool                  # scored at least once (brief possible)?
    generating: bool = False          # background task kicked off; client should poll
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


# ── peer comparison strip (deep-dive) ─────────────────────────────────────────

class PeerRow(BaseModel):
    ticker: str
    name: str | None
    is_focal: bool
    composite: float | None
    pe: float | None
    ev_ebitda: float | None
    fcf_yield: float | None
    market_cap: float | None


class PeerStripResponse(BaseModel):
    sector: str
    sector_pctl: int | None   # focal composite percentile within its sector
    sector_count: int
    peers: list[PeerRow]      # focal first, then 5 nearest by market cap


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


# ── intrinsic valuation panel (deep-dive; client-side math, server ships inputs) ─
# The server ships only provenance-tagged raw inputs + assumption seeds; ALL the
# DCF / reverse-DCF / multiples math runs in the browser. `source`/`quality`/
# `applicability` etc. carry per-input provenance whose exact keys vary by input
# type, so they stay open dicts rather than over-constrained models.

class ValuationInput(BaseModel):
    key: str
    label: str
    value: float | None               # None => the panel renders it as "missing"
    unit: str
    source: dict[str, Any]            # {type, table?, metric?/concept?, components?, ...}
    as_of_date: str | None           # ISO date the value was filed FOR
    quality: dict[str, Any]          # {status: ok|proxied|stale|missing, flags: [...]}
    editable: bool


class ValuationAssumption(BaseModel):
    key: str
    label: str
    seed: float                       # data-seeded default (marked in the UI)
    seed_source: str                  # plain-English provenance of the seed
    min: float
    max: float
    step: float
    unit: str


class ValuationResponse(BaseModel):
    ticker: str
    name: str | None
    sector: str | None
    industry: str | None
    currency: str
    # {currency, usd_per_unit, rate_date} when converted from a foreign filing; None otherwise
    fx: dict[str, Any] | None = None
    current_price: float | None
    as_of: dict[str, Any]            # {price_date, fundamentals_period}
    applicability: dict[str, Any]    # {path, active_models, suppressed_models, reasons}
    inputs: list[ValuationInput]
    assumptions: list[ValuationAssumption]
    scenario_bands: dict[str, Any]   # {bear, base, bull} -> {g_start, discount_rate, terminal_g}
    peer_context: dict[str, Any]     # {sector, n, medians}
    data_quality: dict[str, Any]     # {degraded, notes}
    schema_version: str
    disclaimer: str


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
    has_filing: bool                  # is there an analyzable annual report (10-K/20-F)?
    latest_accession: str | None
    latest_filed_date: date | None
    latest_form: str | None = None    # the resolved annual form (10-K, 20-F, 40-F)
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


class WatchlistChange(BaseModel):
    """One watchlist name's recent material changes — the decision-layer digest.
    All read-only/derived from existing data (factor history, 8-Ks, Form 4,
    thesis review date, live quote). Display only."""
    security_id: int
    ticker: str
    name: str | None
    sector: str | None
    # nightly rank/composite move vs the ~1-month-ago snapshot
    composite: float | None
    composite_prior: float | None
    rank: int | None
    rank_prior: int | None
    baseline_date: str | None
    # live-adjusted composite (today's price vs frozen cross-section), if quoted
    composite_live: float | None
    # high-signal 8-K material events in the last 30 days
    new_events: int
    latest_event_label: str | None
    latest_event_date: str | None
    # open-market insider buys, trailing 3 months
    insider_buy_count: int
    insider_buy_value: float | None
    # thesis review is due (review_date on/before today)
    review_due: bool
    # GDELT news coverage-volume spike (Slice 3.1) — context only, not a signal.
    news_spike: bool = False
    news_ratio: float | None = None   # recent volume / baseline
    news_count: int | None = None     # recent article count


class WatchlistChangesResponse(BaseModel):
    as_of_epoch: float | None       # live-quote fetch time, if any quotes applied
    rows: list[WatchlistChange]     # most recently added first


class WatchlistAddRequest(BaseModel):
    ticker: str


# ── alerts (Wave 5) ───────────────────────────────────────────────────────────

class AlertRule(BaseModel):
    id: int
    scope: str                       # "watchlist" | "ticker"
    security_id: int | None
    ticker: str | None               # set when scope == "ticker"
    name: str | None
    rule_type: str
    threshold: float | None
    enabled: bool
    created_at: str | None


class AlertTrigger(BaseModel):
    rule_id: int
    rule_type: str
    rule_label: str
    severity: str                    # legacy "warn" | "info" (back-compat)
    tier: str                        # "critical" | "elevated" | "routine"
    kind: str                        # red_flag|event_8k|earnings|insider|factor_*|review
    magnitude: float                 # numeric sort key (units vary by kind)
    magnitude_label: str             # right-rail stat, e.g. "+$25.0M", "−14 pl"
    item_code: str | None = None     # 8-K item code (new_8k only)
    item_label: str | None = None    # 8-K plain-English label (new_8k only)
    observed_date: str | None = None  # filed/last-filed/score/review date (ISO)
    security_id: int
    ticker: str
    name: str | None
    sector: str | None
    message: str


class AlertsSummary(BaseModel):
    critical: int
    elevated: int
    routine: int
    by_kind: dict[str, int]


class AlertsResponse(BaseModel):
    triggered: list[AlertTrigger]
    rules: list[AlertRule]
    as_of: str | None = None
    summary: AlertsSummary


class AlertRuleCreate(BaseModel):
    rule_type: str
    scope: str = "market"
    ticker: str | None = None        # required when scope == "ticker"
    threshold: float | None = None


class AlertRuleToggle(BaseModel):
    enabled: bool


# ── funds & ETFs (non-operating instruments) ──────────────────────────────────

class FundRow(BaseModel):
    security_id: int
    ticker: str
    name: str | None
    exchange: str | None
    category: str                    # Commodity | Crypto | Leveraged/Inverse | Other
    last_close: float | None
    price_date: str | None
    price: float | None              # live (~15m delayed) if available
    change_pct: float | None
    r1w: float | None
    r1m: float | None
    r3m: float | None
    rytd: float | None


class FundsResponse(BaseModel):
    as_of_epoch: float | None        # live-quote fetch time, if any
    rows: list[FundRow]


# Rich Funds-tab payloads (Phase 1). Loose dict/list fields — the frontend owns
# display typing (same convention as MarketOverviewResponse). NO expense ratio /
# tracking error / bid-ask spread anywhere: we do not have that data.

class FundsOverviewResponse(BaseModel):
    as_of: str                       # latest priced session (last-close, nightly)
    cache_age_seconds: float = 0.0
    categories: list[dict]           # 4-bucket mini-cards + heatmap aggregates
    rotation: list[dict]             # per-bucket equal-weight returns by horizon
    clusters: list[dict]            # same-underlying groups + best-access/liquid
    funds: list[dict]                # per-fund enriched records


class FundDetailResponse(BaseModel):
    as_of: str
    fund: dict                       # the enriched per-fund record
    holdings: list[dict]             # [{symbol, name, weight}] (equity ETFs only)
    cluster: dict | None = None      # {key, label, icon} if it belongs to one
    peers: list[dict] = []           # up to 3 same-cluster funds w/ key stats


class FundsBridgeResponse(BaseModel):
    """OWNER-SCOPED: ETFs holding the user's watchlist names + overlap%."""
    as_of: str | None = None
    watchlist_size: int
    etfs: list[dict]                 # [{ticker, name, category, held_tickers, overlap_pct}]


class FundOverlapRequest(BaseModel):
    tickers: list[str] = Field(..., max_length=25)


class FundOverlapResponse(BaseModel):
    tickers: list[str]
    matrix: list[list[float]]        # N×N weighted-Jaccard (fractions; diagonal 1.0)


# ── global search (typeahead) ─────────────────────────────────────────────────

class SearchRow(BaseModel):
    ticker: str
    name: str | None
    sector: str | None


class SearchResponse(BaseModel):
    rows: list[SearchRow]


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
    # Bounds are generous sanity limits (far beyond any real retail entry) that
    # reject malformed/abusive input at the schema boundary before it hits the DB.
    txn_type: str                     # buy|sell|dividend|deposit|withdrawal|fee
    trade_date: date
    ticker: str | None = Field(default=None, max_length=12)   # required for buy/sell/dividend
    shares: float | None = Field(default=None, ge=0, le=1e12)  # buy/sell
    price: float | None = Field(default=None, ge=0, le=1e9)    # buy/sell (per share)
    amount: float | None = Field(default=None, ge=-1e12, le=1e12)  # cash moved
    note: str | None = Field(default=None, max_length=500)


class PortfolioTransactionsCreateRequest(BaseModel):
    transactions: list[PortfolioTransactionCreate] = Field(..., max_length=1000)


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


# ── linked brokerage accounts (sync into the ledger, migration 0021) ─────────

class LinkedProviderInfo(BaseModel):
    key: str                  # 'schwab' | 'snaptrade'
    label: str
    implemented: bool         # is the provider wired up yet?
    configured: bool          # are its env credentials present?


class LinkedAccountRow(BaseModel):
    id: int
    provider: str
    external_id: str | None
    display_name: str | None
    status: str               # pending|active|needs_reauth|error|revoked
    cursor: str | None
    last_synced_at: str | None
    last_error: str | None
    created_at: str | None
    updated_at: str | None


class LinkedAccountsResponse(BaseModel):
    """Linked accounts + which providers exist. ``ready`` is False until
    migration 0021 is applied (the tab still renders, just shows setup needed).
    Tokens are NEVER included."""
    ready: bool
    accounts: list[LinkedAccountRow] = []
    providers: list[LinkedProviderInfo] = []


class LinkConnectRequest(BaseModel):
    provider: str             # 'schwab' | 'snaptrade'


class LinkConnectResponse(BaseModel):
    status: str               # 'authorize' | 'not_implemented' | 'not_configured'
    authorize_url: str | None = None   # 5-minute connection-portal URL
    link_id: int | None = None
    state: str | None = None
    detail: str | None = None


class LinkSyncResponse(BaseModel):
    inserted: int
    skipped_count: int
    skipped: list[str] = []
    pending: bool = False     # True when the user hasn't finished linking yet
    display_name: str | None = None


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
    # v2 additions (loose dicts; the frontend owns display typing). Defaults keep
    # the schema backward-compatible if a cached payload predates them.
    freshness: dict | None = None     # session-staleness vs the real latest US session
    coverage: dict | None = None      # priced / priced_prev / active name counts
    rotation: dict | None = None      # cyclical-vs-defensive leadership
    factor_day: list[dict] = []       # factor-of-the-day top-minus-bottom 1d/1w/1m spreads
    read: dict | None = None          # deterministic "what this means" verdict
    anomalies: list[dict] = []        # auto-detected unusual patterns (context, not advice)


class MarketBriefResponse(BaseModel):
    """Result of generating (or fetching today's cached) AI market brief.
    ai_brief is null only if generation failed (e.g. no API key/credits) — the
    page keeps showing the computed brief in that case."""
    ai_brief: dict | None = None


class MarketPulseName(BaseModel):
    ticker: str
    name: str | None = None
    r1d: float | None = None


class MarketPulseResponse(BaseModel):
    """The signed-in user's watchlist at last close vs SPY (owner-scoped). count
    is the watchlist size; scored is how many had a computable 1-day return."""
    count: int
    scored: int
    avg_r1d: float | None = None
    spy_r1d: float | None = None
    top: MarketPulseName | None = None
    drag: MarketPulseName | None = None


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
