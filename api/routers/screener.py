from __future__ import annotations

from fastapi import APIRouter

from api.schemas import ScreenerResponse, ScreenerRow
from engine import queries

router = APIRouter()


@router.get("", response_model=ScreenerResponse)
def get_screener(complete_only: bool = True) -> ScreenerResponse:
    """Active securities ranked by composite factor score at the latest score_date.

    complete_only (default True): only rank names that have ALL four component
    factors (growth, value, quality, momentum), so the composite is comparable
    across the board. Names missing factors — e.g. momentum-only micro-caps —
    are excluded and the rank rebuilds 1..N over the complete set. Pass
    complete_only=false to rank the full universe (partial composites included).
    """
    rows, score_date = queries.screener_rows_cached(complete_only=complete_only)
    return ScreenerResponse(
        score_date=score_date,
        rows=[ScreenerRow(**r) for r in rows],
    )
