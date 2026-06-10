from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.schemas import (
    MacroLatestResponse,
    MacroObservation,
    MacroSeriesLatest,
    MacroSeriesResponse,
)
from engine import queries

router = APIRouter()


@router.get("/latest", response_model=MacroLatestResponse)
def get_macro_latest() -> MacroLatestResponse:
    """Latest two observations per tracked macro series.

    CONTEXT ONLY — macro_series never feeds factor scores. The two most recent
    observations let the client show an honest change vs the previous real
    reading (daily for rates/VIX, monthly for Fed Funds / CPI).
    """
    data = queries.macro_latest_rows()
    series = [
        MacroSeriesLatest(
            series_id=sid,
            observations=[MacroObservation(**o) for o in data.get(sid, [])],
        )
        for sid in queries.MACRO_SERIES_IDS
    ]
    return MacroLatestResponse(series=series)


@router.get("/series/{series_id}", response_model=MacroSeriesResponse)
def get_macro_series(series_id: str) -> MacroSeriesResponse:
    """Full history for one tracked macro series (for the price-chart overlay).

    CONTEXT ONLY — never feeds factor scores. 404 for any series not tracked.
    """
    sid = series_id.upper()
    if sid not in queries.MACRO_SERIES_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown macro series {series_id!r}")
    obs = queries.macro_series_rows(sid)
    return MacroSeriesResponse(
        series_id=sid,
        observations=[MacroObservation(**o) for o in obs],
    )
