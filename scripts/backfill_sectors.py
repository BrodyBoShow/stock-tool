"""Fill sector/industry from SEC SIC codes for securities missing them.

Usage:
    python scripts/backfill_sectors.py

Only touches rows where sector IS NULL (the expanded-universe names) — S&P 500
GICS sectors are never overwritten. One SEC submissions-JSON read per CIK.
Resumable: already-filled rows are excluded by the WHERE clause, so re-running
picks up where it left off. Run under scripts/supervise_backfill.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.universe import backfill_sectors_from_sic  # noqa: E402


def main() -> int:
    s = backfill_sectors_from_sic()
    print("\n=== Sector backfill summary ===")
    print(f"  Securities updated : {s['updated']}")
    print(f"  CIKs without SIC   : {s['no_sic']}")
    print(f"  Unmapped SICs      : {s['unmapped']}")
    print(f"  Fetch failures     : {s['failed']}")
    print(f"  job_runs id        : {s['job_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
