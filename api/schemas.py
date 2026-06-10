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


class SecurityResponse(BaseModel):
    header: SecurityHeader
    prices: list[PricePoint]
    fundamentals: list[FundamentalPoint]
    filings: list[Any]


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
