from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from api.ratelimit import rate_limit
from api.schemas import (
    BriefStatusResponse,
    DecisionBrief,
    EventsResponse,
    FactorSet,
    FactorTrendPoint,
    FilingAnswers,
    FilingQaStatusResponse,
    FilingRow,
    FilingSummary,
    FundamentalPoint,
    InsiderResponse,
    InsiderTransaction,
    InsiderWindow,
    LiveFactorsResponse,
    MaterialEvent,
    PricePoint,
    SecurityHeader,
    SecurityResponse,
    SummaryStatusResponse,
)
from engine import brief as brief_engine
from engine import events as events_engine
from engine import filing_qa as filing_qa_engine
from engine import live_factors, queries, summarize
from engine import quotes as quotes_engine
from engine.filing_taxonomy import analysis_profile, form_category, form_label

log = logging.getLogger(__name__)

router = APIRouter()


def _require_active(ticker: str) -> tuple[str, dict]:
    """Upper-case the ticker and load its header; 404 if it isn't a known active
    security. Shared by the deep-dive read endpoints (was copy-pasted 5×)."""
    ticker = ticker.upper()
    header = queries.security_header(ticker)
    if header is None:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker!r} not found or inactive")
    return ticker, header


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
    ticker, header = _require_active(ticker)

    prices = queries.price_history_rows(ticker, days=days)
    fundamentals = queries.fundamental_metric_rows(ticker)
    filings = queries.filings_for_ticker(ticker)

    return SecurityResponse(
        header=SecurityHeader(**header),
        prices=[PricePoint(**p) for p in prices],
        fundamentals=[FundamentalPoint(**f) for f in fundamentals],
        filings=[
            FilingRow(
                **f,
                label=form_label(f["form"]),
                category=form_category(f["form"]),
                analyzable=analysis_profile(f["form"]) is not None,
            )
            for f in filings
        ],
    )


@router.get("/{ticker}/live-factors", response_model=LiveFactorsResponse)
def get_live_factors(ticker: str) -> LiveFactorsResponse:
    """Live-adjusted Value/Momentum/Composite for one security: the price-driven
    sub-signals recomputed from the latest (~15m delayed) quote against last
    night's frozen cross-section. Growth/Quality are held nightly. Display only."""
    ticker, header = _require_active(ticker)

    quote = quotes_engine.get_quote_one(ticker)
    adj = live_factors.live_adjust(header["security_id"], quote["price"])
    if adj is None:
        # Not scored yet — no factor view to adjust.
        return LiveFactorsResponse(
            ticker=ticker, has_scores=False, live=False,
            price=quote["price"], as_of_epoch=quote["as_of_epoch"], stale=quote["stale"],
            live_factors=None, nightly=None,
        )
    return LiveFactorsResponse(
        ticker=ticker,
        has_scores=True,
        live=adj["live"],
        price=adj["price"],
        as_of_epoch=quote["as_of_epoch"],
        stale=quote["stale"],
        live_factors=FactorSet(
            growth=adj["growth"], value=adj["value"], quality=adj["quality"],
            momentum=adj["momentum"], composite=adj["composite"],
        ),
        nightly=FactorSet(**adj["nightly"]),
    )


def _to_summary(cached: dict) -> FilingSummary:
    return FilingSummary(
        accession_no=cached["accession_no"],
        form=cached.get("form"),
        summary=cached["summary"],
        model=cached.get("model"),
        generated_at=cached["generated_at"],
    )


def _resolve_summary_filing(
    ticker: str, form: str | None, accession: str | None
) -> dict | None:
    """Resolve which filing the Overview targets: a specific accession, the latest
    of a named form, or (default) the company's primary annual report."""
    if accession:
        return queries.filing_by_accession(accession)
    if form:
        return queries.latest_filing(ticker, form=form)
    return queries.primary_annual_filing(ticker)


@router.get("/{ticker}/summary", response_model=SummaryStatusResponse)
def get_summary(
    ticker: str,
    form: str | None = Query(None, description="Specific form (e.g. 20-F); "
                             "default = primary annual report."),
    accession: str | None = Query(None, description="Summarize this exact filing."),
) -> SummaryStatusResponse:
    """AI-summary status for a ticker's filing: whether an analyzable filing exists
    and whether a cached summary is available (read-only, never generates).

    Default target is the primary annual report (10-K, else 20-F, else 40-F) so
    foreign private issuers resolve to their 20-F instead of returning nothing.
    """
    ticker = ticker.upper()
    filing = _resolve_summary_filing(ticker, form, accession)
    analyzable = filing is not None and analysis_profile(filing["form"]) is not None
    if not analyzable:
        return SummaryStatusResponse(
            ticker=ticker, has_filing=False, latest_accession=None,
            latest_filed_date=None,
            latest_form=filing["form"] if filing else None, summary=None,
        )

    cached = queries.get_cached_summary(
        filing["accession_no"], summarize.PROMPT_VERSION, summarize.SCHEMA_VERSION
    )
    return SummaryStatusResponse(
        ticker=ticker,
        has_filing=True,
        latest_accession=filing["accession_no"],
        latest_filed_date=filing["filed_date"],
        latest_form=filing["form"],
        summary=_to_summary(cached) if cached else None,
    )


