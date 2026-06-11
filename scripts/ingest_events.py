"""CLI wrapper for 8-K material-event ingestion (engine.events).

Usage:
    python scripts/ingest_events.py                      # full universe
    python scripts/ingest_events.py --tickers NVDA AAPL  # targeted
    python scripts/ingest_events.py --max-fetches 600    # CI time budget

Only the submissions JSON is read (one request per company; no document
fetch), so a full pass is ~500 light requests. Incremental by accession.
CONTEXT ONLY — never touches scoring tables.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import events  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", nargs="+", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--window-days", type=int, default=events.WINDOW_DAYS)
    parser.add_argument("--max-fetches", type=int, default=None)
    args = parser.parse_args()

    result = events.run(
        limit=args.limit,
        tickers=args.tickers,
        window_days=args.window_days,
        max_fetches=args.max_fetches,
    )
    print(
        f"\nCompanies {result['companies_done']}/{result['companies_total']}  "
        f"new filings {result['filings_ingested']}  rows {result['rows_written']}  "
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
