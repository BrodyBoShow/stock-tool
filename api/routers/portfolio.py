from __future__ import annotations

import os
import sys

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse

from api.auth import CurrentUser
from api.ratelimit import rate_limit
from api.schemas import (
    LinkConnectRequest,
    LinkConnectResponse,
    LinkedAccountRow,
    LinkedAccountsResponse,
    LinkedProviderInfo,
    LinkSyncResponse,
    PortfolioAnalyticsResponse,
    PortfolioMutationResponse,
    PortfolioResponse,
    PortfolioTransactionRow,
    PortfolioTransactionsCreateRequest,
    PortfolioTransactionsResponse,
    ProjectionResponse,
    ProjectionRunRequest,
    RiskAlignmentResponse,
)
from engine import portfolio as portfolio_engine
from engine import portfolio_sync, risk_alignment
from engine.portfolio_analytics import portfolio_analytics
from engine.portfolio_projection import project_portfolio

router = APIRouter()


@router.get(
    "/projection",
    response_model=ProjectionResponse,
    dependencies=[Depends(rate_limit(20, 60))],
)
def get_projection(
    user: CurrentUser,
    years: int = Query(10, ge=1, le=40),
    monthly: float = Query(0.0, ge=0.0, le=1_000_000.0),
    annual_fee: float = Query(0.0, ge=0.0, le=0.1),
    stress: bool = Query(False),
) -> ProjectionResponse:
    """Correlated Monte Carlo projection cone for the current holdings. Computed
    on demand (a 1k-path sim); display-only, never feeds the factor model."""
    out = project_portfolio(
        years=years, monthly=monthly, annual_fee=annual_fee, stress=stress,
        owner_id=user.id,
    )
    return ProjectionResponse(**out)


@router.post(
    "/projection",
    response_model=ProjectionResponse,
    dependencies=[Depends(rate_limit(20, 60))],
)
def run_projection(body: ProjectionRunRequest, user: CurrentUser) -> ProjectionResponse:
    """Projection with the extended knobs the Rebalance Simulator needs: custom
    weights (what-if allocation), a goal amount, and a benchmark comparison."""
    out = project_portfolio(
        years=body.years, monthly=body.monthly, annual_fee=body.annual_fee,
        stress=body.stress, owner_id=user.id,
        weights=body.weights, goal=body.goal, compare_bench=body.compare_bench,
    )
    return ProjectionResponse(**out)


@router.get("", response_model=PortfolioResponse)
def get_portfolio(
    user: CurrentUser,
    benchmark: str = Query("SPY", min_length=1, max_length=10),
) -> PortfolioResponse:
    """The whole Portfolio tab: holdings, TWR/MWR performance vs the chosen
    benchmark, risk stats, factor tilt, allocation, dividend income, and
    action cards — all derived live from the transaction ledger."""
    # Broker cash balance (if a linked account reported one) anchors the engine's
    # cash-aware TWR reconstruction, so a sell-to-cash ledger still gets an honest
    # return series. None → engine keeps its prior behavior.
    cash_anchor = portfolio_sync.owner_cash_anchor(owner_id=user.id)
    return PortfolioResponse(
        **portfolio_engine.compute_portfolio(
            owner_id=user.id, benchmark=benchmark, cash_anchor=cash_anchor))


@router.get(
    "/analytics",
    response_model=PortfolioAnalyticsResponse,
    dependencies=[Depends(rate_limit(30, 60))],
)
def get_analytics(
    user: CurrentUser,
    benchmark: str = Query("SPY", min_length=1, max_length=10),
) -> PortfolioAnalyticsResponse:
    """Diagnostics layer: per-holding betas, pairwise correlations, 30-day
    sparklines, the aligned 1Y daily-returns matrix (client-side rebalance
    math), shrunk expected returns, and historical stress tests."""
    return PortfolioAnalyticsResponse(
        **portfolio_analytics(owner_id=user.id, benchmark=benchmark))


@router.get(
    "/risk-alignment",
    response_model=RiskAlignmentResponse,
    dependencies=[Depends(rate_limit(30, 60))],
)
def get_risk_alignment(
    user: CurrentUser,
    benchmark: str = Query("SPY", min_length=1, max_length=10),
    sector: str | None = Query(None, max_length=64),
) -> RiskAlignmentResponse:
    """Portfolio vs the user's stated risk preference: per-holding band fit,
    in-band weight share, profile-aware threshold flags, and idea discovery
    inside the chosen bands. Descriptive only — historical measurements
    compared against a range the user chose; never advice.

    ``sector`` optionally restricts the idea list to one sector; the rest of the
    payload is sector-agnostic."""
    return RiskAlignmentResponse(
        **risk_alignment.risk_alignment(
            owner_id=user.id, benchmark=benchmark, sector=sector))


