"""CLI wrapper for the full filing catalog (engine.filing_catalog).

Records every research-relevant SEC form (annual/quarterly/current reports,
proxies, ownership, tender, offerings, status) into the `filings` table so the
deep-dive can browse a company's complete filing history — including foreign
private issuers (20-F/40-F/6-K) that the 10-K-only path never sees.

Usage:
    python scripts/ingest_filings_catalog.py                      # full universe
    python scripts/ingest_filings_catalog.py --tickers ASML BABA  # targeted
    python scripts/ingest_filings_catalog.py --max-fetches 1200   # CI budget

Only the submissions JSON is read (one request per company; no document fetch),
incremental by accession. CONTEXT ONLY — never touches scoring tables.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import filing_catalog  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", nargs="+", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--window-days", type=int, default=filing_catalog.WINDOW_DAYS)
    parser.add_argument("--max-fetches", type=int, default=None)
    args = parser.parse_args()

    result = filing_catalog.run(
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
