"""Verify Massive grouped-daily prices match the stored (yfinance) closes.

Read-only on the DB; one grouped-daily API call. Compares Massive's close for a
recent trading day against what's already in prices_daily for the overlapping
tickers, and reports the agreement distribution — the parity evidence to gate a
cutover of the nightly price source from yfinance to Massive.

Usage:
    python scripts/verify_massive.py [--date YYYY-MM-DD] [--top N]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.db import get_connection  # noqa: E402
from engine.prices_massive import _client, grouped_daily  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Compare Massive vs stored closes.")
    ap.add_argument("--date", default=None, help="Trading day YYYY-MM-DD (default: latest stored).")
    ap.add_argument("--top", type=int, default=10, help="How many largest diffs to list.")
    args = ap.parse_args()

    conn = get_connection()
    with conn.cursor() as cur:
        if args.date:
            target = args.date
        else:
            cur.execute("SELECT max(date) FROM prices_daily")
            target = cur.fetchone()[0].isoformat()
        cur.execute(
            """
            SELECT s.ticker, p.close
            FROM prices_daily p JOIN securities s ON s.security_id = p.security_id
            WHERE p.date = %s AND p.close IS NOT NULL
            """,
            (target,),
        )
        stored = {t: float(c) for t, c in cur.fetchall()}
    conn.close()

    if not stored:
        print(f"No stored prices for {target}; pick another --date.")
        return 1

    from datetime import date as _date

    client = _client()
    try:
        results = grouped_daily(client, _date.fromisoformat(target), adjusted=False)
    finally:
        client.close()
    massive = {r["T"]: float(r["c"]) for r in results if r.get("c") is not None}

    if not massive:
        print(f"Massive returned no rows for {target} (holiday, or not posted yet).")
        return 1

    overlap = sorted(set(stored) & set(massive))
    diffs = []
    for t in overlap:
        s, m = stored[t], massive[t]
        if s <= 0:
            continue
        diffs.append((t, s, m, abs(m - s) / s))
    diffs.sort(key=lambda x: x[3], reverse=True)

    pcts = [d[3] for d in diffs]
    n = len(pcts)
    within = lambda thr: sum(1 for p in pcts if p <= thr)  # noqa: E731
    med = sorted(pcts)[n // 2] if n else 0.0

    print(f"\n=== Massive vs stored close — {target} ===")
    print(f"  Massive tickers returned : {len(massive):,}")
    print(f"  Stored tickers (this day): {len(stored):,}")
    print(f"  Overlap compared         : {n:,}")
    if n:
        print(f"  Median abs % diff        : {med * 100:.3f}%")
        print(f"  Within 0.1%              : {within(0.001)}/{n} ({within(0.001)/n:.1%})")
        print(f"  Within 0.5%              : {within(0.005)}/{n} ({within(0.005)/n:.1%})")
        print(f"  Within 2%                : {within(0.02)}/{n} ({within(0.02)/n:.1%})")
        print(f"\n  Largest {min(args.top, n)} diffs (ticker: stored -> massive, %):")
        for t, s, m, p in diffs[: args.top]:
            print(f"    {t:<8} {s:>10.2f} -> {m:<10.2f} {p * 100:6.2f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
