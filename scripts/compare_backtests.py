"""A/B two stored factor-backtest runs against the cutover gate.

Usage:
    python scripts/compare_backtests.py --base v2_linear --candidate v3_pruned

Reads the LATEST stored backtest_results row for each config_version and prints a
side-by-side of the metrics the scoring-honesty plan's §6 gate cares about, with a
per-criterion PASS/FAIL. A candidate replaces the active config ONLY if it clears
the gate — this script is the decision aid, not the decision: it's still an
in-sample, survivor-only study (trust the spread/sign, not the absolute CAGR).

No DB writes. Reads via engine.queries.latest_backtest (the same row the Lab
serves), so what you see here is what the Lab will show.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# The report uses ->, minus and x glyphs; Windows consoles default to cp1252 and
# would crash on them. Force UTF-8 stdout where the runtime supports it.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

from engine.queries import latest_backtest  # noqa: E402


def _g(d: dict | None, *path, default=None):
    """Safe nested get."""
    cur = d
    for k in path:
        if not isinstance(cur, dict) or k not in cur or cur[k] is None:
            return default
        cur = cur[k]
    return cur


def _metrics(run: dict) -> dict:
    """Pull the gate-relevant numbers out of one stored run."""
    res = run.get("results") or {}
    comp = res.get("composite") or {}
    buckets = comp.get("buckets") or {}
    nb = max((int(k) for k in buckets), default=5)
    top = _g(buckets, str(nb), "cagr")
    bot = _g(buckets, "1", "cagr")
    return {
        "config": run.get("config_version"),
        "window": f"{run.get('start_date')}→{run.get('end_date')}",
        "ic_mean": _g(comp, "ic", "mean"),
        "ic_t": _g(comp, "ic", "t_stat"),
        "ic_pos": _g(comp, "ic", "pct_positive"),
        "spread_cagr": (top - bot) if (top is not None and bot is not None) else None,
        "ls_sharpe": _g(comp, "long_short", "sharpe"),
        "ls_cagr": _g(comp, "long_short", "cagr"),
        "turnover": comp.get("avg_turnover"),
        "monkey_pctl": _g(run, "significance", "random_portfolio", "percentile"),
    }


def _fmt(v, kind="num") -> str:
    if v is None:
        return "—"
    if kind == "pct":
        return f"{v * 100:+.1f}%"
    if kind == "pct0":
        return f"{v * 100:.0f}%"
    return f"{v:+.3f}" if kind == "signed" else f"{v:.2f}"


def _verdict(base: dict, cand: dict) -> list[tuple[str, bool | None, str]]:
    """Per-criterion gate check (candidate vs base). None = can't evaluate."""
    out: list[tuple[str, bool | None, str]] = []

    def cmp(name, key, *, higher_better=True, fmt="num", tol=0.0):
        b, c = base.get(key), cand.get(key)
        if b is None or c is None:
            out.append((name, None, f"base={_fmt(b, fmt)}  cand={_fmt(c, fmt)}"))
            return
        ok = (c >= b - tol) if higher_better else (c <= b + tol)
        out.append((name, ok, f"base={_fmt(b, fmt)}  cand={_fmt(c, fmt)}"))

    cmp("composite IC mean ≥ base", "ic_mean", fmt="signed")
    cmp("composite IC t-stat ≥ base", "ic_t", fmt="num")
    cmp("top−bottom CAGR spread ≥ base", "spread_cagr", fmt="pct")
    cmp("long-short Sharpe ≥ base", "ls_sharpe", fmt="num")
    cmp("monkey-null pctl ≥ base", "monkey_pctl", fmt="pct0")
    # turnover: lower is better, but only flag a BLOWOUT (>1.5x base), not a tie.
    b, c = base.get("turnover"), cand.get("turnover")
    detail = f"base={_fmt(b, 'pct0')}  cand={_fmt(c, 'pct0')}"
    if b is None or c is None:
        out.append(("turnover not blown out", None, detail))
    else:
        out.append(("turnover not blown out (≤1.5×)", c <= b * 1.5,
                    f"base={_fmt(b, 'pct0')}  cand={_fmt(c, 'pct0')}"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="A/B two stored backtests vs the cutover gate.")
    ap.add_argument("--base", default="v2_linear", help="incumbent config_version")
    ap.add_argument("--candidate", required=True, help="challenger config_version")
    args = ap.parse_args()

    base_run = latest_backtest(args.base)
    cand_run = latest_backtest(args.candidate)
    if base_run is None:
        print(f"no stored backtest for base '{args.base}' — run it first.")
        return 1
    if cand_run is None:
        print(f"no stored backtest for candidate '{args.candidate}' — run it first.")
        return 1

    b, c = _metrics(base_run), _metrics(cand_run)
    print("=" * 72)
    print(f"BACKTEST A/B — base '{b['config']}' vs candidate '{c['config']}'")
    print(f"  base window {b['window']} · candidate window {c['window']}")
    print("=" * 72)
    rows = [
        ("composite IC mean", _fmt(b["ic_mean"], "signed"), _fmt(c["ic_mean"], "signed")),
        ("composite IC t-stat", _fmt(b["ic_t"]), _fmt(c["ic_t"])),
        ("IC % periods positive", _fmt(b["ic_pos"], "pct0"), _fmt(c["ic_pos"], "pct0")),
        ("top−bottom CAGR spread", _fmt(b["spread_cagr"], "pct"), _fmt(c["spread_cagr"], "pct")),
        ("long-short Sharpe", _fmt(b["ls_sharpe"]), _fmt(c["ls_sharpe"])),
        ("long-short CAGR", _fmt(b["ls_cagr"], "pct"), _fmt(c["ls_cagr"], "pct")),
        ("monkey-null percentile", _fmt(b["monkey_pctl"], "pct0"), _fmt(c["monkey_pctl"], "pct0")),
        ("avg turnover/mo", _fmt(b["turnover"], "pct0"), _fmt(c["turnover"], "pct0")),
    ]
    print(f"  {'metric':<26}  {'base':>10}  {'candidate':>10}")
    for name, bv, cv in rows:
        print(f"  {name:<26}  {bv:>10}  {cv:>10}")

    print("\n--- GATE (candidate replaces base only if all evaluable criteria PASS) ---")
    verdicts = _verdict(b, c)
    all_pass = True
    for name, ok, detail in verdicts:
        mark = "—?" if ok is None else ("PASS" if ok else "FAIL")
        if ok is False:
            all_pass = False
        print(f"  [{mark:>4}] {name:<34} {detail}")
    unknown = any(ok is None for _, ok, _ in verdicts)
    print("\n" + "-" * 72)
    if all_pass and not unknown:
        print(f"VERDICT: candidate '{c['config']}' CLEARS the gate — cutover is justified.")
    elif all_pass and unknown:
        print(f"VERDICT: '{c['config']}' passes every EVALUABLE criterion but some are "
              "unknown — fill the gaps before cutover.")
    else:
        print(f"VERDICT: candidate '{c['config']}' does NOT clear the gate — keep base "
              f"'{b['config']}' active.")
    print("Reminder: in-sample, survivor-only — sub-1σ deltas are noise, not wins. For a "
          "SUBTRACTION candidate, 'indistinguishable from base' justifies the simpler model.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
