from __future__ import annotations

from fastapi import APIRouter

from api.schemas import MacroLatestResponse, MacroObservation, MacroSeriesLatest
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
