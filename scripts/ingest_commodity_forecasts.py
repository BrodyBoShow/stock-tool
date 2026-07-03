"""Commodity forecast ingestion — EIA STEO -> commodity_forecasts.

Pulls forward oil & natural-gas price forecasts from the US Energy Information
Administration's Short-Term Energy Outlook (STEO) via the EIA Open Data API v2
into commodity_forecasts. STEO republishes a full ~18-month forward path each
month; we store each pull tagged with a monthly `vintage` so provenance is
explicit ("per EIA STEO, 2026-06 edition"). Idempotent upsert keyed by
(series_id, period, vintage). Logged to job_runs.

COMMODITY FORECASTS ARE CONTEXT ONLY. This script writes to commodity_forecasts
and nothing else; it never touches the scoring/pipeline tables and the forecast
never feeds factor scores. It powers a forward-looking "commodity backdrop"
flag (engine/commodity_backdrop.py) that warns when a name's trailing valuation
may be flattered by a commodity price that is forecast to fall.

EIA API key: set EIA_API_KEY in .env (free key from
https://www.eia.gov/opendata/register.php). The nightly workflow refreshes this
automatically — add it as a GitHub Actions secret (EIA_API_KEY) too, or the
nightly commodity-forecast step is skipped.

    python scripts/ingest_commodity_forecasts.py
"""

from __future__ import annotations

import os
import sys
import time
from abc import ABC, abstractmethod
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Make the project root importable so `engine` resolves when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.db import get_connection  # noqa: E402
from engine.jobs import finish_job, start_job  # noqa: E402

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

JOB_NAME = "commodity_forecast_ingestion"
JOB_VERSION = "v1"

# How far back to pull actuals alongside the forward path. STEO's forward
# horizon is ~18 months; a couple of years of history gives context and lets us
# show where the forecast departs from realized prices.
HISTORY_YEARS = 2
RETRY_BACKOFF = (3, 10, 30)  # seconds between attempts; len+1 total attempts

# EIA STEO series we track — the commodities that drive our Energy/Materials
# names. CONTEXT ONLY — never feeds scoring.
#   WTIPUUS  West Texas Intermediate crude spot, $/bbl (monthly)
#   BREPUUS  Brent crude spot, $/bbl (monthly)
#   NGHHMCF  Henry Hub natural gas spot, $/MMBtu (monthly)
SERIES_IDS = ["WTIPUUS", "BREPUUS", "NGHHMCF"]

EIA_STEO_URL = "https://api.eia.gov/v2/steo/data/"


def _f(x) -> float | None:
    if x is None:
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _parse_period(p: str) -> date | None:
    """STEO monthly period is 'YYYY-MM' -> first of that month."""
    try:
        return datetime.strptime(p, "%Y-%m").date()
    except (TypeError, ValueError):
        return None


class CommodityForecastProvider(ABC):
    """Swappable STEO source. Returns [(series_id, period_date, value)]."""

    @abstractmethod
    def fetch(self, series_ids: list[str], start: date) -> list[tuple[str, date, float]]:
        raise NotImplementedError


