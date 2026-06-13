"""Phase 9 — FastAPI read/write layer for StockBud.

DB credentials live only in the API process env; they are never exposed in
any response body or error message.

Run:
    uvicorn api.main:app --reload

Swagger UI: http://localhost:8000/docs

Access control (deploy):
  - CORS origins come from ALLOWED_ORIGINS (comma-separated); localhost dev
    origins are always allowed.
  - APP_ACCESS_PASSWORD gates every endpoint behind an X-App-Password header.
    Set it -> private (only holders of the password get in). Unset it ->
    public. Flipping this one env var is the private<->public switch; no code
    change or redeploy of the image is needed.
"""
from __future__ import annotations

import os
import secrets

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routers import (
    lab,
    macro,
    market,
    portfolio,
    quotes,
    screener,
    securities,
    theses,
    watchlist,
)
from api.schemas import HealthResponse
from engine.db import healthcheck

app = FastAPI(
    title="Stock Research API",
    description="Read/write layer over the Stock-Tool pipeline database.",
    version="0.1.0",
)

# Paths reachable without the access password: health (host liveness probes)
# and the API docs. NOTE: /auth/check is intentionally NOT here — it must stay
# gated so it returns 401 when locked, which is how the frontend detects that a
# password is required (and 200 in public mode, where the middleware no-ops).
_OPEN_PATHS = ("/health", "/docs", "/openapi.json", "/redoc")


@app.middleware("http")
async def _access_password(request: Request, call_next):
    """Require X-App-Password when APP_ACCESS_PASSWORD is set (private mode).

    No-ops when the env var is empty (public mode). CORS preflight (OPTIONS)
    and the open paths always pass so the browser handshake and host health
    checks work even while locked.
    """
    password = os.getenv("APP_ACCESS_PASSWORD", "")
    if (
        password
        and request.method != "OPTIONS"
        and not request.url.path.startswith(_OPEN_PATHS)
    ):
        provided = request.headers.get("X-App-Password", "")
        if not secrets.compare_digest(provided, password):
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


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
    """Catch-all: never leak DB connection strings or internal stack traces."""
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.on_event("startup")
def _warm_caches() -> None:
    """Start the heavy computations in background threads at boot so the first
    open is usually instant: the ~20s market overview and the ~15s screener
    (both complete-only and full variants)."""
    from engine import market as market_engine
    from engine import queries

    market_engine.warm()
    queries.warm_screener()


@app.get("/auth/check", tags=["meta"])
def auth_check() -> dict:
    """Returns 200 when the request is authorized (or no password is set).

    The access middleware returns 401 first when a password is required and the
    header is missing/wrong, so the frontend uses this as its login probe.
    """
    return {"ok": True, "authRequired": bool(os.getenv("APP_ACCESS_PASSWORD", ""))}


app.include_router(screener.router, prefix="/screener", tags=["screener"])
app.include_router(securities.router, prefix="/securities", tags=["securities"])
app.include_router(watchlist.router, prefix="/watchlist", tags=["watchlist"])
app.include_router(theses.router, prefix="/theses", tags=["theses"])
app.include_router(macro.router, prefix="/macro", tags=["macro"])
app.include_router(quotes.router, prefix="/quotes", tags=["quotes"])
app.include_router(lab.router, prefix="/lab", tags=["lab"])
app.include_router(portfolio.router, prefix="/portfolio", tags=["portfolio"])
app.include_router(market.router, prefix="/market", tags=["market"])


@app.get("/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    """Liveness + DB connectivity check."""
    db_ok = healthcheck()
    return HealthResponse(status="ok", db="ok" if db_ok else "error")
