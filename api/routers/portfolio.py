from __future__ import annotations

import os
import sys

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse

from api.ratelimit import rate_limit
from api.schemas import (
    LinkConnectRequest,
    LinkConnectResponse,
    LinkedAccountRow,
    LinkedAccountsResponse,
    LinkedProviderInfo,
    LinkSyncResponse,
    PortfolioMutationResponse,
    PortfolioResponse,
    PortfolioTransactionRow,
    PortfolioTransactionsCreateRequest,
    PortfolioTransactionsResponse,
    ProjectionResponse,
)
from engine import portfolio as portfolio_engine
from engine import portfolio_sync
from engine.portfolio_projection import project_portfolio

router = APIRouter()


@router.get(
    "/projection",
    response_model=ProjectionResponse,
    dependencies=[Depends(rate_limit(20, 60))],
)
def get_projection(
    years: int = Query(10, ge=1, le=40),
    monthly: float = Query(0.0, ge=0.0, le=1_000_000.0),
    annual_fee: float = Query(0.0, ge=0.0, le=0.1),
    stress: bool = Query(False),
) -> ProjectionResponse:
    """Correlated Monte Carlo projection cone for the current holdings. Computed
    on demand (a 1k-path sim); display-only, never feeds the factor model."""
    out = project_portfolio(years=years, monthly=monthly, annual_fee=annual_fee, stress=stress)
    return ProjectionResponse(**out)


@router.get("", response_model=PortfolioResponse)
def get_portfolio() -> PortfolioResponse:
    """The whole Portfolio tab: holdings, TWR/MWR performance vs SPY, risk
    stats, factor tilt, allocation, dividend income, and action-center flags —
    all derived live from the transaction ledger (nothing precomputed)."""
    return PortfolioResponse(**portfolio_engine.compute_portfolio())


@router.get("/transactions", response_model=PortfolioTransactionsResponse)
def get_transactions() -> PortfolioTransactionsResponse:
    """Full ledger, newest first."""
    rows = portfolio_engine.get_transactions()
    return PortfolioTransactionsResponse(
        rows=[PortfolioTransactionRow(**r) for r in rows]
    )


# TODO: add authentication before any public deploy
@router.post("/transactions", response_model=PortfolioMutationResponse)
def add_transactions(body: PortfolioTransactionsCreateRequest) -> PortfolioMutationResponse:
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
    inserted, errors = portfolio_engine.add_transactions(items)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="; ".join(errors[:10]) + ("…" if len(errors) > 10 else ""),
        )
    return PortfolioMutationResponse(inserted=inserted, errors=[])


# TODO: add authentication before any public deploy
@router.delete("/transactions/{txn_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(txn_id: int) -> None:
    """Remove one ledger row. 404 if it doesn't exist."""
    if not portfolio_engine.delete_transaction(txn_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction {txn_id} not found",
        )


# ── linked brokerage accounts (scaffold — providers not implemented yet) ──────

@router.get("/links", response_model=LinkedAccountsResponse)
def get_links() -> LinkedAccountsResponse:
    """Linked brokerage accounts + available providers. Tokens are never
    returned. ``ready`` is False until migration 0021 is applied."""
    state = portfolio_sync.list_links()
    return LinkedAccountsResponse(
        ready=state["ready"],
        accounts=[LinkedAccountRow(**a) for a in state["accounts"]],
        providers=[LinkedProviderInfo(**p) for p in portfolio_sync.provider_catalog()],
    )


# TODO: add authentication before any public deploy
@router.post("/links/connect", response_model=LinkConnectResponse)
def connect_link(body: LinkConnectRequest) -> LinkConnectResponse:
    """Begin (or refresh) a brokerage link. Returns a 5-minute connection-portal
    URL the user opens to log in at the broker (read-only). The user never enters
    their broker password here. Unbuilt/unconfigured providers return a status."""
    try:
        out = portfolio_sync.connect(body.provider)
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


# TODO: add authentication before any public deploy
@router.post("/links/{link_id}/sync", response_model=LinkSyncResponse)
def sync_link(link_id: int) -> LinkSyncResponse:
    """Pull new activity for a linked account into the ledger (idempotent)."""
    try:
        out = portfolio_sync.sync_account(link_id)
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


# TODO: add authentication before any public deploy
@router.delete("/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_link(link_id: int) -> None:
    """Unlink an account. Imported transactions are kept (orphaned)."""
    if not portfolio_sync.delete_link(link_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Linked account {link_id} not found",
        )
