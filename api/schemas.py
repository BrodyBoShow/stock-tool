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
    security_id: int


class ScreenerResponse(BaseModel):
    score_date: date | None
    rows: list[ScreenerRow]


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


class DecisionBriefContent(BaseModel):
    one_liner: str
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
