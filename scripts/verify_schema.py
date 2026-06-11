"""Verify that every table from BUILD_SPEC.md exists in the database.

Usage:
    python scripts/verify_schema.py

Connects read-only, queries information_schema, and prints a checklist
confirming each expected table is present. Exits non-zero if any are missing.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the project root importable so `engine` resolves when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.db import get_connection  # noqa: E402

# Tables defined in BUILD_SPEC.md, section "## Schema (Postgres)".
EXPECTED_TABLES = [
    "securities",
    "universe_membership",
    "prices_daily",
    "corporate_actions",
    "filings",
    "concept_map",
    "xbrl_facts",
    "metric_config",
    "fundamental_metrics",
    "score_config",
    "factor_scores",
    "watchlist",
    "theses",
    "ai_summaries",
    "decision_briefs",
    "insider_transactions",
    "macro_series",
    "job_runs",
]


def fetch_existing_tables() -> set[str]:
    """Return the set of public-schema base table names (read-only)."""
    with get_connection() as conn:
        # Make the session read-only: this script must never mutate the DB.
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_type = 'BASE TABLE'
                """
            )
            return {row[0] for row in cur.fetchall()}


def main() -> int:
    try:
        existing = fetch_existing_tables()
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] Could not query the database: {exc}")
        print("Check DATABASE_URL in .env and that you applied the migrations.")
        return 1

    print("Schema verification — expected tables from BUILD_SPEC.md:\n")
    missing = []
    for table in EXPECTED_TABLES:
        present = table in existing
        mark = "[OK]  " if present else "[MISS]"
        print(f"  {mark} {table}")
        if not present:
            missing.append(table)

    print()
    if missing:
        print(f"[FAIL] {len(missing)} of {len(EXPECTED_TABLES)} tables missing: "
              f"{', '.join(missing)}")
        return 1

    print(f"[OK] All {len(EXPECTED_TABLES)} expected tables present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
