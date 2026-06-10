from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from api.schemas import (
    WatchlistAddRequest,
    WatchlistMutationResponse,
    WatchlistResponse,
    WatchlistRow,
)
from engine import queries

router = APIRouter()


@router.get("", response_model=WatchlistResponse)
def get_watchlist() -> WatchlistResponse:
    """All saved watchlist entries with current factor scores."""
    rows = queries.watchlist_rows()
    return WatchlistResponse(rows=[WatchlistRow(**r) for r in rows])


# TODO: add authentication before any public deploy
@router.post("", response_model=WatchlistMutationResponse, status_code=status.HTTP_200_OK)
def add_to_watchlist(body: WatchlistAddRequest) -> WatchlistMutationResponse:
    """Idempotent: add a ticker to the watchlist.

    Returns status "added" if newly inserted, "already_present" if it was there.
    """
    ticker = body.ticker.upper()
    wl_status, security_id = queries.watchlist_add_by_ticker(ticker)
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


# TODO: add authentication before any public deploy
@router.delete("/{ticker}", status_code=status.HTTP_204_NO_CONTENT)
def remove_from_watchlist(ticker: str) -> None:
    """Remove a ticker from the watchlist. 404 if the ticker is unknown."""
    ticker = ticker.upper()
    deleted, del_status = queries.watchlist_remove_by_ticker(ticker)
    if del_status == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Ticker {ticker!r} not found or inactive",
        )
    # "not_in_watchlist" is silently accepted (idempotent delete)
