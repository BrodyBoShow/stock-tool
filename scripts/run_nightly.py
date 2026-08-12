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

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import (  # noqa: E402
    fundamentals,
    metrics,
    price_sanity,
    prices,
    prices_massive,
    scoring,
    universe,
)


def _refresh_prices() -> dict:
    """Prefer Massive (official API: ~1 grouped-daily call/day for the whole
    universe) and fall back to the yfinance batch refresh if the key is missing,
    Massive errors, or it returns suspiciously thin coverage. Set
    PRICE_SOURCE=yfinance to force the old path."""
    use_massive = os.getenv("PRICE_SOURCE", "massive").lower() != "yfinance" and bool(
        os.getenv("MASSIVE_API_KEY") or os.getenv("POLYGON_API_KEY")
    )
    if use_massive:
        try:
            px = prices_massive.run_daily_refresh()
            if px["price_rows_upserted"] >= 1000:
                print(
                    f"  [source: massive] {px['price_rows_upserted']} rows over "
                    f"{px.get('days_loaded')} day(s)"
                )
                return px
            print(
                f"  [massive] thin coverage ({px['price_rows_upserted']} rows) — "
                "falling back to yfinance"
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  [massive] failed ({exc!r}) — falling back to yfinance")
    return prices.run_daily_refresh()


def main() -> int:
    # --- step 1: price refresh ---
    # Fast batched daily refresh: yf.download pulls ~120 tickers per threaded
    # call (measured ~5-18x faster/ticker than per-ticker history()), so the
    # whole active universe refreshes in minutes instead of hours and triggers
    # far less yfinance throttling. Idempotent + resumable. The patient
    # per-ticker run_bulk_backfill() stays for one-time full backfills of brand-
    # new names (no history yet), which the fixed daily lookback doesn't cover.
    print("\n=== [1/6] Price refresh ===")
    px = _refresh_prices()
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

    # --- step 2.5: graduate data-ready names onto the screener ---
    # Activate staged-inactive names that now have a valid factor rank's worth of
    # data (fundamentals + ~12mo of prices) — e.g. an IPO that has matured. Runs
    # BEFORE hygiene so any derivative that slips through is re-deactivated next,
    # and before scoring so the newly graduated names get ranked tonight.
    # run_graduation fetches SEC facts + computes metrics for up to N price-ready
    # inactive names, then activates the ones that clear the gate — a few per night
    # so future IPOs surface on their own. The one-time backlog is cleared by
    # scripts/backfill_inactive_fundamentals.py (graduate_ipos.yml).
    print("\n=== [2.5] Graduate data-ready names ===")
    grad = universe.run_graduation(limit=50)
    print(
        f"  Graduated {grad['graduated']} name(s) "
        f"(candidates {grad['candidates']}, facts fetched {grad.get('fetched', 0)})"
        + (f": {', '.join(grad['tickers'][:20])}" if grad["tickers"] else ".")
    )

    # --- step 3: universe hygiene ---
    # Deactivate warrant/unit/right listings that share a parent CIK (they
    # inherit the parent's fundamentals and otherwise top the screener on pure
    # momentum). Idempotent — a no-op once clean; runs before fundamentals so
    # any newly-graduated derivative is excluded from the heavy work below.
    print("\n=== [3/6] Universe hygiene (deactivate derivative listings) ===")
    deactivated = universe.deactivate_derivative_listings()
    print(f"  Deactivated {deactivated} warrant/unit/right listing(s).")

    # --- step 4: fundamentals refresh (incremental) ---
    # Only re-fetch companyfacts for companies that filed a new 10-Q/10-K/20-F/40-F
    # since their facts were last ingested — typically <1% of the universe — instead
    # of re-pulling all ~5,600 companyfacts nightly (~70 min -> a few minutes). The
    # weekly pipeline (run_weekly: fundamentals.run(resume=False)) does the full
    # sweep as the backstop for anything this diff misses (filings with no XBRL,
    # normalization gaps, restatements). Passing explicit tickers force-refreshes
    # them regardless of the resume flag.
    print("\n=== [4/6] Fundamentals refresh (incremental) ===")
    dirty = fundamentals.companies_needing_refresh()
    if dirty:
        fi = fundamentals.run(tickers=dirty)
        print(
            f"  Refreshed {len(dirty)} name(s) with new filings  "
            f"facts {fi['fact_rows']}  failed {fi['companies_failed']}  "
            f"job_runs id {fi['job_id']}"
        )
        if fi["warnings"]:
            print(f"  Warnings: {len(fi['warnings'])} (see job_runs id {fi['job_id']})")
    else:
        fi = None
        print("  No companies filed new fundamentals since last refresh — skipping fetch.")

    # --- step 5: derived metrics (only the refreshed names) ---
    # Fundamental metrics change only when a company files, so recompute just the
    # refreshed set; names that didn't file keep their existing metric rows (which
    # scoring still reads). Price-derived ratios (P/E, P/S, momentum) are recomputed
    # for the WHOLE universe in step 6 from tonight's close, independent of this.
    print("\n=== [5/6] Derived metrics ===")
    if dirty:
        me = metrics.run(tickers=dirty)
        print(
            f"  Recomputed {me['companies_done']}/{me['companies_total']}  "
            f"metric rows {me['metric_rows']}  "
            f"non-USD filers {me.get('non_usd_companies', 0)}  "
            f"failed {me['companies_failed']}  "
            f"job_runs id {me['job_id']}"
        )
        if me["warnings"]:
            print(f"  Warnings: {len(me['warnings'])} (see job_runs id {me['job_id']})")
    else:
        me = None
        print("  No refreshed names — fundamental metrics unchanged.")

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
