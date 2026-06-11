"""CLI wrapper for Form 4 insider-transaction ingestion (engine.insiders).

Usage:
    python scripts/ingest_insiders.py                      # full universe
    python scripts/ingest_insiders.py --tickers NVDA APA   # targeted
    python scripts/ingest_insiders.py --max-fetches 6000   # CI time budget

Incremental by accession: re-runs only fetch filings not yet stored, so the
first invocation is the backfill and nightly runs are cheap deltas. CONTEXT
ONLY — never touches scoring tables.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import insiders  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", nargs="+", default=None,
                        help="restrict to specific tickers")
    parser.add_argument("--limit", type=int, default=None,
                        help="first N companies only (debugging)")
    parser.add_argument("--window-days", type=int, default=insiders.WINDOW_DAYS,
                        help=f"lookback window (default {insiders.WINDOW_DAYS})")
    parser.add_argument("--max-fetches", type=int, default=None,
                        help="SEC fetch budget for this run (CI self-bounding)")
    args = parser.parse_args()

    result = insiders.run(
        limit=args.limit,
        tickers=args.tickers,
        window_days=args.window_days,
        max_fetches=args.max_fetches,
    )
    print(
        f"\nCompanies {result['companies_done']}/{result['companies_total']}  "
        f"filings {result['filings_parsed']}  rows {result['rows_written']}  "
        f"fetches {result['fetches']}  failed {result['companies_failed']}  "
        f"job_runs id {result['job_id']}"
    )
    if result["budget_hit"]:
        print("Fetch budget reached - remaining companies roll to the next run.")
    if result["warnings"]:
        print(f"Warnings: {len(result['warnings'])} (see job_runs)")
        for w in result["warnings"][:10]:
            print(f"  WARN {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
