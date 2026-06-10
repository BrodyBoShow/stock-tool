"""Phase 6 runner — compute factor scores into factor_scores.

Usage:
    python scripts/compute_scores.py

Prints the summary, top-10 composite table, and top/bottom 5 per factor.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the project root importable so `engine` resolves when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.scoring import run  # noqa: E402


def main() -> int:
    summary = run()
    report = summary["report"]

    print("\n=== Factor scoring summary ===")
    print(f"  Score date                : {summary['score_date']}")
    print(f"  factor_scores rows        : {summary['rows_written']}")
    print(f"  Rows with composite       : {summary['scored_with_composite']}")
    print(f"  ROIC pools (true / proxy) : {summary['true_roic_pool']} / "
          f"{summary['roa_proxy_pool']}")
    print(f"  Weights                   : {summary['weights']}")
    print(f"  job_runs id               : {summary['job_id']}")

    def fmt_row(r) -> str:
        def f(v):
            return f"{v:6.1f}" if v == v else "     —"  # NaN-safe
        return (f"{r['ticker']:7s} growth {f(r['growth'])}  value {f(r['value'])}  "
                f"quality {f(r['quality'])}  momentum {f(r['momentum'])}  "
                f"composite {f(r['composite'])}")

    top10 = report.sort_values("composite", ascending=False).head(10)
    print("\n=== TOP 10 BY COMPOSITE ===")
    for _, r in top10.iterrows():
        print("  " + fmt_row(r))

    for factor in ("growth", "value", "quality", "momentum"):
        ranked = report.dropna(subset=[factor]).sort_values(factor, ascending=False)
        print(f"\n=== {factor.upper()} — top 5 ===")
        for _, r in ranked.head(5).iterrows():
            print("  " + fmt_row(r))
        print(f"=== {factor.upper()} — bottom 5 ===")
        for _, r in ranked.tail(5).iterrows():
            print("  " + fmt_row(r))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
