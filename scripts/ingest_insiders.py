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
    parser.add_argument("--incremental", action="store_true",
                        help="only fetch companies with a new Form 4 in the filings "
                             "catalog since their last stored transaction — the cheap "
                             "nightly delta (the intraday + weekly full sweeps backstop it)")
    args = parser.parse_args()

    tickers = args.tickers
    if args.incremental and not tickers:
        tickers = insiders.companies_with_new_form4()
        if not tickers:
            print("Incremental: no company has a new Form 4 since its last refresh — skipping.")
            return 0
        print(f"Incremental: {len(tickers)} name(s) with new Form 4s since last refresh.")

    result = insiders.run(
        limit=args.limit,
        tickers=tickers,
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
