"""One-time backfill: graduate the staged-inactive data-ready backlog.

The nightly only fetches SEC fundamentals for ACTIVE names, so price-ready
staged-inactive names (the expanded universe + matured IPOs) never get the
metrics they need to graduate onto the screener. This clears that backlog in one
pass via engine.universe.run_graduation: fetch SEC facts for price-ready inactive
operating names that lack them, compute their metrics, activate the ones that now
have a valid factor rank's worth of data, then re-score so they appear ranked.

Heavy (hundreds of SEC fetches + a full re-score) — run it on GitHub Actions
(.github/workflows/graduate_ipos.yml), NOT locally (long loops hang on Windows).
Idempotent + resumable: re-running only processes names still missing metrics.

Usage:
    python scripts/backfill_inactive_fundamentals.py [--dry-run] [--limit N] [--no-score]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import scoring, universe  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Graduate staged-inactive data-ready names.")
    ap.add_argument("--dry-run", action="store_true", help="Report candidate scope only.")
    ap.add_argument("--limit", type=int, default=None, help="Cap candidates processed.")
    ap.add_argument("--no-score", action="store_true", help="Skip the re-score afterward.")
    args = ap.parse_args()

    if args.dry_run:
        r = universe.run_graduation(limit=args.limit, dry_run=True)
        print(
            f"[dry-run] candidates={r['candidates']}  need_fetch={r['need_fetch']}  "
            f"have_facts={r['have_facts']}"
        )
        print("sample:", r["tickers"][:40])
        return 0

    r = universe.run_graduation(limit=args.limit, fetch=True)
    print("\n=== Graduation backfill ===")
    print(f"  candidates processed : {r['candidates']}")
    print(f"  SEC facts fetched    : {r['fetched']}")
    print(f"  graduated (activated): {r['graduated']}")
    if r["tickers"]:
        shown = ", ".join(r["tickers"][:50])
        print(f"  newly on screener    : {shown}" + (" ..." if len(r["tickers"]) > 50 else ""))

    if not args.no_score and r["graduated"]:
        print("\n=== Re-scoring so graduated names rank now ===")
        s = scoring.run()
        scalars = {k: v for k, v in s.items() if isinstance(v, (int, float, str))}
        print(f"  scoring: {scalars}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
