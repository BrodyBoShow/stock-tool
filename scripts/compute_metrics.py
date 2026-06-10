"""Phase 5 runner — compute derived metrics into fundamental_metrics.

Usage:
    python scripts/compute_metrics.py [--limit N] [--tickers AAPL,MSFT]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Make the project root importable so `engine` resolves when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.metrics import run  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Compute derived fundamental metrics.")
    parser.add_argument("--limit", type=int, default=None, help="Only first N companies.")
    parser.add_argument("--tickers", type=str, default=None, help="Comma-separated tickers.")
    args = parser.parse_args()

    tickers = [t.strip().upper() for t in args.tickers.split(",")] if args.tickers else None
    summary = run(limit=args.limit, tickers=tickers)

    print("\n=== Metric computation summary ===")
    print(f"  Companies in scope          : {summary['companies_total']}")
    print(f"  Companies processed         : {summary['companies_done']}")
    print(f"  Companies failed            : {summary['companies_failed']}")
    print(f"  Metric rows upserted        : {summary['metric_rows']}")
    print(f"  Full 12-metric coverage     : {summary['full_coverage']}")
    print(f"  EPS proxy companies         : {len(summary['eps_proxy_companies'])} "
          f"{summary['eps_proxy_companies'][:10]}")
    print(f"  ROIC proxy (ROA) companies  : {len(summary['roic_proxy_companies'])} "
          f"{summary['roic_proxy_companies'][:10]}")
    print(f"  TTM reconciliation flagged  : {len(summary['recon_companies'])} "
          f"{summary['recon_companies'][:10]}")
    print(f"  job_runs id                 : {summary['job_id']}")

    warnings = summary["warnings"]
    if warnings:
        print(f"\n  Warnings ({len(warnings)}): (first 40)")
        for w in warnings[:40]:
            print(f"    - {w}")
        if len(warnings) > 40:
            print(f"    ... and {len(warnings) - 40} more")
    else:
        print("\n  No warnings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
