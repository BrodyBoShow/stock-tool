"""Point-in-time factor backtest (Phase 11). Prints an efficacy report.

Usage:
    python scripts/run_backtest.py [--start YYYY-MM-DD] [--end YYYY-MM-DD]
                                   [--buckets 5] [--cost-bps 10]
                                   [--config v2_linear]

Replays the factor model through history (scoring each month AS OF that date,
no look-ahead) and reports whether top-ranked names beat bottom-ranked names.
Read engine/backtest.py's limitations note first: survivor-only universe ->
absolute returns are optimistic; trust the SPREAD, not the level.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.backtest import run_backtest  # noqa: E402
from engine.queries import ACTIVE_CONFIG_VERSION  # noqa: E402


def _pct(x) -> str:
    return "  —  " if x is None else f"{x * 100:+6.1f}%"


def _print_key(name: str, res: dict, n_buckets: int) -> None:
    print(f"\n=== {name.upper()} — quintile forward returns "
          f"(bucket {n_buckets} = highest-ranked) ===")
    print(f"  {'bucket':>6}  {'CAGR':>8}  {'total':>8}  {'Sharpe':>7}  {'maxDD':>7}  {'~names':>6}")
    for b in range(1, n_buckets + 1):
        s = res["buckets"].get(b, {})
        sharpe = "   —  " if s.get("sharpe") is None else f"{s['sharpe']:5.2f} "
        print(f"  {b:>6}  {_pct(s.get('cagr'))}  {_pct(s.get('total_return'))}  "
              f"{sharpe:>7}  {_pct(s.get('max_drawdown'))}  {s.get('avg_names', 0):>6}")
    ls = res["long_short"]
    sharpe = "—" if ls.get("sharpe") is None else f"{ls['sharpe']:.2f}"
    print(f"  LONG-SHORT (top-bottom): CAGR {_pct(ls.get('cagr'))}  "
          f"total {_pct(ls.get('total_return'))}  Sharpe {sharpe}  "
          f"maxDD {_pct(ls.get('max_drawdown'))}")
    turn = res["avg_turnover"]
    turn_s = "—" if turn is None else f"{turn * 100:.0f}%"
    print(f"  avg turnover/mo (top bucket): {turn_s}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Point-in-time factor backtest.")
    ap.add_argument("--start", type=date.fromisoformat, default=None)
    ap.add_argument("--end", type=date.fromisoformat, default=None)
    ap.add_argument("--buckets", type=int, default=5)
    ap.add_argument("--cost-bps", type=float, default=10.0)
    ap.add_argument("--config", default=ACTIVE_CONFIG_VERSION)
    args = ap.parse_args()

    out = run_backtest(
        config_version=args.config, start=args.start, end=args.end,
        n_buckets=args.buckets, cost_bps=args.cost_bps,
    )

    print("\n" + "=" * 72)
    print(f"FACTOR BACKTEST — {out['config_version']}  "
          f"{out['start']} -> {out['end']}  ({out['rebalances']} monthly rebalances)")
    print(f"buckets={out['n_buckets']}  cost={out['cost_bps']}bps/side  "
          "EQUAL-WEIGHT, monthly rebalance")
    print("=" * 72)

    order = ["composite"] + [k for k in out["results"] if k != "composite"]
    for name in order:
        _print_key(name, out["results"][name], out["n_buckets"])

    print("\n" + "-" * 72)
    print("CAVEATS: survivor-only universe (no delisted names) -> absolute returns")
    print("are OPTIMISTIC. The signal is the SPREAD (top bucket > bottom, monotone")
    print("across buckets, positive long-short Sharpe), not the headline CAGR.")
    print("Validates the ranking methodology; not a tradeable strategy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