class EiaProvider(CommodityForecastProvider):
    """EIA Open Data API v2 provider. Requires a free EIA_API_KEY."""

    name = "eia"

    def __init__(self, api_key: str):
        if not api_key:
            raise RuntimeError(
                "EIA_API_KEY is not set. Get a free key at "
                "https://www.eia.gov/opendata/register.php and add it to .env "
                "as EIA_API_KEY=..."
            )
        self.api_key = api_key

    def fetch(self, series_ids: list[str], start: date) -> list[tuple[str, date, float]]:
        # v2 uses repeated facets[seriesId][] params + a length cap. One request
        # covers all series and the whole window (a few hundred rows total).
        params: list[tuple[str, str]] = [
            ("api_key", self.api_key),
            ("frequency", "monthly"),
            ("data[]", "value"),
            ("start", start.strftime("%Y-%m")),
            ("sort[0][column]", "period"),
            ("sort[0][direction]", "asc"),
            ("length", "5000"),
        ]
        params += [("facets[seriesId][]", s) for s in series_ids]

        last_exc: Exception | None = None
        for attempt in range(len(RETRY_BACKOFF) + 1):
            try:
                resp = httpx.get(EIA_STEO_URL, params=params, timeout=45.0)
                resp.raise_for_status()
                return self._normalize(resp.json())
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < len(RETRY_BACKOFF):
                    time.sleep(RETRY_BACKOFF[attempt])
        raise last_exc  # exhausted retries

    @staticmethod
    def _normalize(payload: dict) -> list[tuple[str, date, float]]:
        rows = (payload.get("response") or {}).get("data") or []
        out: list[tuple[str, date, float]] = []
        for r in rows:
            sid = r.get("seriesId")
            d = _parse_period(r.get("period"))
            v = _f(r.get("value"))
            if sid and d is not None and v is not None:
                out.append((sid, d, v))
        out.sort(key=lambda t: (t[0], t[1]))
        return out


def _upsert(cur, rows: list[tuple[str, date, float]], vintage: date, boundary: date) -> int:
    """Upsert a fetched path under a single vintage. `is_forecast` is an
    APPROXIMATE calendar hint (period >= this month) — the EIA value endpoint
    doesn't expose the true actual/forecast boundary, so the backdrop display
    never makes a load-bearing "realized" claim from it (it labels the near
    anchor "near-term", not a spot)."""
    if not rows:
        return 0
    payload = [
        (sid, period, value, period >= boundary, vintage)
        for sid, period, value in rows
    ]
    cur.executemany(
        """
        INSERT INTO commodity_forecasts (series_id, period, value, is_forecast, vintage)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (series_id, period, vintage)
        DO UPDATE SET value = EXCLUDED.value, is_forecast = EXCLUDED.is_forecast,
                      fetched_at = now()
        """,
        payload,
    )
    return len(payload)


def run(provider: CommodityForecastProvider | None = None) -> dict:
    """Ingest the STEO forecast paths into commodity_forecasts. Returns a summary."""
    provider = provider or EiaProvider(os.getenv("EIA_API_KEY", ""))
    today = datetime.now(UTC).date()
    boundary = today.replace(day=1)                       # this month forward = forecast
    vintage = boundary                                    # the ~current STEO edition
    start = date(today.year - HISTORY_YEARS, today.month, 1)

    warnings: list[str] = []
    rows_upserted = 0
    series_seen: set[str] = set()

    conn = get_connection()
    job_id = start_job(conn, JOB_NAME, job_version=JOB_VERSION, data_date=today)

    try:
        try:
            rows = provider.fetch(SERIES_IDS, start)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"EIA STEO fetch failed: {exc!r}") from exc

        for sid, _, _ in rows:
            series_seen.add(sid)
        for sid in SERIES_IDS:
            if sid not in series_seen:
                warnings.append(f"{sid}: no rows returned")

        with conn.cursor() as cur:
            rows_upserted = _upsert(cur, rows, vintage, boundary)
        conn.commit()

        finish_job(
            conn, job_id, status="success",
            rows_affected=rows_upserted, warnings=warnings or None,
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
        "series_loaded": len(series_seen),
        "rows_upserted": rows_upserted,
        "vintage": vintage.isoformat(),
        "warnings": warnings,
        "job_id": job_id,
    }


def main() -> int:
    summary = run()
    print("\n=== Commodity forecast ingestion summary ===")
    print(f"  Series in scope : {summary['series_total']}")
    print(f"  Series loaded   : {summary['series_loaded']}")
    print(f"  Rows upserted   : {summary['rows_upserted']}")
    print(f"  Vintage         : {summary['vintage']}")
    print(f"  job_runs id     : {summary['job_id']}")
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
