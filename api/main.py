"""Phase 9 — FastAPI read/write layer for StockBud.

DB credentials live only in the API process env; they are never exposed in
any response body or error message.

Run:
    uvicorn api.main:app --reload

Swagger UI: http://localhost:8000/docs

SECURITY — required before any public deploy:
  - Restrict CORS origins to the deployed frontend domain.
  - Add authentication to all write endpoints (marked TODO below).
  - Rate-limit write endpoints.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routers import macro, quotes, screener, securities, theses, watchlist
from api.schemas import HealthResponse
from engine.db import healthcheck

app = FastAPI(
    title="Stock Research API",
    description="Read/write layer over the Stock-Tool pipeline database.",
    version="0.1.0",
)

# TODO: restrict origins + add auth before any public deploy
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite React dev
        "http://localhost:3000",  # CRA / Next dev
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def _generic_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all: never leak DB connection strings or internal stack traces."""
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(screener.router, prefix="/screener", tags=["screener"])
app.include_router(securities.router, prefix="/securities", tags=["securities"])
app.include_router(watchlist.router, prefix="/watchlist", tags=["watchlist"])
app.include_router(theses.router, prefix="/theses", tags=["theses"])
app.include_router(macro.router, prefix="/macro", tags=["macro"])
app.include_router(quotes.router, prefix="/quotes", tags=["quotes"])


@app.get("/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    """Liveness + DB connectivity check."""
    db_ok = healthcheck()
    return HealthResponse(status="ok", db="ok" if db_ok else "error")
