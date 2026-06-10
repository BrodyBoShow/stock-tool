from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from api.schemas import (
    FundamentalPoint,
    PricePoint,
    SecurityHeader,
    SecurityResponse,
)
from engine import queries

router = APIRouter()


@router.get("/{ticker}", response_model=SecurityResponse)
def get_security(
    ticker: str,
    days: int | None = Query(
        None,
        ge=1,
        description="Limit price history to the most recent N calendar days. "
                    "Omit for full history (5+ years).",
    ),
) -> SecurityResponse:
    """Deep-dive payload for one security: header, factor scores, prices, fundamentals.

    `filings` is an empty placeholder until Phase 10 (AI filing summarizer).
    """
    ticker = ticker.upper()
    header = queries.security_header(ticker)
    if header is None:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker!r} not found or inactive")

    prices = queries.price_history_rows(ticker, days=days)
    fundamentals = queries.fundamental_metric_rows(ticker)

    return SecurityResponse(
        header=SecurityHeader(**header),
        prices=[PricePoint(**p) for p in prices],
        fundamentals=[FundamentalPoint(**f) for f in fundamentals],
        filings=[],
    )
