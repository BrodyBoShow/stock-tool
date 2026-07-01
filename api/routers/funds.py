from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.auth import CurrentUser, get_current_user
from api.schemas import (
    FundDetailResponse,
    FundOverlapRequest,
    FundOverlapResponse,
    FundRow,
    FundsBridgeResponse,
    FundsOverviewResponse,
    FundsResponse,
)
from engine import funds as funds_engine
from engine import queries
from engine import quotes as quotes_engine

# Login required for beta. Global fund list — no owner scoping (except /bridge).
router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("", response_model=FundsResponse)
def get_funds() -> FundsResponse:
    """Legacy flat fund list with trailing returns + a live (~15m delayed) price
    overlay. Kept for back-compat; the richer /funds/overview supersedes it."""
    funds = queries.funds_list()
    tickers = [f["ticker"] for f in funds]
    payload = quotes_engine.get_quotes(tickers) if tickers else {"quotes": {}, "as_of_epoch": None}
    quotes = payload.get("quotes", {})

    rows: list[FundRow] = []
    for f in funds:
        q = quotes.get(f["ticker"], {})
        rows.append(FundRow(
            security_id=f["security_id"],
            ticker=f["ticker"],
            name=f["name"],
            exchange=f["exchange"],
            category=funds_engine.category_for(f["name"]),
            last_close=f["last_close"],
            price_date=f["price_date"],
            price=q.get("price"),
            change_pct=q.get("change_pct"),
            r1w=f["r1w"], r1m=f["r1m"], r3m=f["r3m"], rytd=f["rytd"],
        ))
    return FundsResponse(as_of_epoch=payload.get("as_of_epoch"), rows=rows)


@router.get("/overview", response_model=FundsOverviewResponse)
def get_funds_overview() -> FundsOverviewResponse:
    """The whole Funds tab in one payload: per-fund enrichment (returns, sparkline,
    1Y risk stats, YTD rank, AUM/volume/NAV/premium-discount), category aggregates,
    a rotation compass, and same-underlying clusters with Best-Access / Most-Liquid
    winners. Server-cached ~10 minutes (it scans ~1Y of daily closes per fund).
    Prices are last-close (nightly)."""
    return FundsOverviewResponse(**funds_engine.funds_overview())


@router.get("/bridge", response_model=FundsBridgeResponse)
def get_funds_bridge(user: CurrentUser) -> FundsBridgeResponse:
    """OWNER-SCOPED: which ETFs hold the signed-in user's watchlist names, with an
    overlap%. Bounded to the watchlist size (indexed on etf_holdings.symbol)."""
    return FundsBridgeResponse(**funds_engine.funds_bridge(user.id))


@router.post("/overlap", response_model=FundOverlapResponse)
def post_funds_overlap(body: FundOverlapRequest) -> FundOverlapResponse:
    """N×N weighted-Jaccard holdings-overlap matrix for the given funds (compare
    mode). Diagonal 1.0; commodity/crypto funds (no holdings) overlap 0."""
    return FundOverlapResponse(**funds_engine.funds_overlap(body.tickers))


@router.get("/{ticker}", response_model=FundDetailResponse)
def get_fund_detail(ticker: str) -> FundDetailResponse:
    """One fund's full enriched record + its holdings + up to 3 same-cluster peers.
    Served off the cached overview (no extra full scan)."""
    detail = funds_engine.fund_detail(ticker)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"fund {ticker!r} not found")
    return FundDetailResponse(**detail)
