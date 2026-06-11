"""One-time bulk price backfill for the expanded universe (rate-limit aware).

Usage:
    python scripts/backfill_prices_bulk.py [--all]

By default only fetches securities with NO existing price rows (the ~7,100 new
NYSE/Nasdaq names added in the universe expansion), leaving the original S&P 500
names — which the nightly job keeps current — untouched. Pass --all to also
re-touch already-loaded names.

Resumable: commits per ticker, so stopping and restarting picks up where the DB
left off. Recognizes Yahoo rate-limits and sleeps through escalating cooldowns
rather than churning the universe.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.prices import run_bulk_backfill  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Bulk historical price backfill.")
    ap.add_argument(
        "--all", action="store_true",
        help="Also re-touch tickers that already have prices (default: only missing).",
    )
    args = ap.parse_args()

    s = run_bulk_backfill(only_missing=not args.all)
    print("\n=== Bulk price backfill summary ===")
    print(f"  Tickers in scope        : {s['tickers_total']}")
    print(f"  Tickers loaded          : {s['tickers_loaded']}")
    print(f"  Tickers empty (no data) : {s['tickers_empty']}")
    print(f"  Tickers failed          : {s['tickers_failed']}")
    print(f"  Price rows upserted     : {s['price_rows_upserted']}")
    print(f"  job_runs id             : {s['job_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
