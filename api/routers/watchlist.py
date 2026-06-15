from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, status

from api.schemas import (
    WatchlistAddRequest,
    WatchlistChange,
    WatchlistChangesResponse,
    WatchlistMutationResponse,
    WatchlistResponse,
    WatchlistRow,
)
from engine import events as events_engine
from engine import live_factors, queries
from engine import quotes as quotes_engine

router = APIRouter()


@router.get("", response_model=WatchlistResponse)
def get_watchlist() -> WatchlistResponse:
    """All saved watchlist entries with current factor scores."""
    rows = queries.watchlist_rows()
    return WatchlistResponse(rows=[WatchlistRow(**r) for r in rows])


@router.get("/changes", response_model=WatchlistChangesResponse)
def get_watchlist_changes() -> WatchlistChangesResponse:
    """"What changed" digest for each watchlist name: nightly rank/composite move
    vs ~1 month ago, today's live-adjusted composite, recent high-signal 8-Ks,
    trailing-3m insider buys, and whether a thesis review is due. Read-only —
    composed from existing data, no model calls."""
    core = queries.watchlist_change_core()
    if not core:
        return WatchlistChangesResponse(as_of_epoch=None, rows=[])

    tickers = [c["ticker"] for c in core]
    quote_payload = quotes_engine.get_quotes(tickers)
    price_by_ticker = {t: q.get("price") for t, q in quote_payload["quotes"].items()}
    overlay = live_factors.live_adjust_many_by_ticker(price_by_ticker)
    today = date.today()

    rows: list[WatchlistChange] = []
    for c in core:
        ticker = c["ticker"]

        # High-signal 8-K events in the last 30 days.
        events = queries.events_for_ticker(ticker, months=1)
        hi = [
            e for e in events
            if any(i in events_engine.HIGH_SIGNAL_ITEMS for i in e["items"])
        ]
        latest_label = None
        latest_date = None
        if hi:
            top = hi[0]  # events_for_ticker returns newest first
            labels = [events_engine.label_for(i) for i in top["items"]
                      if i in events_engine.HIGH_SIGNAL_ITEMS]
            latest_label = labels[0] if labels else None
            latest_date = str(top.get("event_date") or top["filed_date"])

        # Open-market insider buys, trailing 3 months.
        ins = queries.insider_summary(queries.insider_rows(ticker, months=3), months=3)

        adj = overlay.get(ticker)
        rd = c.get("review_date")
        review_due = rd is not None and rd <= str(today)

        rows.append(WatchlistChange(
            security_id=c["security_id"],
            ticker=ticker,
            name=c.get("name"),
            sector=c.get("sector"),
            composite=c.get("comp_now"),
            composite_prior=c.get("comp_base"),
            rank=c.get("rank_now"),
            rank_prior=c.get("rank_base"),
            baseline_date=c.get("base_date"),
            composite_live=adj["composite"] if adj else None,
            new_events=len(hi),
            latest_event_label=latest_label,
            latest_event_date=latest_date,
            insider_buy_count=ins.get("buy_count", 0),
            insider_buy_value=ins.get("buy_value"),
            review_due=review_due,
        ))

    return WatchlistChangesResponse(
        as_of_epoch=quote_payload.get("as_of_epoch"),
        rows=rows,
    )


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
