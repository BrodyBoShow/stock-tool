"""Refresh daily prices + corporate actions for the active universe.

Usage:
    python scripts/ingest_prices.py [--limit N] [--provider yfinance|tiingo]

Incremental: each ticker is fetched from its last stored date forward. Uses the
rate-limit-patient bulk runner (the same engine path the nightly uses), so a
throttled source is waited out rather than skipped. --limit restricts to the
first N tickers (smoke test). For the one-time broad backfill of names with NO
price history, see scripts/backfill_prices_bulk.py.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.prices import make_provider, run_bulk_backfill  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh daily prices + corporate actions.")
    parser.add_argument("--limit", type=int, default=None, help="Only process first N tickers.")
    parser.add_argument(
        "--provider", default="yfinance", choices=["yfinance", "tiingo"],
        help="Price source. tiingo needs TIINGO_API_KEY; its FREE tier caps at "
             "~500 unique symbols/month, so use it for small scopes unless paid.",
    )
    args = parser.parse_args()

    summary = run_bulk_backfill(
        make_provider(args.provider),
        only_missing=False,
        active_only=True,
        limit=args.limit,
    )

    print("\n=== Price refresh summary ===")
    print(f"  Tickers in scope        : {summary['tickers_total']}")
    print(f"  Tickers loaded          : {summary['tickers_loaded']}")
    print(f"  Tickers empty (no data) : {summary['tickers_empty']}")
    print(f"  Tickers failed          : {summary['tickers_failed']}")
    print(f"  Price rows upserted     : {summary['price_rows_upserted']}")
    print(f"  Splits captured         : {summary['splits_captured']}")
    print(f"  Dividends captured      : {summary['dividends_captured']}")
    print(f"  job_runs id             : {summary['job_id']}")

    warnings = summary["warnings"]
    if warnings:
        print(f"\n  Warnings ({len(warnings)}):")
        for w in warnings[:50]:
            print(f"    - {w}")
        if len(warnings) > 50:
            print(f"    ... and {len(warnings) - 50} more")
    else:
        print("\n  No warnings.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