@router.get("/{ticker}/insiders", response_model=InsiderResponse)
def get_insiders(ticker: str) -> InsiderResponse:
    """Form 4 insider activity: 3m/12m open-market buy/sell aggregates plus
    the recent transaction list. Context only — never feeds factor scores."""
    ticker, header = _require_active(ticker)

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
    ticker, header = _require_active(ticker)

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
    """Deep filing-diligence status: whether an analyzable annual report (10-K or
    20-F) exists and whether cached answers are available (read-only, never
    generates). A company with only a 40-F reports has_filing=False (deep
    diligence is reliable only on full 10-K/20-F item layouts)."""
    ticker = ticker.upper()
    filing = queries.primary_annual_filing(ticker)
    analyzable = (
        filing is not None
        and analysis_profile(filing["form"]) in ("annual_10k", "annual_20f")
    )
    if not analyzable:
        return FilingQaStatusResponse(
            ticker=ticker, has_filing=False, latest_accession=None,
            latest_filed_date=None,
            latest_form=filing["form"] if filing else None, answers=None,
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
        latest_form=filing["form"],
        answers=_to_filing_qa(cached) if cached else None,
    )


# TODO(auth): the deepest/most expensive call in the app (Opus over a large
# filing context) — gate this endpoint (auth + rate limit) before public.
@router.post(
    "/{ticker}/filing-qa",
    response_model=FilingAnswers,
    dependencies=[Depends(rate_limit(5, 300))],  # Opus-class cost — tightest cap
)
def generate_filing_qa(
    ticker: str,
    force: bool = Query(False, description="Re-generate even if cached."),
) -> FilingAnswers:
    """Run (or return cached) the deep filing-diligence analysis: reads the
    latest annual report — 10-K (Items 1/1A/7/7A) + 10-Q MD&A for domestic
    filers, or 20-F (business/risk/MD&A/market-risk) for foreign private issuers —
    and answers the diligence framework, strictly grounded in the filing text."""
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
            status_code=404,
            detail=f"No analyzable annual report (10-K or 20-F) on file for "
                   f"{ticker!r} to analyze",
        )
    return _to_filing_qa(cached)


def _to_brief(cached: dict) -> DecisionBrief:
    return DecisionBrief(
        score_date=cached["score_date"],
        brief=cached["brief"],
        model=cached.get("model"),
        generated_at=cached["generated_at"],
    )


def _kick_brief(ticker: str) -> None:
    """Background task: generate brief silently; errors are logged, not raised."""
    try:
        brief_engine.get_or_generate_brief(ticker)
    except Exception:
        log.exception("Background brief generation failed for %s", ticker)


@router.get("/{ticker}/brief", response_model=BriefStatusResponse)
def get_brief(ticker: str, background_tasks: BackgroundTasks) -> BriefStatusResponse:
    """Decision Brief status: factor-rank trend (always, from our own score
    history) plus the cached brief if one exists.  When no brief is cached yet,
    kicks off generation as a background task so the frontend can poll and pick
    it up automatically — no user click required."""
    ticker, header = _require_active(ticker)

    trend = queries.factor_history(ticker)
    has_scores = header.get("score_date") is not None
    cached = None
    generating = False
    if has_scores:
        cached = queries.latest_brief(
            header["security_id"],
            brief_engine.PROMPT_VERSION, brief_engine.SCHEMA_VERSION,
        )
        if cached is None and brief_engine.ANTHROPIC_KEY_AVAILABLE:
            background_tasks.add_task(_kick_brief, ticker)
            generating = True
    return BriefStatusResponse(
        ticker=ticker,
        has_scores=has_scores,
        generating=generating,
        trend=[FactorTrendPoint(**t) for t in trend],
        brief=_to_brief(cached) if cached else None,
    )


# TODO(auth): generation calls the Anthropic API and costs money per snapshot —
# gate this endpoint (auth + rate limit) before any public deploy.
@router.post(
    "/{ticker}/brief",
    response_model=DecisionBrief,
    dependencies=[Depends(rate_limit(15, 300))],
)
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
@router.post(
    "/{ticker}/summary",
    response_model=FilingSummary,
    dependencies=[Depends(rate_limit(15, 300))],
)
def generate_summary(
    ticker: str,
    form: str | None = Query(None, description="Specific form; default = primary "
                             "annual report."),
    accession: str | None = Query(None, description="Summarize this exact filing."),
    force: bool = Query(False, description="Re-generate even if a summary is cached."),
) -> FilingSummary:
    """Generate (or return cached) an AI summary of a filing.

    Default target is the primary annual report (10-K/20-F/40-F); pass ?form= or
    ?accession= to summarize a specific filing (proxy, S-1, 6-K, …). Fetches the
    filing, extracts the relevant sections, calls Claude with a structured-output
    schema, and caches by accession number.
    """
    ticker = ticker.upper()
    try:
        cached = summarize.get_or_generate_summary(
            ticker, form=form, accession=accession, force=force
        )
    except RuntimeError as exc:
        # ANTHROPIC_API_KEY missing, or section extraction failed
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"Could not fetch the filing from SEC: {exc}"
        ) from exc

    if cached is None:
        raise HTTPException(
            status_code=404,
            detail=f"No analyzable filing found for {ticker!r} to summarize",
        )
    return _to_summary(cached)
