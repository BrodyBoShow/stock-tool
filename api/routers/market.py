from __future__ import annotations

from fastapi import APIRouter, Depends

from api.auth import CurrentUser, get_current_user
from api.ratelimit import rate_limit
from api.schemas import (
    MarketBriefResponse,
    MarketOverviewResponse,
    MarketPulseResponse,
    TickerTapeItem,
    TickerTapeResponse,
)
from engine import market as market_engine
from engine import market_brief
from engine import quotes as quotes_engine

# Login required for beta. Global market overview — no owner scoping.
router = APIRouter(dependencies=[Depends(get_current_user)])

# The ambient header tape: index / rate / commodity / FX / crypto proxies with
# clean price+% on yfinance. Order = display order in the marquee.
_TAPE: list[tuple[str, str]] = [
    ("SPY", "S&P 500"), ("QQQ", "Nasdaq"), ("DIA", "Dow"), ("IWM", "Rus 2K"),
    ("^VIX", "VIX"), ("TLT", "20Y"), ("UUP", "USD"), ("GLD", "Gold"),
    ("USO", "Oil"), ("BTC-USD", "BTC"), ("ETH-USD", "ETH"),
]


@router.get("/ticker-tape", response_model=TickerTapeResponse)
def get_ticker_tape() -> TickerTapeResponse:
    """Ambient market tape for the app header. Fetches a fixed proxy basket via
    the shared quote cache (delayed ~15m); display only, never touches scores."""
    # Bounded wait: on a Yahoo throttle the fetch keeps running in the
    # background and lands in the cache for the next poll, so the header strip
    # degrades to "quiet"/stale instead of hanging the request into an error.
    payload = quotes_engine.get_quotes([sym for sym, _ in _TAPE], timeout=8.0)
    quotes = payload["quotes"]
    items = [
        TickerTapeItem(
            symbol=sym,
            label=label,
            price=quotes.get(sym, {}).get("price"),
            change_pct=quotes.get(sym, {}).get("change_pct"),
        )
        for sym, label in _TAPE
        if quotes.get(sym, {}).get("price") is not None
    ]
    return TickerTapeResponse(
        items=items, as_of_epoch=payload["as_of_epoch"], stale=payload["stale"]
    )


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
