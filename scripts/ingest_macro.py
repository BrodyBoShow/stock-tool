"""Macro context ingestion — FRED -> macro_series.

Pulls a small set of macro series from the FRED API into macro_series.
Idempotent upsert keyed by (series_id, date); incremental on re-run (fetches
only from each series' latest stored date forward). Single linear pass with
one commit at the end. Logged to job_runs.

MACRO IS CONTEXT ONLY. This script writes to macro_series and nothing else; it
never touches the scoring/pipeline tables and macro never feeds factor scores.

FRED API key: set FRED_API_KEY in .env (free key from
https://fredaccount.stlouisfed.org/apikeys). Not wired into the cron yet —
run manually:

    python scripts/ingest_macro.py
"""

from __future__ import annotations

import os
import sys
import time
from abc import ABC, abstractmethod
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Make the project root importable so `engine` resolves when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.db import get_connection  # noqa: E402
from engine.jobs import finish_job, start_job  # noqa: E402

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

JOB_NAME = "macro_ingestion"
JOB_VERSION = "v1"

# Align the backfill window with price history (engine/prices.BACKFILL_YEARS)
# so a macro overlay lines up with the deepdive's 5-year price chart.
BACKFILL_YEARS = 5
THROTTLE_SECONDS = 0.3          # polite gap between series
RETRY_BACKOFF = (3, 10, 30)     # seconds between attempts; len+1 total attempts

# The macro series we track. CONTEXT ONLY — never feeds scoring.
#   DGS10    10-year Treasury constant maturity rate (daily, %)
#   DGS2     2-year Treasury constant maturity rate (daily, %)
#   FEDFUNDS effective federal funds rate (monthly, %)
#   CPIAUCSL CPI-U, all items, seasonally adjusted (monthly, index)
#   VIXCLS   CBOE volatility index (daily, level)
#   DTWEXBGS Nominal broad US dollar index (daily, index)
#   BAMLH0A0HYM2 ICE BofA US high-yield option-adjusted spread (daily, %)
#   T10YIE   10-year breakeven inflation rate (daily, %) — forward inflation
#            expectations, for the market forward-regime read
SERIES_IDS = ["DGS10", "DGS2", "FEDFUNDS", "CPIAUCSL", "VIXCLS", "DTWEXBGS",
              "BAMLH0A0HYM2", "T10YIE"]

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"


def _f(x) -> float | None:
    """Coerce to float; FRED encodes a missing observation as '.' -> None."""
    if x is None:
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


class MacroProvider(ABC):
    """Swappable macro-series source. Returns [(date, value)] sorted ascending."""

    @abstractmethod
    def fetch(self, series_id: str, start: date, end: date) -> list[tuple[date, float]]:
        """Return observations in [start, end] as (date, value), missing dropped."""
        raise NotImplementedError


class FredProvider(MacroProvider):
    """FRED API-backed provider. Requires a free FRED_API_KEY."""

    name = "fred"

    def __init__(self, api_key: str):
        if not api_key:
            raise RuntimeError(
                "FRED_API_KEY is not set. Get a free key at "
                "https://fredaccount.stlouisfed.org/apikeys and add it to .env "
                "as FRED_API_KEY=..."
            )
        self.api_key = api_key

    def fetch(self, series_id: str, start: date, end: date) -> list[tuple[date, float]]:
        params = {
            "series_id": series_id,
            "api_key": self.api_key,
            "file_type": "json",
            "observation_start": start.isoformat(),
            "observation_end": end.isoformat(),
        }
        last_exc: Exception | None = None
        for attempt in range(len(RETRY_BACKOFF) + 1):
            try:
                resp = httpx.get(FRED_URL, params=params, timeout=30.0)
                resp.raise_for_status()
                return self._normalize(resp.json())
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < len(RETRY_BACKOFF):
                    time.sleep(RETRY_BACKOFF[attempt])
        raise last_exc  # exhausted retries

    @staticmethod
    def _normalize(payload: dict) -> list[tuple[date, float]]:
        out: list[tuple[date, float]] = []
        for obs in payload.get("observations", []):
            v = _f(obs.get("value"))  # '.' (missing) -> None, dropped below
            if v is None:
                continue
            d = datetime.strptime(obs["date"], "%Y-%m-%d").date()
            out.append((d, v))
        out.sort(key=lambda r: r[0])
        return out


