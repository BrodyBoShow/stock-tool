from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from api.ratelimit import rate_limit
from api.schemas import (
    PortfolioMutationResponse,
    PortfolioResponse,
    PortfolioTransactionRow,
    PortfolioTransactionsCreateRequest,
    PortfolioTransactionsResponse,
    ProjectionResponse,
)
from engine import portfolio as portfolio_engine
from engine.portfolio_projection import project_portfolio

router = APIRouter()


@router.get(
    "/projection",
    response_model=ProjectionResponse,
    dependencies=[Depends(rate_limit(20, 60))],
)
def get_projection(
    years: int = Query(10, ge=1, le=40),
    monthly: float = Query(0.0, ge=0.0, le=1_000_000.0),
    annual_fee: float = Query(0.0, ge=0.0, le=0.1),
    stress: bool = Query(False),
) -> ProjectionResponse:
    """Correlated Monte Carlo projection cone for the current holdings. Computed
    on demand (a 1k-path sim); display-only, never feeds the factor model."""
    out = project_portfolio(years=years, monthly=monthly, annual_fee=annual_fee, stress=stress)
    return ProjectionResponse(**out)


@router.get("", response_model=PortfolioResponse)
def get_portfolio() -> PortfolioResponse:
    """The whole Portfolio tab: holdings, TWR/MWR performance vs SPY, risk
    stats, factor tilt, allocation, dividend income, and action-center flags —
    all derived live from the transaction ledger (nothing precomputed)."""
    return PortfolioResponse(**portfolio_engine.compute_portfolio())


@router.get("/transactions", response_model=PortfolioTransactionsResponse)
def get_transactions() -> PortfolioTransactionsResponse:
    """Full ledger, newest first."""
    rows = portfolio_engine.get_transactions()
    return PortfolioTransactionsResponse(
        rows=[PortfolioTransactionRow(**r) for r in rows]
    )


# TODO: add authentication before any public deploy
@router.post("/transactions", response_model=PortfolioMutationResponse)
def add_transactions(body: PortfolioTransactionsCreateRequest) -> PortfolioMutationResponse:
    """Insert a batch of ledger rows (single add and CSV import share this).

    All-or-nothing: any validation error rejects the whole batch with 422 and
    a per-row error list, so a half-broken CSV never half-imports.
    """
    items = [t.model_dump() for t in body.transactions]
    if not items:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No transactions provided",
        )
    inserted, errors = portfolio_engine.add_transactions(items)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="; ".join(errors[:10]) + ("…" if len(errors) > 10 else ""),
        )
    return PortfolioMutationResponse(inserted=inserted, errors=[])


# TODO: add authentication before any public deploy
@router.delete("/transactions/{txn_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(txn_id: int) -> None:
    """Remove one ledger row. 404 if it doesn't exist."""
    if not portfolio_engine.delete_transaction(txn_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction {txn_id} not found",
        )
