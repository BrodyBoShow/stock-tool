"""Post-close EOD price refresh — the fast path that makes the Market tab current
within ~an hour of the US close instead of waiting for the late-night nightly.

Runs ONLY the two fast, market-facing steps:
  1. Batched daily price refresh (engine.prices.run_daily_refresh) — pulls the
     day's closes into prices_daily (~20 min for the active universe).
  2. Price sanity check (engine.price_sanity) — guards against bad prints.

The market-overview cache is data-date-aware and auto-refreshes once the new
close lands, so the Market tab (breadth, sectors, movers, macro) goes current on
its own within minutes. Heavier work — fundamentals, factor scoring, AI briefs —
stays in the full nightly, so "what worked by factor" updates after that re-score.

Usage: python scripts/refresh_eod_prices.py
Exits non-zero if the sanity check fails.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import price_sanity, prices  # noqa: E402


def main() -> int:
    print("\n=== [1/2] EOD price refresh ===")
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

    print("\n=== [2/2] Price sanity check ===")
    sanity = price_sanity.run()
    d = sanity["detail"]
    print(
        f"  latest_date {d.get('latest_date')}  "
        f"age {d.get('age_days')} days  "
        f"coverage {d.get('covered')}/{d.get('universe')} "
        f"({d.get('coverage_rate', 0):.1%})  "
        f"zero/neg {d.get('zero_negative_count')}  "
        f"wild-moves {d.get('wild_move_count')}"
    )
    if not sanity["passed"]:
        print(f"\n  *** SANITY GATE FAILED ***  {len(sanity['breaches'])} breach(es):")
        for b in sanity["breaches"]:
            print(f"    BREACH: {b}")
        return 1

    print("  Sanity gate PASSED.")
    print("\nEOD price refresh complete — Market tab reflects the new close shortly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
