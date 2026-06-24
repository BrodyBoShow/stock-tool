"""Massive (formerly Polygon.io) daily-price + corporate-action ingestion.

Why this exists alongside engine.prices (yfinance): yfinance is an unofficial
scrape that rate-limits hard and needs the whole patient batch/backoff machinery
in engine.prices. Massive is an official API whose **Grouped Daily** endpoint
returns OHLCV for EVERY US ticker in a SINGLE request — so the nightly EOD
refresh is ~1 call per trading day for the entire universe instead of thousands
of per-ticker scrapes. The free "Stocks Basic" tier (5 req/min, EOD, 2y history)
is plenty for this because we only ever pull a few recent days per night.

Scope (Phase 1):
  * Prices  — grouped-daily, upserted into prices_daily (same schema/semantics as
    engine.prices, so downstream code is unchanged).
  * Corporate actions — recent splits + dividends from the reference endpoints,
    upserted into corporate_actions (source='massive'). Included here, not left
    to "Phase 2", so making Massive the nightly primary does not silently stop
    dividend/split capture.

adj_close note: grouped-daily (adjusted=false) gives raw OHLC. We store raw close
into BOTH close and adj_close for freshly-written recent bars — correct at recent
dates (Yahoo anchors adj_close≈close at the latest bar) and matching what the
yfinance path writes for the same window. A full historical adj_close
re-adjustment when a NEW split lands is a known follow-up (the yfinance path has
the same 15-day-window limitation); the captured corporate_actions make it doable.

Falls back cleanly: run_nightly prefers this when MASSIVE_API_KEY is set and uses
engine.prices.run_daily_refresh() if it errors or returns thin coverage.
"""

from __future__ import annotations

import os
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv

from engine.db import get_connection
from engine.db import reopen as _reopen
from engine.jobs import finish_job, start_job

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

JOB_NAME = "price_ingestion"
JOB_VERSION = "massive-v1"

# api.polygon.io and api.massive.com both serve the same API after the 2025
# rebrand; polygon host is the long-tested one. Override with MASSIVE_BASE_URL.
BASE_URL = os.getenv("MASSIVE_BASE_URL", "https://api.polygon.io").rstrip("/")

DAILY_LOOKBACK_DAYS = 5          # refetch the last few calendar days (idempotent)
ACTIONS_LOOKBACK_DAYS = 10       # window for recent splits/dividends
THROTTLE_SECONDS = 13.0          # free tier is 5 req/min -> >=12s between calls
RATE_LIMIT_BACKOFF = (15, 30, 60)  # extra sleeps on a 429 before giving up a call


def _api_key() -> str:
    key = os.getenv("MASSIVE_API_KEY") or os.getenv("POLYGON_API_KEY")
    if not key:
        raise RuntimeError("MASSIVE_API_KEY (or POLYGON_API_KEY) is not set in .env")
    return key


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=BASE_URL,
        timeout=60,
        headers={"Authorization": f"Bearer {_api_key()}", "Accept": "application/json"},
    )


def _get(client: httpx.Client, path: str, params: dict | None = None) -> dict:
    """GET with patient 429 handling (free tier is 5 req/min)."""
    last_exc: Exception | None = None
    for attempt in range(len(RATE_LIMIT_BACKOFF) + 1):
        try:
            resp = client.get(path, params=params or {})
            if resp.status_code == 429:
                raise RuntimeError("Too Many Requests (Massive 429)")
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < len(RATE_LIMIT_BACKOFF):
                time.sleep(RATE_LIMIT_BACKOFF[attempt])
    raise last_exc  # type: ignore[misc]


def _safe_float(x) -> float | None:
    """Parse a numeric API field, returning None for missing/non-numeric values
    so one bad row is skipped instead of aborting the whole night's batch."""
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def grouped_daily(client: httpx.Client, d: date, *, adjusted: bool = False) -> list[dict]:
    """Daily OHLCV for every US stock on date `d`, in one request.

    Each result: {T: ticker, o, h, l, c, v, vw, t, n}. Empty on holidays/weekends.
    """
    payload = _get(
        client,
        f"/v2/aggs/grouped/locale/us/market/stocks/{d.isoformat()}",
        {"adjusted": str(adjusted).lower()},
    )
    return payload.get("results") or []


def _paginated(
    client: httpx.Client, path: str, params: dict, *, max_pages: int = 100
) -> list[dict]:
    """Collect all pages of a v3 reference endpoint (follows next_url).

    Hard-capped at max_pages with a seen-url guard so a buggy or self-referential
    next_url from the API can't loop the nightly job indefinitely (the call sites
    already bound the result set with .gte/.lte + limit; this is defense-in-depth)."""
    out: list[dict] = []
    payload = _get(client, path, params)
    out.extend(payload.get("results") or [])
    next_url = payload.get("next_url")
    seen: set[str] = set()
    pages = 1
    while next_url and pages < max_pages and next_url not in seen:
        seen.add(next_url)
        time.sleep(THROTTLE_SECONDS)
        # next_url is absolute; strip the base so the client's base_url applies.
        rel = next_url[len(BASE_URL):] if next_url.startswith(BASE_URL) else next_url
        payload = _get(client, rel)
        out.extend(payload.get("results") or [])
        next_url = payload.get("next_url")
        pages += 1
    return out


def _ticker_map(cur) -> dict[str, int]:
    """ticker -> security_id for ALL securities (grouped-daily covers everyone, so
    one call refreshes active names, staged-inactive names, and funds alike)."""
    cur.execute("SELECT security_id, ticker FROM securities")
    return {t: sid for sid, t in cur.fetchall()}


