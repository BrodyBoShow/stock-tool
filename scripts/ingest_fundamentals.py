"""Phase 4 runner — ingest SEC filings index + normalized XBRL facts.

Usage:
    python scripts/ingest_fundamentals.py [--limit N] [--tickers AAPL,MSFT]

--limit processes only the first N companies (smoke test).
--tickers restricts to specific tickers (re-runs after concept-map fixes).
Logs to job_runs and prints a summary.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Make the project root importable so `engine` resolves when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.fundamentals import run  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest SEC fundamentals (filings + facts).")
    parser.add_argument("--limit", type=int, default=None, help="Only first N companies.")
    parser.add_argument("--tickers", type=str, default=None, help="Comma-separated tickers.")
    parser.add_argument(
        "--all", action="store_true",
        help="Include staged-inactive securities (expanded-universe backfill).",
    )
    args = parser.parse_args()

    tickers = [t.strip().upper() for t in args.tickers.split(",")] if args.tickers else None
    summary = run(limit=args.limit, tickers=tickers, include_inactive=args.all)

    print("\n=== Fundamentals ingestion summary ===")
    print(f"  Companies (unique CIKs)   : {summary['companies_total']}")
    print(f"  Companies processed       : {summary['companies_processed']}")
    print(f"  Companies failed          : {summary['companies_failed']}")
    print(f"  Filings rows upserted     : {summary['filings_rows']}")
    print(f"  Fact rows upserted        : {summary['fact_rows']}")
    print(f"  Concept map               : {summary['map_version']} "
          f"({summary['mapped_tags']} raw tags)")
    print(f"  Facts skipped (no fp)     : {summary['skipped_no_fp']}")
    print(f"  YTD durations dropped     : {summary['dropped_ytd_duration']}")
    print(f"  job_runs id               : {summary['job_id']}")

    warnings = summary["warnings"]
    if warnings:
        print(f"\n  Warnings ({len(warnings)}):")
        for w in warnings[:60]:
            print(f"    - {w}")
        if len(warnings) > 60:
            print(f"    ... and {len(warnings) - 60} more")
    else:
        print("\n  No warnings.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
