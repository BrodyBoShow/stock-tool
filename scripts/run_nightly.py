"""Nightly pipeline orchestrator.

Steps (in order):
  1. Incremental price refresh          (engine.prices)
  2. Price sanity check                 (engine.price_sanity)  ← HALT if fails
  3. Factor scoring                     (engine.scoring)

Usage:
    python scripts/run_nightly.py

Exits non-zero if the sanity check fails; factor scoring is skipped and
factor_scores is NOT updated. Every step logs its own job_runs row.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import price_sanity, prices, scoring  # noqa: E402


def main() -> int:
    # --- step 1: price refresh ---
    # The patient bulk runner (incremental from each ticker's last stored date,
    # rate-limit cooldowns that retry the same ticker, reconnect-hardened DB
    # writes) replaced the original per-ticker run() when the universe grew to
    # ~6k names: from a CI IP, yfinance throttling is routine, and the old
    # runner skipped throttled tickers as "empty".
    print("\n=== [1/3] Price refresh ===")
    px = prices.run_bulk_backfill(only_missing=False, active_only=True)
    print(
        f"  Tickers {px['tickers_loaded']}/{px['tickers_total']} loaded  "
        f"rows upserted {px['price_rows_upserted']}  "
        f"splits {px['splits_captured']}  "
        f"failed {px['tickers_failed']}  "
        f"job_runs id {px['job_id']}"
    )
    if px["warnings"]:
        print(f"  Warnings: {len(px['warnings'])} (see job_runs id {px['job_id']})")

    # --- step 2: price sanity check ---
    print("\n=== [2/3] Price sanity check ===")
    sanity = price_sanity.run()
    d = sanity["detail"]
    print(
        f"  latest_date {d.get('latest_date')}  "
        f"age {d.get('age_days')} days  "
        f"coverage {d.get('covered')}/{d.get('universe')} ({d.get('coverage_rate', 0):.1%})  "
        f"zero/neg {d.get('zero_negative_count')}  "
        f"wild-moves {d.get('wild_move_count')}  "
        f"splits-excluded {d.get('split_excluded_count')}"
    )

    if not sanity["passed"]:
        print(
            f"\n  *** SANITY GATE FAILED — factor_scores NOT updated ***\n"
            f"  {len(sanity['breaches'])} breach(es):"
        )
        for b in sanity["breaches"]:
            print(f"    BREACH: {b}")
        print(f"  job_runs id {sanity['job_id']}")
        return 1

    print("  Sanity gate PASSED.")

    # --- step 3: factor scoring ---
    print("\n=== [3/3] Factor scoring ===")
    sc = scoring.run()
    print(
        f"  score_date {sc['score_date']}  "
        f"rows {sc['rows_written']}  "
        f"composite {sc['scored_with_composite']}  "
        f"ROIC true/proxy {sc['true_roic_pool']}/{sc['roa_proxy_pool']}  "
        f"job_runs id {sc['job_id']}"
    )

    print("\nNightly pipeline complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
