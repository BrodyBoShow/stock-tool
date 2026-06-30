"""Backfill v5_qmean factor_scores for the historical score_dates that prior
configs already covered, so the screener's delta chips / 7-day signal dots /
30-day sparklines have real same-config history to chart.

v5_qmean was cut over today, so it has a single score_date — the movement
features need a series. This re-scores each past date AS OF that date (the same
point-in-time path the backtest uses; no look-ahead) and writes it under
config_version='v5_qmean'. Additive + reversible (delete v5_qmean rows where
score_date < today to undo). Resumable: dates v5 already has are skipped.

Run OFF-HOURS — heavy full-universe reads, must not overlap the nightly.

Usage:  python scripts/backfill_v5_history.py [--config-source v2_linear]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from engine import scoring  # noqa: E402
from engine.db import get_connection  # noqa: E402

TARGET = "v5_qmean"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config-source", default="v2_linear",
                    help="config whose historical score_dates define the backfill grid")
    args = ap.parse_args()

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT max(score_date) FROM factor_scores WHERE config_version = %s",
                    (TARGET,))
        latest = cur.fetchone()[0]
        cur.execute(
            "SELECT DISTINCT score_date FROM factor_scores "
            "WHERE config_version = %s AND score_date < %s ORDER BY score_date",
            (args.config_source, latest),
        )
        grid = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT DISTINCT score_date FROM factor_scores WHERE config_version = %s",
                    (TARGET,))
        have = {r[0] for r in cur.fetchall()}

    todo = [d for d in grid if d not in have]
    print(f"[backfill] v5_qmean has {len(have)} date(s); {len(todo)} to backfill: "
          f"{[str(d) for d in todo]}", flush=True)

    for i, d in enumerate(todo, 1):
        out = scoring.run(config_version=TARGET, as_of=d, write=True, log_job=False)
        print(f"[backfill] {i}/{len(todo)} as_of={d} -> score_date="
              f"{out.get('score_date')}", flush=True)
    print("[backfill] done", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
