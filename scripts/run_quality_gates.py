"""Phase 5b runner — golden fixtures + universe sanity gates.

Usage:
    python scripts/run_quality_gates.py

Exits non-zero on ANY fixture miss or sanity breach. This is the gate that
stops bad data from reaching scoring (Phase 6 must not run if this fails).
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the project root importable so `engine` resolves when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.quality import run  # noqa: E402


def _fmt(v, metric) -> str:
    if v is None:
        return "—"
    if abs(v) >= 1e6:
        return f"{v:,.0f}"
    return f"{v:.4f}" if "margin" in metric else f"{v:.2f}"


def main() -> int:
    summary = run()

    print("=" * 100)
    print("GOLDEN FIXTURES — computed vs expected (sources cited in config/fixtures.json)")
    print("=" * 100)
    print(f"{'':6s} {'ticker':7s} {'FY end':11s} {'metric':17s} "
          f"{'expected':>18s} {'actual':>18s}  detail")
    for r in summary["value_rows"]:
        mark = "[PASS]" if r["ok"] else "[FAIL]"
        print(f"{mark:6s} {r['ticker']:7s} {r['fy_end']:11s} {r['metric']:17s} "
              f"{_fmt(r['expected'], r['metric']):>18s} {_fmt(r['actual'], r['metric']):>18s}  "
              f"{r['detail']}")

    print()
    print("=" * 100)
    print("BEHAVIOR FIXTURES — structural expectations (proxies, deliberate nulls)")
    print("=" * 100)
    for name, target, ok, detail in summary["behavior_rows"]:
        mark = "[PASS]" if ok else "[FAIL]"
        print(f"{mark} {name:28s} {target:18s} {detail}")

    print()
    print("=" * 100)
    print("POINT-IN-TIME — ADM restatement must not leak backward")
    print("=" * 100)
    for name, ok, detail in summary["pit_rows"]:
        mark = "[PASS]" if ok else "[FAIL]"
        print(f"{mark} {name}: {detail}")

    print()
    print("=" * 100)
    print("UNIVERSE SANITY GATES")
    print("=" * 100)
    for name, ok, detail, breaches in summary["gate_rows"]:
        mark = "[PASS]" if ok else "[FAIL]"
        print(f"{mark} {name}: {detail}")
        for b in breaches:
            print(f"         - {b}")

    print()
    print("=" * 100)
    if summary["failures"] == 0:
        print(f"RESULT: ALL {summary['checks']} CHECKS PASSED — data is clear for scoring "
              f"(job_runs id {summary['job_id']})")
    else:
        print(f"RESULT: {summary['failures']} FAILURE(S) across {summary['checks']} checks — "
              f"DO NOT SCORE on this data (job_runs id {summary['job_id']})")
    print("=" * 100)
    return 0 if summary["failures"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
