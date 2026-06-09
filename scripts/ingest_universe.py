"""Phase 2 runner — ingest the S&P 500 universe.

Usage:
    python scripts/ingest_universe.py

Populates `securities` and `universe_membership`, logs to job_runs,
and prints a short summary.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the project root importable so `engine` resolves when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.universe import run  # noqa: E402


def main() -> int:
    summary = run()

    print("\n=== Universe ingestion summary ===")
    print(f"  Wikipedia constituents read : {summary['total_constituents']}")
    print(f"  Securities upserted         : {summary['upserted_securities']}")
    print(f"  New membership rows opened  : {summary['new_membership_rows']}")
    print(f"  Dropped (no SEC exchange)   : {summary['dropped_no_exchange']}")
    print(f"  Dropped (not NYSE/NASDAQ)   : {summary['dropped_filtered']}")
    print(f"  job_runs id                 : {summary['job_id']}")

    warnings = summary["warnings"]
    if warnings:
        print(f"\n  Warnings ({len(warnings)}):")
        for w in warnings:
            print(f"    - {w}")
    else:
        print("\n  No warnings.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