def _upsert_price_rows(cur, rows: list[tuple]) -> int:
    if not rows:
        return 0
    cur.executemany(
        """
        INSERT INTO prices_daily (security_id, date, open, high, low, close, adj_close, volume)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (security_id, date) DO UPDATE
          SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
              close = EXCLUDED.close, adj_close = EXCLUDED.adj_close, volume = EXCLUDED.volume
        """,
        rows,
    )
    return len(rows)


def _upsert_action_rows(cur, rows: list[tuple]) -> int:
    if not rows:
        return 0
    cur.executemany(
        """
        INSERT INTO corporate_actions (security_id, ex_date, action_type, ratio, amount, source)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (security_id, ex_date, action_type) DO UPDATE
          SET ratio = EXCLUDED.ratio, amount = EXCLUDED.amount, source = EXCLUDED.source
        """,
        rows,
    )
    return len(rows)


def run_daily_refresh(
    *,
    lookback_days: int = DAILY_LOOKBACK_DAYS,
    actions_lookback_days: int = ACTIONS_LOOKBACK_DAYS,
    throttle: float = THROTTLE_SECONDS,
) -> dict:
    """Nightly EOD refresh via Massive grouped-daily + recent corporate actions.

    Returns the same summary shape as engine.prices.run_daily_refresh so the
    nightly orchestrator can treat the two interchangeably.
    """
    today = datetime.now(UTC).date()
    warnings: list[str] = []
    total_rows = 0
    days_loaded = 0
    splits = dividends = 0

    conn = get_connection()
    job_id = start_job(conn, JOB_NAME, job_version=JOB_VERSION, data_date=today)
    client = _client()
    try:
        with conn.cursor() as cur:
            tmap = _ticker_map(cur)

        # ── prices: one grouped-daily call per recent weekday ────────────────
        day_dates = [today - timedelta(days=n) for n in range(lookback_days, -1, -1)]
        day_dates = [d for d in day_dates if d.weekday() < 5]  # skip weekends
        for i, d in enumerate(day_dates):
            if i:
                time.sleep(throttle)
            try:
                results = grouped_daily(client, d, adjusted=False)
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"grouped-daily {d} failed: {exc!r}")
                continue
            if not results:
                continue  # holiday / not posted yet
            rows = []
            for r in results:
                sid = tmap.get(r.get("T"))
                close = r.get("c")
                if sid is None or close is None:
                    continue
                vol = r.get("v")
                rows.append((
                    sid, d, r.get("o"), r.get("h"), r.get("l"),
                    close, close,  # adj_close = raw close for recent bars (see module note)
                    int(vol) if vol is not None else None,
                ))
            if conn.closed:
                conn = _reopen(conn)
            with conn.cursor() as cur:
                n = _upsert_price_rows(cur, rows)
            conn.commit()
            total_rows += n
            days_loaded += 1
            print(f"[massive] {d}: {n} price rows upserted", flush=True)

        # ── corporate actions: recent splits + dividends ─────────────────────
        since = (today - timedelta(days=actions_lookback_days)).isoformat()
        try:
            time.sleep(throttle)
            split_rows = []
            # Bound BOTH ends: the reference endpoints also return future-announced
            # actions (ex-dates years out), which without an upper bound paginate
            # into thousands of rows. We only want what actually went ex recently.
            for s in _paginated(client, "/v3/reference/splits",
                                {"execution_date.gte": since,
                                 "execution_date.lte": today.isoformat(), "limit": 1000}):
                sid = tmap.get(s.get("ticker"))
                ex = s.get("execution_date")
                frm, to = _safe_float(s.get("split_from")), _safe_float(s.get("split_to"))
                if sid is None or not ex or not frm or not to:
                    continue
                split_rows.append((sid, ex, "split", to / frm, None, "massive"))
            if conn.closed:
                conn = _reopen(conn)
            with conn.cursor() as cur:
                splits = _upsert_action_rows(cur, split_rows)
            conn.commit()
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"splits fetch failed: {exc!r}")

        try:
            time.sleep(throttle)
            div_rows = []
            for dv in _paginated(client, "/v3/reference/dividends",
                                 {"ex_dividend_date.gte": since,
                                  "ex_dividend_date.lte": today.isoformat(), "limit": 1000}):
                sid = tmap.get(dv.get("ticker"))
                ex = dv.get("ex_dividend_date")
                amt = _safe_float(dv.get("cash_amount"))
                if sid is None or not ex or amt is None:
                    continue
                div_rows.append((sid, ex, "dividend", None, amt, "massive"))
            if conn.closed:
                conn = _reopen(conn)
            with conn.cursor() as cur:
                dividends = _upsert_action_rows(cur, div_rows)
            conn.commit()
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"dividends fetch failed: {exc!r}")

        if conn.closed:
            conn = _reopen(conn)
        finish_job(conn, job_id, status="success",
                   rows_affected=total_rows, warnings=warnings or None)
    except Exception as exc:  # noqa: BLE001
        try:
            conn = _reopen(conn)
            finish_job(conn, job_id, status="failed", error=str(exc), warnings=warnings or None)
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        client.close()
        try:
            if conn is not None and not conn.closed:
                conn.close()
        except Exception:  # noqa: BLE001
            pass

    print(f"[massive] DONE: {days_loaded} day(s), rows={total_rows}, "
          f"splits={splits}, divs={dividends}", flush=True)
    # Shape-compatible with engine.prices.run_daily_refresh (tickers_* are per-row
    # here, not per-ticker, since grouped-daily is by-date).
    return {
        "tickers_total": len(tmap),
        "tickers_loaded": total_rows,
        "tickers_empty": 0,
        "tickers_failed": 0,
        "price_rows_upserted": total_rows,
        "splits_captured": splits,
        "dividends_captured": dividends,
        "days_loaded": days_loaded,
        "warnings": warnings,
        "job_id": job_id,
    }
