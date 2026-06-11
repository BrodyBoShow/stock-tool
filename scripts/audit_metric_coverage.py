"""How widely are the factor sub-metrics populated? Read-only.

Reads factor_scores.details.inputs for every active security at the latest
score_date and reports, per metric, how many companies have a non-null value —
overall and by sector. Pinpoints whether a gap (e.g. EV/EBITDA, gross margin)
is universe-wide (likely a pipeline/mapping fix) or concentrated in a sector
(likely a genuine reporting difference).
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from engine.db import get_connection  # noqa: E402

METRICS = [
    "pe", "ps", "ev_ebitda", "fcf_yield",
    "gross_margin", "operating_margin", "roic",
    "debt_to_equity", "net_debt_ebitda",
    "revenue_cagr", "eps_growth",
]


def main() -> int:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT max(score_date) FROM factor_scores")
            score_date = cur.fetchone()[0]
            cur.execute(
                """
                SELECT s.sector, fs.details
                FROM factor_scores fs
                JOIN securities s ON s.security_id = fs.security_id
                WHERE fs.score_date = %s AND s.is_active
                """,
                (score_date,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    total = len(rows)
    present = defaultdict(int)                       # metric -> count present
    by_sector_total: dict[str, int] = defaultdict(int)
    by_sector_present: dict[tuple, int] = defaultdict(int)

    for sector, details in rows:
        sector = sector or "—"
        by_sector_total[sector] += 1
        d = details if isinstance(details, dict) else json.loads(details or "{}")
        inputs = d.get("inputs", {}) or {}
        for m in METRICS:
            v = inputs.get(m)
            if v is not None:
                present[m] += 1
                by_sector_present[(sector, m)] += 1

    print(f"score_date={score_date}  active securities={total}\n")
    print(f"{'metric':<18}{'present':>9}{'missing':>9}{'cover%':>8}")
    for m in METRICS:
        miss = total - present[m]
        print(f"{m:<18}{present[m]:>9}{miss:>9}{100*present[m]/total:>7.0f}%")

    # focus on the metrics the user flagged as missing
    focus = ["ev_ebitda", "gross_margin", "operating_margin", "debt_to_equity", "net_debt_ebitda"]
    print("\n=== coverage% by sector for the flagged metrics ===\n")
    sectors = sorted(by_sector_total)
    print(f"{'sector':<26}{'n':>4}" + "".join(f"{m[:9]:>11}" for m in focus))
    for sec in sectors:
        n = by_sector_total[sec]
        cells = "".join(
            f"{100*by_sector_present[(sec, m)]/n:>10.0f}%" for m in focus
        )
        print(f"{sec:<26}{n:>4}{cells}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
