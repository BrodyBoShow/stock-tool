from __future__ import annotations

from fastapi import APIRouter

from api.schemas import MarketOverviewResponse
from engine import market as market_engine

router = APIRouter()


@router.get("/overview", response_model=MarketOverviewResponse)
def get_overview() -> MarketOverviewResponse:
    """The whole Market tab in one payload: sector performance + breadth,
    market internals, macro dashboard, movers, high-signal 8-K stream, insider
    pulse, external headlines, and the computed morning brief. Server-cached
    ~10 minutes (the breadth scans cover millions of price rows)."""
    return MarketOverviewResponse(**market_engine.get_overview())
