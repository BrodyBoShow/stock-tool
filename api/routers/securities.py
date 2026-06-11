from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query

from api.schemas import (
    FilingRow,
    FilingSummary,
    FundamentalPoint,
    PricePoint,
    SecurityHeader,
    SecurityResponse,
    SummaryStatusResponse,
)
from engine import queries, summarize

router = APIRouter()


@router.get("/{ticker}", response_model=SecurityResponse)
def get_security(
    ticker: str,
    days: int | None = Query(
        None,
        ge=1,
        description="Limit price history to the most recent N calendar days. "
                    "Omit for full history (5+ years).",
    ),
) -> SecurityResponse:
    """Deep-dive payload for one security: header, factor scores, prices,
    fundamentals, and recent SEC filings."""
    ticker = ticker.upper()
    header = queries.security_header(ticker)
    if header is None:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker!r} not found or inactive")

    prices = queries.price_history_rows(ticker, days=days)
    fundamentals = queries.fundamental_metric_rows(ticker)
    filings = queries.filings_for_ticker(ticker)

    return SecurityResponse(
        header=SecurityHeader(**header),
        prices=[PricePoint(**p) for p in prices],
        fundamentals=[FundamentalPoint(**f) for f in fundamentals],
        filings=[FilingRow(**f) for f in filings],
    )


def _to_summary(cached: dict) -> FilingSummary:
    return FilingSummary(
        accession_no=cached["accession_no"],
        form=cached.get("form"),
        summary=cached["summary"],
        model=cached.get("model"),
        generated_at=cached["generated_at"],
    )


@router.get("/{ticker}/summary", response_model=SummaryStatusResponse)
def get_summary(ticker: str) -> SummaryStatusResponse:
    """AI summary status for a ticker's latest 10-K: whether a filing exists and
    whether a cached summary is available (read-only, never generates)."""
    ticker = ticker.upper()
    filing = queries.latest_filing(ticker, form="10-K")
    if filing is None:
        return SummaryStatusResponse(
            ticker=ticker, has_filing=False,
            latest_accession=None, latest_filed_date=None, summary=None,
        )

    cached = queries.get_cached_summary(
        filing["accession_no"], summarize.PROMPT_VERSION, summarize.SCHEMA_VERSION
    )
    return SummaryStatusResponse(
        ticker=ticker,
        has_filing=True,
        latest_accession=filing["accession_no"],
        latest_filed_date=filing["filed_date"],
        summary=_to_summary(cached) if cached else None,
    )


# TODO(auth): generation calls the Anthropic API and costs money per filing —
# gate this endpoint (auth + rate limit) before any public deploy.
@router.post("/{ticker}/summary", response_model=FilingSummary)
def generate_summary(
    ticker: str,
    force: bool = Query(False, description="Re-generate even if a summary is cached."),
) -> FilingSummary:
    """Generate (or return cached) an AI summary of the ticker's latest 10-K.

    Fetches the filing, extracts MD&A + Risk Factors, calls Claude with a
    structured-output schema, and caches the result by accession number.
    """
    ticker = ticker.upper()
    try:
        cached = summarize.get_or_generate_summary(ticker, form="10-K", force=force)
    except RuntimeError as exc:
        # ANTHROPIC_API_KEY missing, or section extraction failed
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"Could not fetch the filing from SEC: {exc}"
        ) from exc

    if cached is None:
        raise HTTPException(
            status_code=404, detail=f"No 10-K on file for {ticker!r} to summarize"
        )
    return _to_summary(cached)