def _latest_dates(cur) -> dict[str, date]:
    cur.execute(
        "SELECT series_id, max(date) FROM macro_series "
        "WHERE series_id = ANY(%s) GROUP BY series_id",
        (SERIES_IDS,),
    )
    return {sid: d for sid, d in cur.fetchall()}


def _upsert_series(cur, series_id: str, observations: list[tuple[date, float]]) -> int:
    rows = [(series_id, d, v) for d, v in observations]
    if not rows:
        return 0
    cur.executemany(
        """
        INSERT INTO macro_series (series_id, date, value)
        VALUES (%s, %s, %s)
        ON CONFLICT (series_id, date) DO UPDATE SET value = EXCLUDED.value
        """,
        rows,
    )
    return len(rows)


def run(provider: MacroProvider | None = None, backfill_years: int = BACKFILL_YEARS) -> dict:
    """Ingest the tracked macro series into macro_series. Returns a summary."""
    provider = provider or FredProvider(os.getenv("FRED_API_KEY", ""))
    today = datetime.now(UTC).date()
    backfill_start = today - timedelta(days=365 * backfill_years)

    warnings: list[str] = []
    series_loaded = 0
    series_empty = 0
    series_failed = 0
    total_rows = 0

    conn = get_connection()
    job_id = start_job(conn, JOB_NAME, job_version=JOB_VERSION, data_date=today)

    try:
        with conn.cursor() as cur:
            latest = _latest_dates(cur)

        # Single linear pass; accumulate all upserts, commit once at the end.
        with conn.cursor() as cur:
            for series_id in SERIES_IDS:
                # Incremental: refetch from the last stored date forward so FRED
                # revisions (e.g. CPI) are re-upserted; full backfill if new.
                start = latest.get(series_id) or backfill_start
                try:
                    obs = provider.fetch(series_id, start, today)
                except Exception as exc:  # noqa: BLE001
                    series_failed += 1
                    warnings.append(f"{series_id}: fetch failed - {exc!r}")
                    time.sleep(THROTTLE_SECONDS)
                    continue

                if not obs:
                    series_empty += 1
                    warnings.append(f"{series_id}: no observations for {start}..{today}")
                    time.sleep(THROTTLE_SECONDS)
                    continue

                total_rows += _upsert_series(cur, series_id, obs)
                series_loaded += 1
                time.sleep(THROTTLE_SECONDS)

        conn.commit()  # commit at end (single linear pass)

        finish_job(
            conn, job_id, status="success",
            rows_affected=total_rows, warnings=warnings or None,
        )
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        finish_job(conn, job_id, status="failed", error=str(exc), warnings=warnings or None)
        conn.close()
        raise
    finally:
        if not conn.closed:
            conn.close()

    return {
        "series_total": len(SERIES_IDS),
        "series_loaded": series_loaded,
        "series_empty": series_empty,
        "series_failed": series_failed,
        "rows_upserted": total_rows,
        "warnings": warnings,
        "job_id": job_id,
    }


def main() -> int:
    summary = run()

    print("\n=== Macro ingestion summary ===")
    print(f"  Series in scope    : {summary['series_total']}")
    print(f"  Series loaded      : {summary['series_loaded']}")
    print(f"  Series empty       : {summary['series_empty']}")
    print(f"  Series failed      : {summary['series_failed']}")
    print(f"  Rows upserted      : {summary['rows_upserted']}")
    print(f"  job_runs id        : {summary['job_id']}")

    warnings = summary["warnings"]
    if warnings:
        print(f"\n  Warnings ({len(warnings)}):")
        for w in warnings:
            print(f"    - {w}")
    else:
        print("\n  No warnings.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
