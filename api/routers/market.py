from __future__ import annotations

from fastapi import APIRouter, Depends

from api.auth import CurrentUser, get_current_user
from api.ratelimit import rate_limit
from api.schemas import (
    CompareSeries,
    CompareSeriesResponse,
    MarketBriefResponse,
    MarketOverviewResponse,
    MarketPulseResponse,
)
from engine import market as market_engine
from engine import market_brief, queries

MAX_COMPARE_TICKERS = 6
MAX_COMPARE_DAYS = 1825

# Login required for beta. Global market overview — no owner scoping.
router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/overview", response_model=MarketOverviewResponse)
def get_overview() -> MarketOverviewResponse:
    """The whole Market tab in one payload: sector performance + breadth,
    market internals, macro dashboard, movers, high-signal 8-K stream, insider
    pulse, external headlines, the computed morning brief, and today's cached
    AI brief if one exists. Server-cached ~10 minutes (the breadth scans cover
    millions of price rows). This stays a pure read — it never triggers AI
    spend; the frontend POSTs /brief to generate the day's narrative once."""
    ov = market_engine.get_overview()
    ov["ai_brief"] = market_brief.get_cached(ov["as_of"])
    return MarketOverviewResponse(**ov)


@router.post(
    "/brief",
    response_model=MarketBriefResponse,
    dependencies=[Depends(rate_limit(10, 300))],
)
def generate_brief() -> MarketBriefResponse:
    """Generate (or return today's cached) AI market brief. Idempotent per
    market day — at most one Haiku call/day no matter how often it's called —
    so this is the single, bounded place market-overview AI cost is incurred."""
    ov = market_engine.get_overview()
    return MarketBriefResponse(ai_brief=market_brief.generate_and_cache(ov))


@router.get("/compare-series", response_model=CompareSeriesResponse)
def get_compare_series(tickers: str, days: int = 365) -> CompareSeriesResponse:
    """Adjusted-close series for the price-chart compare overlay. `tickers` is a
    comma-separated list (max 6); benchmark ETFs (SPY/QQQ/IWM) work here even
    though they're inactive in the universe. Tickers with no data are omitted."""
    wanted = [t.strip().upper() for t in tickers.split(",") if t.strip()][:MAX_COMPARE_TICKERS]
    days = max(1, min(days, MAX_COMPARE_DAYS))
    series = queries.compare_series_bulk(wanted, days)
    return CompareSeriesResponse(
        series=[
            CompareSeries(ticker=t, points=series[t])
            for t in wanted
            if t in series and len(series[t]) >= 2
        ]
    )


@router.get("/pulse", response_model=MarketPulseResponse)
def get_pulse(user: CurrentUser) -> MarketPulseResponse:
    """The signed-in user's watchlist at last close vs SPY — equal-weight 1-day
    return, top contributor, biggest drag. Owner-scoped, bounded to the watchlist
    size (not cached — cheap and per-user)."""
    return MarketPulseResponse(**market_engine.market_pulse(user.id))
