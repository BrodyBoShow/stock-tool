"""Programmatic verification of the FRED macro ingestion.

Runs against the live database AND the live FRED API (needs FRED_API_KEY in
.env). Verifies:
  1. ingestion pulls all 5 tracked series and writes rows to macro_series
  2. each series logs a 'success' row to job_runs
  3. a re-run is idempotent — the macro_series row count does not grow

Read-only except for the macro_series writes performed by the ingestion
itself (which is the whole point). Macro is CONTEXT ONLY; this never touches
scoring/pipeline tables.

Run with:
    .venv\\Scripts\\python.exe scripts\\verify_macro.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.db import get_connection  # noqa: E402
from scripts.ingest_macro import SERIES_IDS, run  # noqa: E402


def ok(msg: str) -> None:
    print(f"[OK]   {msg}")


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    sys.exit(1)


def macro_count() -> int:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM macro_series")
            return int(cur.fetchone()[0])
    finally:
        conn.close()


def per_series_counts() -> dict[str, int]:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT series_id, count(*) FROM macro_series "
                "WHERE series_id = ANY(%s) GROUP BY series_id",
                (SERIES_IDS,),
            )
            return {sid: int(c) for sid, c in cur.fetchall()}
    finally:
        conn.close()


def job_status(job_id: int) -> tuple[str, int | None]:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, rows_affected FROM job_runs WHERE id = %s",
                (job_id,),
            )
            row = cur.fetchone()
            return (row[0], row[1]) if row else ("missing", None)
    finally:
        conn.close()


# ── preflight ────────────────────────────────────────────────────────────────
if not os.getenv("FRED_API_KEY"):
    fail(
        "FRED_API_KEY is not set in .env. Get a free key at "
        "https://fredaccount.stlouisfed.org/apikeys and add it as "
        "FRED_API_KEY=... before running this verification."
    )

print(f"Tracked series: {', '.join(SERIES_IDS)}")

# ── first run ────────────────────────────────────────────────────────────────
print("\n--- first ingestion run ---")
summary1 = run()
print(
    f"  loaded={summary1['series_loaded']} empty={summary1['series_empty']} "
    f"failed={summary1['series_failed']} rows={summary1['rows_upserted']} "
    f"job_id={summary1['job_id']}"
)

if summary1["series_failed"]:
    fail(f"some series failed to fetch: {summary1['warnings']}")
if summary1["series_loaded"] != len(SERIES_IDS):
    fail(
        f"expected {len(SERIES_IDS)} series loaded, "
        f"got {summary1['series_loaded']}"
    )
ok(f"all {len(SERIES_IDS)} series loaded")

# job_runs success row
status1, rows1 = job_status(summary1["job_id"])
if status1 != "success":
    fail(f"job_runs[{summary1['job_id']}] status={status1!r}, expected 'success'")
ok(f"job_runs logged success (rows_affected={rows1})")

# every tracked series has rows
counts = per_series_counts()
missing = [s for s in SERIES_IDS if counts.get(s, 0) == 0]
if missing:
    fail(f"series with zero rows: {missing}")
ok("every tracked series has rows: " + ", ".join(f"{s}={counts[s]}" for s in SERIES_IDS))

count_after_first = macro_count()
ok(f"macro_series total rows after first run: {count_after_first}")

# ── second run (idempotency) ─────────────────────────────────────────────────
print("\n--- second ingestion run (idempotency) ---")
summary2 = run()
print(
    f"  loaded={summary2['series_loaded']} rows_upserted={summary2['rows_upserted']} "
    f"job_id={summary2['job_id']}"
)

count_after_second = macro_count()
if count_after_second != count_after_first:
    fail(
        f"re-run changed row count: {count_after_first} -> "
        f"{count_after_second} (expected no growth — dupes!)"
    )
ok(f"re-run added zero dupes (row count stable at {count_after_second})")

status2, _ = job_status(summary2["job_id"])
if status2 != "success":
    fail(f"second job_runs[{summary2['job_id']}] status={status2!r}")
ok("second run also logged job_runs success")

print("\nAll macro ingestion verifications passed.")
