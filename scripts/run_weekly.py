"""Weekly pipeline orchestrator.

Steps (in order):
  1. Fundamentals refresh   (engine.fundamentals) — filings + xbrl_facts
  2. Derived metrics        (engine.metrics)       — fundamental_metrics
  3. Full quality gate      (engine.quality)       ← HALT if fails
  4. Factor scoring         (engine.scoring)

Usage:
    python scripts/run_weekly.py

Exits non-zero if the quality gate fails; factor scoring is skipped and
factor_scores is NOT updated. Every step logs its own job_runs row.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import fundamentals, metrics, quality, scoring  # noqa: E402


def main() -> int:
    # --- step 1: fundamentals refresh ---
    print("\n=== [1/4] Fundamentals refresh ===")
    fi = fundamentals.run()
    print(
        f"  Companies {fi['companies_processed']}/{fi['companies_total']}  "
        f"filings {fi['filings_rows']}  facts {fi['fact_rows']}  "
        f"failed {fi['companies_failed']}  "
        f"job_runs id {fi['job_id']}"
    )
    if fi["warnings"]:
        print(f"  Warnings: {len(fi['warnings'])} (see job_runs id {fi['job_id']})")

    # --- step 2: derived metrics ---
    print("\n=== [2/4] Derived metrics ===")
    me = metrics.run()
    print(
        f"  Companies {me['companies_done']}/{me['companies_total']}  "
        f"metric rows {me['metric_rows']}  "
        f"failed {me['companies_failed']}  "
        f"job_runs id {me['job_id']}"
    )
    if me["warnings"]:
        print(f"  Warnings: {len(me['warnings'])} (see job_runs id {me['job_id']})")

    # --- step 3: quality gate ---
    print("\n=== [3/4] Quality gate (Phase 5b full suite) ===")
    qa = quality.run()
    print(
        f"  Checks {qa['checks']}  failures {qa['failures']}  "
        f"job_runs id {qa['job_id']}"
    )

    if qa["failures"] > 0:
        print(
            f"\n  *** QUALITY GATE FAILED ({qa['failures']} failure(s) in "
            f"{qa['checks']} checks) — factor_scores NOT updated ***"
        )
        # Surface failing rows for CI log visibility
        for r in qa["value_rows"]:
            if not r["ok"]:
                print(f"    FAIL value  {r['ticker']} {r['fy_end']} {r['metric']}: {r['detail']}")
        for name, target, ok, detail in qa["behavior_rows"]:
            if not ok:
                print(f"    FAIL behavior  {name} {target}: {detail}")
        for name, ok, detail in qa["pit_rows"]:
            if not ok:
                print(f"    FAIL pit  {name}: {detail}")
        for name, ok, detail, breaches in qa["gate_rows"]:
            if not ok:
                print(f"    FAIL gate  {name}: {detail}")
                for b in breaches:
                    print(f"      - {b}")
        return 1

    print(f"  All {qa['checks']} checks passed.")

    # --- step 4: factor scoring ---
    print("\n=== [4/4] Factor scoring ===")
    sc = scoring.run()
    print(
        f"  score_date {sc['score_date']}  "
        f"rows {sc['rows_written']}  "
        f"composite {sc['scored_with_composite']}  "
        f"ROIC true/proxy {sc['true_roic_pool']}/{sc['roa_proxy_pool']}  "
        f"job_runs id {sc['job_id']}"
    )

    print("\nWeekly pipeline complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
