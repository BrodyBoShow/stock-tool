"""Programmatic verification of the Phase 9 FastAPI read layer.

Uses FastAPI's TestClient (in-process, no subprocess) -- no server needs to be
running. Covers:

  READ:
    GET /health               -- DB connectivity
    GET /screener             -- row count, shape, numeric fields
    GET /securities/AAPL      -- header values, prices, fundamentals
    GET /watchlist            -- read smoke
    GET /theses               -- read smoke

  WRITE round-trips:
    POST /watchlist AAPL  -> GET confirms it  -> POST again (idempotent)
    DELETE /watchlist/AAPL -> GET confirms removed
    PUT /theses/AAPL      -> GET confirms it  -> PUT again (upsert, one row)
    DELETE /theses/AAPL   -> GET confirms removed

  SECURITY:
    No response body contains the DATABASE_URL connection string.

Run with:
    .venv\\Scripts\\python.exe scripts\\verify_api.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402

client = TestClient(app, raise_server_exceptions=False)

_DB_URL = os.getenv("DATABASE_URL", "")


def ok(msg: str) -> None:
    print(f"[OK]   {msg}")


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    sys.exit(1)


def no_db_leak(text: str, endpoint: str) -> None:
    if _DB_URL and _DB_URL in text:
        fail(f"{endpoint} response leaks DATABASE_URL")
    if "postgresql://" in text or "postgres://" in text:
        fail(f"{endpoint} response leaks a postgres:// connection string")


# -- health -------------------------------------------------------------------
r = client.get("/health")
if r.status_code != 200:
    fail(f"GET /health -> {r.status_code}")
data = r.json()
if data.get("status") != "ok":
    fail(f"health.status={data.get('status')!r}")
if data.get("db") != "ok":
    fail(f"health.db={data.get('db')!r} -- DB connection failed")
no_db_leak(r.text, "GET /health")
ok("GET /health -> ok, db=ok")

# -- screener -----------------------------------------------------------------
r = client.get("/screener")
if r.status_code != 200:
    fail(f"GET /screener -> {r.status_code}: {r.text[:300]}")
no_db_leak(r.text, "GET /screener")
data = r.json()
rows = data.get("rows", [])
if len(rows) < 400:
    fail(f"GET /screener: expected 400+ rows, got {len(rows)}")
ok(f"GET /screener -> {len(rows)} rows (score_date={data.get('score_date')})")

first = rows[0]
for field in ("rank", "ticker", "composite", "growth_pctl", "security_id"):
    if field not in first:
        fail(f"GET /screener row missing field: {field!r}")
if first.get("rank") != 1:
    fail(f"first row rank={first.get('rank')!r}, expected 1")
ok("GET /screener row shape + rank order correct")

# -- securities/AAPL ----------------------------------------------------------
r = client.get("/securities/AAPL")
if r.status_code != 200:
    fail(f"GET /securities/AAPL -> {r.status_code}: {r.text[:300]}")
no_db_leak(r.text, "GET /securities/AAPL")
data = r.json()

header = data.get("header", {})
if header.get("ticker") != "AAPL":
    fail(f"header.ticker={header.get('ticker')!r}")
if header.get("composite") is None:
    fail("AAPL composite is None -- factor scores may not have loaded")
ok(f"GET /securities/AAPL -> composite={header['composite']:.1f}, "
   f"sector={header.get('sector')!r}")

prices = data.get("prices", [])
if len(prices) < 200:
    fail(f"AAPL prices: expected 200+ rows, got {len(prices)}")
ok(f"AAPL prices: {len(prices)} rows")

fundamentals = data.get("fundamentals", [])
if len(fundamentals) == 0:
    fail("AAPL fundamentals: empty")
ok(f"AAPL fundamentals: {len(fundamentals)} rows")

r = client.get("/securities/AAPL?days=365")
if r.status_code != 200:
    fail(f"GET /securities/AAPL?days=365 -> {r.status_code}")
limited = r.json().get("prices", [])
if len(limited) > len(prices):
    fail("?days=365 returned more rows than full history")
ok(f"GET /securities/AAPL?days=365 -> {len(limited)} price rows")

r = client.get("/securities/aapl")
if r.status_code != 200:
    fail(f"GET /securities/aapl (lowercase) -> {r.status_code}")
ok("GET /securities/aapl (lowercase) -> 200 (case normalised)")

r = client.get("/securities/ZZZZZ999")
if r.status_code != 404:
    fail(f"GET /securities/ZZZZZ999 expected 404, got {r.status_code}")
ok("GET /securities/ZZZZZ999 -> 404 (correct)")

# -- watchlist read -----------------------------------------------------------
r = client.get("/watchlist")
if r.status_code != 200:
    fail(f"GET /watchlist -> {r.status_code}")
no_db_leak(r.text, "GET /watchlist")
ok(f"GET /watchlist -> {len(r.json().get('rows', []))} rows")

# -- theses read --------------------------------------------------------------
r = client.get("/theses")
if r.status_code != 200:
    fail(f"GET /theses -> {r.status_code}")
no_db_leak(r.text, "GET /theses")
ok(f"GET /theses -> {len(r.json().get('rows', []))} rows")

# -- watchlist write round-trip -----------------------------------------------
print("\n--- watchlist write round-trip ---")

client.delete("/watchlist/AAPL")

r = client.post("/watchlist", json={"ticker": "AAPL"})
if r.status_code != 200:
    fail(f"POST /watchlist AAPL -> {r.status_code}: {r.text[:300]}")
data = r.json()
if data.get("status") != "added":
    fail(f"expected status='added', got {data.get('status')!r}")
ok("POST /watchlist AAPL -> added")

r = client.post("/watchlist", json={"ticker": "AAPL"})
if r.status_code != 200:
    fail(f"POST /watchlist AAPL (2nd) -> {r.status_code}")
if r.json().get("status") != "already_present":
    fail(f"expected 'already_present', got {r.json().get('status')!r}")
ok("POST /watchlist AAPL again -> already_present (idempotent)")

tickers = [row["ticker"] for row in client.get("/watchlist").json().get("rows", [])]
if "AAPL" not in tickers:
    fail("AAPL missing from GET /watchlist after POST")
ok("GET /watchlist confirms AAPL present")

r = client.delete("/watchlist/AAPL")
if r.status_code != 204:
    fail(f"DELETE /watchlist/AAPL -> {r.status_code}")
ok("DELETE /watchlist/AAPL -> 204")

tickers = [row["ticker"] for row in client.get("/watchlist").json().get("rows", [])]
if "AAPL" in tickers:
    fail("AAPL still in watchlist after DELETE")
ok("GET /watchlist confirms AAPL removed")

r = client.post("/watchlist", json={"ticker": "ZZZZZ999"})
if r.status_code != 404:
    fail(f"POST /watchlist unknown ticker expected 404, got {r.status_code}")
ok("POST /watchlist ZZZZZ999 -> 404 (correct)")

# -- thesis write round-trip --------------------------------------------------
print("\n--- thesis write round-trip ---")

client.delete("/theses/AAPL")

r = client.put("/theses/AAPL", json={
    "summary": "Test thesis for AAPL",
    "invalidation_rules": "Revenue growth falls below 5%",
    "review_date": None,
})
if r.status_code != 200:
    fail(f"PUT /theses/AAPL -> {r.status_code}: {r.text[:300]}")
if r.json().get("status") != "created":
    fail(f"expected 'created', got {r.json().get('status')!r}")
ok("PUT /theses/AAPL -> created")

r = client.put("/theses/AAPL", json={
    "summary": "Updated test thesis for AAPL",
    "review_date": "2026-12-31",
})
if r.status_code != 200:
    fail(f"PUT /theses/AAPL (2nd) -> {r.status_code}")
if r.json().get("status") != "updated":
    fail(f"expected 'updated', got {r.json().get('status')!r}")
ok("PUT /theses/AAPL again -> updated (upsert)")

thesis_tickers = [row["ticker"] for row in client.get("/theses").json().get("rows", [])]
aapl_count = thesis_tickers.count("AAPL")
if aapl_count != 1:
    fail(f"expected 1 AAPL thesis, found {aapl_count}")
ok("GET /theses shows exactly 1 AAPL thesis (not a duplicate)")

r = client.delete("/theses/AAPL")
if r.status_code != 204:
    fail(f"DELETE /theses/AAPL -> {r.status_code}")
ok("DELETE /theses/AAPL -> 204")

thesis_tickers = [row["ticker"] for row in client.get("/theses").json().get("rows", [])]
if "AAPL" in thesis_tickers:
    fail("AAPL thesis still present after DELETE")
ok("GET /theses confirms AAPL thesis removed")

r = client.put("/theses/ZZZZZ999", json={"summary": "ghost"})
if r.status_code != 404:
    fail(f"PUT /theses unknown ticker expected 404, got {r.status_code}")
ok("PUT /theses ZZZZZ999 -> 404 (correct)")

print("\nAll Phase 9 API verifications passed.")
