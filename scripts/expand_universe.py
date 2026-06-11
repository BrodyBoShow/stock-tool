"""Expand the universe to all NYSE/Nasdaq SEC filers (engine.universe.run_broad).

Usage:
    python scripts/expand_universe.py

Inserts every NYSE/Nasdaq-listed ticker as an active security (sector-preserving
for existing S&P 500 names). The heavy backfills (prices, fundamentals, scoring,
insiders, events) are run separately afterward by the standard ingestion scripts
on the now-larger active universe.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.universe import run_broad  # noqa: E402


def main() -> int:
    s = run_broad()
    print("\n=== Universe expansion (NYSE/Nasdaq) ===")
    print(f"  SEC filers read         : {s['listed_total']}")
    print(f"  Securities upserted     : {s['upserted_securities']}")
    print(f"  New membership rows     : {s['new_membership_rows']}")
    print(f"  Dropped (not NYSE/Nasdaq): {s['dropped_not_nyse_nasdaq']}")
    print(f"  job_runs id             : {s['job_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
