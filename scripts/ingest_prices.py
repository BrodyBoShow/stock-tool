"""Phase 3 runner — ingest daily prices + corporate actions.

Usage:
    python scripts/ingest_prices.py [--limit N]

--limit restricts to the first N tickers (handy for a quick smoke test).
Populates prices_daily and corporate_actions, logs to job_runs, prints a summary.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Make the project root importable so `engine` resolves when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.prices import run  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest daily prices + corporate actions.")
    parser.add_argument("--limit", type=int, default=None, help="Only process first N tickers.")
    args = parser.parse_args()

    summary = run(limit=args.limit)

    print("\n=== Price ingestion summary ===")
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
