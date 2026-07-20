from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.auth import CurrentUser, get_current_user
from api.schemas import (
    FundDetailResponse,
    FundOverlapRequest,
    FundOverlapResponse,
    FundsBridgeResponse,
    FundsOverviewResponse,
)
from engine import funds as funds_engine

# Login required for beta. Global fund list — no owner scoping (except /bridge).
router = APIRouter(dependencies=[Depends(get_current_user)])


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
