from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query

from api.schemas import (
    BriefStatusResponse,
    DecisionBrief,
    FactorTrendPoint,
    FilingRow,
    FilingSummary,
    FundamentalPoint,
    InsiderResponse,
    InsiderTransaction,
    InsiderWindow,
    PricePoint,
    SecurityHeader,
    SecurityResponse,
    SummaryStatusResponse,
)
from engine import brief as brief_engine
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


@router.get("/{ticker}/insiders", response_model=InsiderResponse)
def get_insiders(ticker: str) -> InsiderResponse:
    """Form 4 insider activity: 3m/12m open-market buy/sell aggregates plus
    the recent transaction list. Context only — never feeds factor scores."""
    ticker = ticker.upper()
    header = queries.security_header(ticker)
    if header is None:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker!r} not found or inactive")

    rows = queries.insider_rows(ticker, months=12)
    return InsiderResponse(
        ticker=ticker,
        windows=[
            InsiderWindow(**queries.insider_summary(rows, months=3)),
            InsiderWindow(**queries.insider_summary(rows, months=12)),
        ],
        transactions=[InsiderTransaction(**r) for r in rows[:60]],
    )


def _to_brief(cached: dict) -> DecisionBrief:
    return DecisionBrief(
        score_date=cached["score_date"],
        brief=cached["brief"],
        model=cached.get("model"),
        generated_at=cached["generated_at"],
    )


@router.get("/{ticker}/brief", response_model=BriefStatusResponse)
def get_brief(ticker: str) -> BriefStatusResponse:
    """Decision Brief status: factor-rank trend (always, from our own score
    history) plus the cached brief for the latest snapshot if one exists.
    Read-only — never generates."""
    ticker = ticker.upper()
    header = queries.security_header(ticker)
    if header is None:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker!r} not found or inactive")

    trend = queries.factor_history(ticker)
    has_scores = header.get("score_date") is not None
    cached = None
    if has_scores:
        cached = queries.get_cached_brief(
            header["security_id"], header["score_date"],
            brief_engine.PROMPT_VERSION, brief_engine.SCHEMA_VERSION,
        )
    return BriefStatusResponse(
        ticker=ticker,
        has_scores=has_scores,
        trend=[FactorTrendPoint(**t) for t in trend],
        brief=_to_brief(cached) if cached else None,
    )


# TODO(auth): generation calls the Anthropic API and costs money per snapshot —
# gate this endpoint (auth + rate limit) before any public deploy.
@router.post("/{ticker}/brief", response_model=DecisionBrief)
def generate_brief(
    ticker: str,
    force: bool = Query(False, description="Re-generate even if a brief is cached."),
) -> DecisionBrief:
    """Generate (or return cached) the Decision Brief for the latest scoring
    snapshot: bull/bear case, catalyst, risk, data confidence, next questions —
    synthesized strictly from StockBud's own data."""
    ticker = ticker.upper()
    try:
        cached = brief_engine.get_or_generate_brief(ticker, force=force)
    except RuntimeError as exc:  # ANTHROPIC_API_KEY missing
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if cached is None:
        raise HTTPException(
            status_code=404,
            detail=f"{ticker!r} has no factor scores yet — no brief to build",
        )
    return _to_brief(cached)


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
