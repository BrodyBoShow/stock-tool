"""One-off database healthcheck.

Usage:
    python scripts/healthcheck.py

Prints whether a `SELECT 1` against the configured Supabase Postgres
database succeeded.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the project root importable so `engine` resolves when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.db import healthcheck  # noqa: E402


def main() -> int:
    ok = healthcheck()
    if ok:
        print("[OK] Database healthcheck passed: SELECT 1 returned 1.")
        return 0
    print(
        "[FAIL] Database healthcheck failed. Check that DATABASE_URL in .env "
        "is set to a valid Supabase connection string."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
