from __future__ import annotations

from fastapi import APIRouter, Depends

from api.auth import CurrentUser, get_current_user
from api.ratelimit import rate_limit
from api.schemas import MarketBriefResponse, MarketOverviewResponse, MarketPulseResponse
from engine import market as market_engine
from engine import market_brief

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


@router.get("/pulse", response_model=MarketPulseResponse)
def get_pulse(user: CurrentUser) -> MarketPulseResponse:
    """The signed-in user's watchlist at last close vs SPY — equal-weight 1-day
    return, top contributor, biggest drag. Owner-scoped, bounded to the watchlist
    size (not cached — cheap and per-user)."""
    return MarketPulseResponse(**market_engine.market_pulse(user.id))
