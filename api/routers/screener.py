from __future__ import annotations

from fastapi import APIRouter

from api.schemas import ScreenerResponse, ScreenerRow
from engine import queries

router = APIRouter()


@router.get("", response_model=ScreenerResponse)
def get_screener() -> ScreenerResponse:
    """All active securities ranked by composite factor score at the latest score_date."""
    rows, score_date = queries.screener_rows()
    return ScreenerResponse(
        score_date=score_date,
        rows=[ScreenerRow(**r) for r in rows],
    )
