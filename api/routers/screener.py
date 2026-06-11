from __future__ import annotations

from fastapi import APIRouter

from api.schemas import (
    LiveScore,
    LiveScoresResponse,
    ScreenerResponse,
    ScreenerRow,
)
from engine import queries
from engine import scoring as scoring_engine

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
    rows, score_date = queries.screener_rows(complete_only=complete_only)
    return ScreenerResponse(
        score_date=score_date,
        rows=[ScreenerRow(**r) for r in rows],
    )


@router.get("/live", response_model=LiveScoresResponse)
def get_live_scores() -> LiveScoresResponse:
    """Provisional intraday factor scores recomputed on live prices (Value +
    Momentum move; Quality/Growth unchanged). Server-cached ~90s, never written
    to factor_scores — the stored close-based scores stay the official record.
    Pure computation: no model calls, no paid data."""
    payload = scoring_engine.compute_live(queries.ACTIVE_CONFIG_VERSION)
    return LiveScoresResponse(
        as_of_epoch=payload["as_of_epoch"],
        age_seconds=payload["age_seconds"],
        config_version=payload["config_version"],
        scores={t: LiveScore(**s) for t, s in payload["scores"].items()},
    )
