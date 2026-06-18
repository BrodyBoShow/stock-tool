"""Nightly pipeline orchestrator.

Steps (in order):
  1. Incremental price refresh          (engine.prices)
  2. Price sanity check                 (engine.price_sanity)  ← HALT if fails
  3. Universe hygiene                   (engine.universe.deactivate_derivative_listings)
  4. Fundamentals refresh               (engine.fundamentals)
  5. Derived metrics                    (engine.metrics)
  6. Factor scoring                     (engine.scoring)

Fundamentals + metrics moved into the nightly on 2026-06-12: companies file
10-Qs/10-Ks every day (especially in earnings season), and waiting for the
Sunday weekly left ranks computed on stale numbers — plus the weekly's old
resume=True bug meant existing companies were never refreshed at all. The two
steps add ~30-45 min, well inside the workflow timeout.

Usage:
    python scripts/run_nightly.py

Exits non-zero if the sanity check fails; factor scoring is skipped and
factor_scores is NOT updated. Every step logs its own job_runs row.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import (  # noqa: E402
    fundamentals,
    metrics,
    price_sanity,
    prices,
    scoring,
    universe,
)


def main() -> int:
    # --- step 1: price refresh ---
    # Fast batched daily refresh: yf.download pulls ~120 tickers per threaded
    # call (measured ~5-18x faster/ticker than per-ticker history()), so the
    # whole active universe refreshes in minutes instead of hours and triggers
    # far less yfinance throttling. Idempotent + resumable. The patient
    # per-ticker run_bulk_backfill() stays for one-time full backfills of brand-
    # new names (no history yet), which the fixed daily lookback doesn't cover.
    print("\n=== [1/6] Price refresh ===")
    px = prices.run_daily_refresh()
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
    print("\n=== [2/6] Price sanity check ===")
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

    # --- step 3: universe hygiene ---
    # Deactivate warrant/unit/right listings that share a parent CIK (they
    # inherit the parent's fundamentals and otherwise top the screener on pure
    # momentum). Idempotent — a no-op once clean; runs before fundamentals so
    # any newly-graduated derivative is excluded from the heavy work below.
    print("\n=== [3/6] Universe hygiene (deactivate derivative listings) ===")
    deactivated = universe.deactivate_derivative_listings()
    print(f"  Deactivated {deactivated} warrant/unit/right listing(s).")

    # --- step 4: fundamentals refresh ---
    # resume=False: re-fetch every active company so new 10-Q/10-K facts land
    # daily (resume=True is a backfill flag that would skip everyone).
    print("\n=== [4/6] Fundamentals refresh ===")
    fi = fundamentals.run(resume=False)
    print(
        f"  Companies {fi['companies_processed']}/{fi['companies_total']}  "
        f"filings {fi['filings_rows']}  facts {fi['fact_rows']}  "
        f"failed {fi['companies_failed']}  "
        f"job_runs id {fi['job_id']}"
    )
    if fi["warnings"]:
        print(f"  Warnings: {len(fi['warnings'])} (see job_runs id {fi['job_id']})")

    # --- step 5: derived metrics ---
    print("\n=== [5/6] Derived metrics ===")
    me = metrics.run()
    print(
        f"  Companies {me['companies_done']}/{me['companies_total']}  "
        f"metric rows {me['metric_rows']}  "
        f"non-USD filers {me.get('non_usd_companies', 0)}  "
        f"failed {me['companies_failed']}  "
        f"job_runs id {me['job_id']}"
    )
    if me["warnings"]:
        print(f"  Warnings: {len(me['warnings'])} (see job_runs id {me['job_id']})")

    # --- step 6: factor scoring ---
    print("\n=== [6/6] Factor scoring ===")
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
