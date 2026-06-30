from __future__ import annotations

from fastapi import APIRouter, Depends

from api.auth import get_current_user
from api.schemas import BacktestRunResponse
from engine import queries

# Login required for beta. Global backtest results — no owner scoping.
router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/backtest", response_model=BacktestRunResponse)
def get_backtest(config: str | None = None) -> BacktestRunResponse:
    """Latest stored backtest run (computed by the monthly workflow with
    --store; never on a request path — a full run takes ~45 minutes).
    has_results=False until the first stored run exists.

    config (optional) selects which config_version's run to return, for the Lab's
    A/B selector; defaults to the active config. available_configs lists every
    config_version that has a stored run so the UI can populate the selector."""
    configs = queries.backtest_configs()
    row = queries.latest_backtest(config) if config else queries.latest_backtest()
    if row is None:
        return BacktestRunResponse(has_results=False, available_configs=configs)
    return BacktestRunResponse(has_results=True, available_configs=configs, **row)