@router.get("/transactions", response_model=PortfolioTransactionsResponse)
def get_transactions(user: CurrentUser) -> PortfolioTransactionsResponse:
    """Full ledger, newest first."""
    rows = portfolio_engine.get_transactions(owner_id=user.id)
    return PortfolioTransactionsResponse(
        rows=[PortfolioTransactionRow(**r) for r in rows]
    )


@router.post("/transactions", response_model=PortfolioMutationResponse)
def add_transactions(
    body: PortfolioTransactionsCreateRequest, user: CurrentUser
) -> PortfolioMutationResponse:
    """Insert a batch of ledger rows (single add and CSV import share this).

    All-or-nothing: any validation error rejects the whole batch with 422 and
    a per-row error list, so a half-broken CSV never half-imports.
    """
    items = [t.model_dump() for t in body.transactions]
    if not items:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No transactions provided",
        )
    inserted, errors = portfolio_engine.add_transactions(items, owner_id=user.id)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="; ".join(errors[:10]) + ("…" if len(errors) > 10 else ""),
        )
    return PortfolioMutationResponse(inserted=inserted, errors=[])


@router.delete("/transactions/{txn_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(txn_id: int, user: CurrentUser) -> None:
    """Remove one ledger row. 404 if it doesn't exist."""
    if not portfolio_engine.delete_transaction(txn_id, owner_id=user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction {txn_id} not found",
        )


# ── linked brokerage accounts (scaffold — providers not implemented yet) ──────

@router.get("/links", response_model=LinkedAccountsResponse)
def get_links(user: CurrentUser) -> LinkedAccountsResponse:
    """Linked brokerage accounts + available providers. Tokens are never
    returned. ``ready`` is False until migration 0021 is applied."""
    state = portfolio_sync.list_links(owner_id=user.id)
    return LinkedAccountsResponse(
        ready=state["ready"],
        accounts=[LinkedAccountRow(**a) for a in state["accounts"]],
        providers=[LinkedProviderInfo(**p) for p in portfolio_sync.provider_catalog()],
    )


@router.post("/links/connect", response_model=LinkConnectResponse)
def connect_link(body: LinkConnectRequest, user: CurrentUser) -> LinkConnectResponse:
    """Begin (or refresh) a brokerage link. Returns a 5-minute connection-portal
    URL the user opens to log in at the broker (read-only). The user never enters
    their broker password here. Unbuilt/unconfigured providers return a status."""
    try:
        out = portfolio_sync.connect(body.provider, owner_id=user.id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from None
    except Exception as exc:  # noqa: BLE001 - surface a clean error, not a 500
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not start the brokerage link: {exc}",
        ) from exc
    return LinkConnectResponse(
        status=out["status"],
        authorize_url=out.get("authorize_url"),
        link_id=out.get("link_id"),
        detail=out.get("detail"),
    )


@router.get("/links/callback")
def links_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """OAuth redirect target for SnapTrade personal linking. Exchanges the auth
    code for tokens, stores them, and bounces the browser back to the Portfolio
    tab. Never surfaces error detail in the URL."""
    frontend = os.getenv("FRONTEND_URL", "http://localhost:5173")
    if error or not code or not state:
        print(f"[oauth-callback] declined/missing: error={error!r} "
              f"have_code={bool(code)} have_state={bool(state)}", file=sys.stderr, flush=True)
        return RedirectResponse(f"{frontend}/portfolio?linked=error")
    try:
        portfolio_sync.complete_oauth(state, code)
    except httpx.HTTPStatusError as exc:  # token exchange rejected
        body = exc.response.text[:400] if exc.response is not None else ""
        print(f"[oauth-callback] token exchange failed: {exc.response.status_code} {body}",
              file=sys.stderr, flush=True)
        return RedirectResponse(f"{frontend}/portfolio?linked=error")
    except Exception as exc:  # noqa: BLE001 - log, but don't leak details to the URL
        print(f"[oauth-callback] failed: {type(exc).__name__}: {exc}",
              file=sys.stderr, flush=True)
        return RedirectResponse(f"{frontend}/portfolio?linked=error")
    return RedirectResponse(f"{frontend}/portfolio?linked=ok")


@router.post("/links/{link_id}/sync", response_model=LinkSyncResponse)
def sync_link(link_id: int, user: CurrentUser) -> LinkSyncResponse:
    """Pull new activity for a linked account into the ledger (idempotent)."""
    try:
        out = portfolio_sync.sync_account(link_id, owner_id=user.id)
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Linked account {link_id} not found",
        ) from None
    except NotImplementedError as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None
    except Exception as exc:  # noqa: BLE001 - external API failure -> clean error
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Sync failed: {exc}"
        ) from exc
    return LinkSyncResponse(**out)


@router.delete("/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_link(link_id: int, user: CurrentUser) -> None:
    """Unlink an account. Imported transactions are kept (orphaned)."""
    if not portfolio_sync.delete_link(link_id, owner_id=user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Linked account {link_id} not found",
        )
