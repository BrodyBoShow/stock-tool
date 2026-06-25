from __future__ import annotations

from fastapi import APIRouter

from api.auth import CurrentUser
from api.schemas import QuoteRow, QuotesResponse
from engine import live_factors, queries
from engine import quotes as quotes_engine

router = APIRouter()


@router.get("", response_model=QuotesResponse)
def get_quotes(user: CurrentUser) -> QuotesResponse:
    """Latest (delayed ~15m) intraday quotes for the top names by composite,
    server-cached for a short TTL. Bounded so the overlay stays fast on the full
    ~5.5k universe. Each row also carries live-adjusted Composite/Value/Momentum
    (price-driven factors recomputed against last night's cross-section) for the
    screener's cell overlay. Display only — never feeds factor scores."""
    payload = quotes_engine.get_quotes(queries.top_quote_tickers(owner_id=user.id))
    price_by_ticker = {t: q.get("price") for t, q in payload["quotes"].items()}
    overlay = live_factors.live_adjust_many_by_ticker(price_by_ticker)

    quotes_out: dict[str, QuoteRow] = {}
    for t, q in payload["quotes"].items():
        adj = overlay.get(t)
        quotes_out[t] = QuoteRow(
            price=q.get("price"),
            prev_close=q.get("prev_close"),
            change_pct=q.get("change_pct"),
            composite_live=adj["composite"] if adj else None,
            value_live=adj["value"] if adj else None,
            momentum_live=adj["momentum"] if adj else None,
        )

    return QuotesResponse(
        as_of_epoch=payload["as_of_epoch"],
        age_seconds=payload["age_seconds"],
        stale=payload["stale"],
        quotes=quotes_out,
    )
