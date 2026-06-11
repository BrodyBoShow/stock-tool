from __future__ import annotations

from fastapi import APIRouter

from api.schemas import QuoteRow, QuotesResponse
from engine import queries
from engine import quotes as quotes_engine

router = APIRouter()


@router.get("", response_model=QuotesResponse)
def get_quotes() -> QuotesResponse:
    """Latest (delayed ~15m) intraday quotes for the top names by composite,
    server-cached for a short TTL. Bounded so the overlay stays fast on the full
    ~5.5k universe. Display overlay only — never feeds factor scores."""
    payload = quotes_engine.get_quotes(queries.top_quote_tickers())
    return QuotesResponse(
        as_of_epoch=payload["as_of_epoch"],
        age_seconds=payload["age_seconds"],
        stale=payload["stale"],
        quotes={t: QuoteRow(**q) for t, q in payload["quotes"].items()},
    )
