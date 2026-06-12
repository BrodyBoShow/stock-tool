from __future__ import annotations

from fastapi import APIRouter

from api.schemas import BacktestRunResponse
from engine import queries

router = APIRouter()


@router.get("/backtest", response_model=BacktestRunResponse)
def get_backtest() -> BacktestRunResponse:
    """Latest stored backtest run (computed by the monthly workflow with
    --store; never on a request path — a full run takes ~45 minutes).
    has_results=False until the first stored run exists."""
    row = queries.latest_backtest()
    if row is None:
        return BacktestRunResponse(has_results=False)
    return BacktestRunResponse(has_results=True, **row)
