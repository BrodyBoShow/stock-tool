from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from api.auth import CurrentUser
from api.schemas import (
    WatchlistAddRequest,
    WatchlistChange,
    WatchlistChangesResponse,
    WatchlistMutationResponse,
    WatchlistResponse,
    WatchlistRow,
)
from engine import live_factors, queries, watchlist_signals
from engine import quotes as quotes_engine

router = APIRouter()


@router.get("", response_model=WatchlistResponse)
def get_watchlist(user: CurrentUser) -> WatchlistResponse:
    """All saved watchlist entries with current factor scores."""
    rows = queries.watchlist_rows(owner_id=user.id)
    return WatchlistResponse(rows=[WatchlistRow(**r) for r in rows])


@router.get("/changes", response_model=WatchlistChangesResponse)
def get_watchlist_changes(user: CurrentUser) -> WatchlistChangesResponse:
    """"What changed" digest for each watchlist name: nightly rank/composite move
    vs ~1 month ago, today's live-adjusted composite, recent high-signal 8-Ks,
    trailing-3m insider buys, and whether a thesis review is due. Read-only —
    composed from existing data, no model calls."""
    signals = watchlist_signals.compute(owner_id=user.id)
    if not signals:
        return WatchlistChangesResponse(as_of_epoch=None, rows=[])

    tickers = [s["ticker"] for s in signals]
    quote_payload = quotes_engine.get_quotes(tickers)
    price_by_ticker = {t: q.get("price") for t, q in quote_payload["quotes"].items()}
    overlay = live_factors.live_adjust_many_by_ticker(price_by_ticker)

    rows: list[WatchlistChange] = []
    for s in signals:
        adj = overlay.get(s["ticker"])
        rows.append(WatchlistChange(
            **s,
            composite_live=adj["composite"] if adj else None,
        ))

    return WatchlistChangesResponse(
        as_of_epoch=quote_payload.get("as_of_epoch"),
        rows=rows,
    )


@router.post("", response_model=WatchlistMutationResponse, status_code=status.HTTP_200_OK)
def add_to_watchlist(
    body: WatchlistAddRequest, user: CurrentUser
) -> WatchlistMutationResponse:
    """Idempotent: add a ticker to the watchlist.

    Returns status "added" if newly inserted, "already_present" if it was there.
    """
    ticker = body.ticker.upper()
    wl_status, security_id = queries.watchlist_add_by_ticker(ticker, owner_id=user.id)
    if wl_status == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Ticker {ticker!r} not found or inactive",
        )
    return WatchlistMutationResponse(
        ticker=ticker,
        security_id=security_id,  # type: ignore[arg-type]
        status=wl_status,
    )


@router.delete("/{ticker}", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_watchlist(ticker: str, user: CurrentUser) -> None:
    """Remove a ticker from the watchlist. 404 if the ticker is unknown."""
    ticker = ticker.upper()
    deleted, del_status = queries.watchlist_remove_by_ticker(ticker, owner_id=user.id)
    if del_status == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Ticker {ticker!r} not found or inactive",
        )
    # "not_in_watchlist" is silently accepted (idempotent delete)
