from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from api.schemas import (
    PortfolioMutationResponse,
    PortfolioResponse,
    PortfolioTransactionRow,
    PortfolioTransactionsCreateRequest,
    PortfolioTransactionsResponse,
)
from engine import portfolio as portfolio_engine

router = APIRouter()


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
