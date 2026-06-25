from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from api.auth import get_current_user
from api.schemas import SearchResponse, SearchRow
from engine import queries

# Login required for beta. Global typeahead — no owner scoping.
router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("", response_model=SearchResponse)
def search(
    q: str = Query("", description="Ticker prefix or company-name fragment."),
) -> SearchResponse:
    """Typeahead over operating companies (the names with deep-dives). Empty
    query returns nothing. Read-only."""
    rows = queries.search_securities(q, limit=12)
    return SearchResponse(rows=[SearchRow(**r) for r in rows])
