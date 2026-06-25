"""Phase 9 — FastAPI read/write layer for StockBud.

DB credentials live only in the API process env; they are never exposed in
any response body or error message.

Run:
    uvicorn api.main:app --reload

Swagger UI: http://localhost:8000/docs

Access control (deploy):
  - CORS origins come from ALLOWED_ORIGINS (comma-separated); localhost dev
    origins are always allowed.
  - Auth is per-route via `Depends(get_current_user)` (a valid Supabase
    `Authorization: Bearer` token). There is no global auth middleware, so the
    open endpoints — /health, /docs, and the broker OAuth callback (PKCE-guarded,
    carries no token) — stay reachable without a session.
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.auth import CurrentUser
from api.routers import (
    alerts,
    funds,
    lab,
    macro,
    market,
    portfolio,
    quotes,
    screener,
    search,
    securities,
    theses,
    watchlist,
)
from api.schemas import HealthResponse
from engine.db import healthcheck

# Server-side logging. The catch-all handler below logs full tracebacks here
# (visible in the host's log stream); the client only ever sees a generic 500.
log = logging.getLogger("stockbud")
logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Stock Research API",
    description="Read/write layer over the Stock-Tool pipeline database.",
    version="0.1.0",
)

def _allowed_origins() -> list[str]:
    """Deployed frontend origins from env + always-on localhost dev origins."""
    origins = ["http://localhost:5173", "http://localhost:3000"]
    extra = os.getenv("ALLOWED_ORIGINS", "")
    origins += [o.strip() for o in extra.split(",") if o.strip()]
    return origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def _generic_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all: log the full traceback server-side (visible in the host logs),
    but never leak DB connection strings or internal stack traces to the client.

    Registering a handler for base Exception suppresses Starlette's default
    unhandled-500 traceback, so without this log line genuinely unexpected errors
    would vanish with no server-side trace."""
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.on_event("startup")
def _warm_caches() -> None:
    """Open the DB read pool, then start the heavy computations in background
    threads at boot so the first open is usually instant: the ~20s market
    overview and the ~15s screener (both complete-only and full variants).
    start_auto_refresh() then keeps the market cache warm at the current data
    date, so the first open AFTER each nightly is instant too. The pool must open
    first — the warm threads borrow from it."""
    from engine import db, queries
    from engine import market as market_engine

    db.init_pool()
    market_engine.warm()
    market_engine.start_auto_refresh()
    queries.warm_screener()


@app.on_event("shutdown")
def _close_pool() -> None:
    """Release pooled DB connections on shutdown."""
    from engine import db

    db.close_pool()


@app.get("/auth/me", tags=["meta"])
def auth_me(user: CurrentUser) -> dict:
    """Return the authenticated user's id + email — validates a Supabase session.

    The SPA's login probe: a 200 confirms the bearer token verifies, a 401 means
    the user must (re)authenticate.
    """
    return {"id": user.id, "email": user.email}


app.include_router(screener.router, prefix="/screener", tags=["screener"])
app.include_router(securities.router, prefix="/securities", tags=["securities"])
app.include_router(watchlist.router, prefix="/watchlist", tags=["watchlist"])
app.include_router(theses.router, prefix="/theses", tags=["theses"])
app.include_router(macro.router, prefix="/macro", tags=["macro"])
app.include_router(quotes.router, prefix="/quotes", tags=["quotes"])
app.include_router(lab.router, prefix="/lab", tags=["lab"])
app.include_router(portfolio.router, prefix="/portfolio", tags=["portfolio"])
app.include_router(market.router, prefix="/market", tags=["market"])
app.include_router(alerts.router, prefix="/alerts", tags=["alerts"])
app.include_router(funds.router, prefix="/funds", tags=["funds"])
app.include_router(search.router, prefix="/search", tags=["search"])


@app.get("/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    """Liveness + DB connectivity check."""
    db_ok = healthcheck()
    return HealthResponse(status="ok", db="ok" if db_ok else "error")
