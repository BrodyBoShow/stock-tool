from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query

from api.schemas import (
    BriefStatusResponse,
    DecisionBrief,
    EventsResponse,
    FactorTrendPoint,
    FilingAnswers,
    FilingQaStatusResponse,
    FilingRow,
    FilingSummary,
    FundamentalPoint,
    InsiderResponse,
    InsiderTransaction,
    InsiderWindow,
    MaterialEvent,
    PricePoint,
    SecurityHeader,
    SecurityResponse,
    SummaryStatusResponse,
)
from engine import brief as brief_engine
from engine import events as events_engine
from engine import filing_qa as filing_qa_engine
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


@router.get("/{ticker}/events", response_model=EventsResponse)
def get_events(ticker: str) -> EventsResponse:
    """Recent 8-K material events (last 12 months), newest first, with
    plain-English item labels and a high-signal flag. Context only."""
    ticker = ticker.upper()
    header = queries.security_header(ticker)
    if header is None:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker!r} not found or inactive")

    rows = queries.events_for_ticker(ticker, months=12)
    events = [
        MaterialEvent(
            event_date=r["event_date"],
            filed_date=r["filed_date"],
            form=r["form"],
            items=r["items"],
            labels=[events_engine.label_for(i) for i in r["items"]],
            high_signal=any(i in events_engine.HIGH_SIGNAL_ITEMS for i in r["items"]),
            primary_doc_url=r["primary_doc_url"],
            accession_no=r["accession_no"],
        )
        for r in rows
    ]
    return EventsResponse(ticker=ticker, events=events)


def _to_filing_qa(cached: dict) -> FilingAnswers:
    return FilingAnswers(
        accession_no=cached["accession_no"],
        form=cached.get("form"),
        answers=cached["answers"],
        model=cached.get("model"),
        generated_at=cached["generated_at"],
    )


@router.get("/{ticker}/filing-qa", response_model=FilingQaStatusResponse)
def get_filing_qa(ticker: str) -> FilingQaStatusResponse:
    """Deep filing-diligence status: whether a 10-K exists and whether cached
    answers are available (read-only, never generates)."""
    ticker = ticker.upper()
    filing = queries.latest_filing(ticker, form="10-K")
    if filing is None:
        return FilingQaStatusResponse(
            ticker=ticker, has_filing=False,
            latest_accession=None, latest_filed_date=None, answers=None,
        )
    cached = queries.get_cached_filing_qa(
        filing["accession_no"], filing_qa_engine.PROMPT_VERSION,
        filing_qa_engine.SCHEMA_VERSION,
    )
    return FilingQaStatusResponse(
        ticker=ticker,
        has_filing=True,
        latest_accession=filing["accession_no"],
        latest_filed_date=filing["filed_date"],
        answers=_to_filing_qa(cached) if cached else None,
    )


# TODO(auth): the deepest/most expensive call in the app (Opus over a large
# filing context) — gate this endpoint (auth + rate limit) before public.
@router.post("/{ticker}/filing-qa", response_model=FilingAnswers)
def generate_filing_qa(
    ticker: str,
    force: bool = Query(False, description="Re-generate even if cached."),
) -> FilingAnswers:
    """Run (or return cached) the deep filing-diligence analysis: reads the
    latest 10-K (Items 1/1A/7/7A) + 10-Q MD&A and answers the diligence
    framework, strictly grounded in the filing text."""
    ticker = ticker.upper()
    try:
        cached = filing_qa_engine.get_or_generate_filing_qa(ticker, force=force)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"Could not fetch the filing from SEC: {exc}"
        ) from exc

    if cached is None:
        raise HTTPException(
            status_code=404, detail=f"No 10-K on file for {ticker!r} to analyze"
        )
    return _to_filing_qa(cached)


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
        # Use latest_brief (any score_date) so smart-refresh reuse is visible:
        # the POST may serve a still-valid brief from a prior snapshot date,
        # and get_cached_brief (exact score_date) would miss it.
        cached = queries.latest_brief(
            header["security_id"],
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
