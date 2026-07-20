"""Numerical-equivalence guard for engine.live_factors.

The live overlay must be a strict no-op at the close: feeding a name its own
nightly close as the "live price" must reproduce the stored nightly Value,
Momentum and Composite percentiles. If it doesn't, the overlay's recompute has
drifted from engine.scoring and would mislead intraday.

Run:  python scripts/verify_live_factors.py
Exit 0 = all sampled names reproduce nightly within tolerance; 1 = drift found.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import live_factors  # noqa: E402
from engine.queries import ACTIVE_CONFIG_VERSION, acquire, release  # noqa: E402

# Tolerances: live ps/fcf_yield/prox_52w percentiles (the v6 live members) are
# recomputed at full precision and should match the nightly sub-percentiles to
# the bit; ev_ebitda, r12_1m and pos_days reuse the stored 2-dp percentile, so
# the factor means inherit at most ~0.01 of rounding, and the composite ~0.02.
TOL_FACTOR = 0.10
TOL_COMPOSITE = 0.05
SAMPLE = 400  # top names by composite — the set users actually look at


def _sample_sids(limit: int) -> list[int]:
    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT fs.security_id
                FROM factor_scores fs
                JOIN securities s ON s.security_id = fs.security_id
                WHERE s.is_active AND fs.config_version = %s
                  AND fs.score_date = (SELECT max(score_date) FROM factor_scores
                                       WHERE config_version = %s)
                  AND fs.composite IS NOT NULL
                ORDER BY fs.composite DESC
                LIMIT %s
                """,
                (ACTIVE_CONFIG_VERSION, ACTIVE_CONFIG_VERSION, limit),
            )
            return [r[0] for r in cur.fetchall()]
    finally:
        release(conn)


def main() -> int:
    snap = live_factors._load_snapshot()
    if snap is None:
        print("FAIL: no scored snapshot found")
        return 1

    sids = _sample_sids(SAMPLE)
    print(f"Equivalence check: {len(sids)} names @ score_date {snap.score_date}")
    print("  (live price = nightly close must reproduce nightly percentiles)\n")

    fails: list[str] = []
    checked = 0
    for sid in sids:
        m = snap.meta[sid]
        p0 = m["close"]
        if not p0 or p0 <= 0:
            continue  # nothing to scale from; overlay returns nightly anyway
        res = live_factors.live_adjust(sid, p0)
        if res is None:
            continue
        checked += 1
        for key, tol, night in (
            ("value", TOL_FACTOR, m["value_pctl"]),
            ("momentum", TOL_FACTOR, m["momentum_pctl"]),
            ("composite", TOL_COMPOSITE, m["composite"]),
        ):
            live_v = res[key]
            if night is None or live_v is None:
                continue
            diff = abs(live_v - night)
            if diff > tol:
                fails.append(
                    f"sid={sid} {key}: live={live_v} nightly={night} Δ={diff:.4f} > {tol}"
                )

    print(f"Checked {checked} names with a usable close.")
    if fails:
        print(f"\nFAIL — {len(fails)} mismatch(es):")
        for f in fails[:30]:
            print("  " + f)
        if len(fails) > 30:
            print(f"  …and {len(fails) - 30} more")
        return 1

    # Spot-check that a real move actually shifts the live composite (sanity:
    # the overlay isn't silently a no-op for every input).
    moved = 0
    for sid in sids[:50]:
        p0 = snap.meta[sid]["close"]
        if not p0:
            continue
        down = live_factors.live_adjust(sid, p0 * 0.90)  # -10%
        base = snap.meta[sid]["composite"]
        if down and down["composite"] is not None and base is not None:
            if abs(down["composite"] - base) > 1e-6:
                moved += 1
    print(f"Sanity: {moved}/50 names' composite shifted under a -10% move.")
    if moved == 0:
        print("FAIL: a -10% move changed nothing — overlay is inert")
        return 1

    print("\nPASS — live overlay reproduces nightly at the close and moves intraday.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
