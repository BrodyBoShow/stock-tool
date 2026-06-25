from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, status

from api.auth import CurrentUser
from api.schemas import (
    ThesesResponse,
    ThesisMutationResponse,
    ThesisRow,
    ThesisUpsertRequest,
)
from engine import queries

router = APIRouter()


@router.get("", response_model=ThesesResponse)
def get_theses(user: CurrentUser) -> ThesesResponse:
    """All active theses with current composite scores and review-due flag."""
    rows = queries.all_theses_rows(owner_id=user.id)
    today = date.today()
    thesis_rows = []
    for r in rows:
        rd = r.get("review_date")
        thesis_rows.append(
            ThesisRow(
                thesis_id=r["thesis_id"],
                security_id=r["security_id"],
                ticker=r["ticker"],
                name=r.get("name"),
                sector=r.get("sector"),
                summary=r["summary"],
                invalidation_rules=r.get("invalidation_rules"),
                review_date=rd,
                conviction=r.get("conviction"),
                updated_at=r["updated_at"],
                composite=r.get("composite"),
                review_due=bool(rd is not None and rd <= today),
            )
        )
    return ThesesResponse(rows=thesis_rows)


@router.put("/{ticker}", response_model=ThesisMutationResponse)
def upsert_thesis(
    ticker: str, body: ThesisUpsertRequest, user: CurrentUser
) -> ThesisMutationResponse:
    """Create or update the active thesis for a ticker (one thesis per company)."""
    ticker = ticker.upper()
    thesis_status, security_id = queries.thesis_upsert_by_ticker(
        ticker=ticker,
        summary=body.summary,
        invalidation_rules=body.invalidation_rules,
        review_date=body.review_date,
        owner_id=user.id,
    )
    if thesis_status == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Ticker {ticker!r} not found or inactive",
        )
    return ThesisMutationResponse(
        ticker=ticker,
        security_id=security_id,  # type: ignore[arg-type]
        status=thesis_status,
    )


@router.delete("/{ticker}", status_code=status.HTTP_204_NO_CONTENT)
def delete_thesis(ticker: str, user: CurrentUser) -> None:
    """Delete the active thesis for a ticker. 404 if not found."""
    ticker = ticker.upper()
    deleted, del_status = queries.thesis_delete_by_ticker(ticker, owner_id=user.id)
    if del_status == "not_found_ticker":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Ticker {ticker!r} not found or inactive",
        )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active thesis found for {ticker!r}",
        )
