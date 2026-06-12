"""Point-in-time factor backtest (Phase 11). Prints / writes an efficacy report.

Usage:
    python scripts/run_backtest.py [--start YYYY-MM-DD] [--end YYYY-MM-DD]
                                   [--buckets 5] [--cost-bps 10]
                                   [--config v2_linear] [--out PATH.md]

Replays the factor model through history (scoring each month AS OF that date,
no look-ahead) and reports whether top-ranked names beat bottom-ranked names.
--out writes a Markdown report (used by the scheduled workflow so the latest
results live in the repo without anyone running this by hand). Read
engine/backtest.py's limitations note first: survivor-only universe -> absolute
returns are optimistic; trust the SPREAD, not the level.
"""
from __future__ import annotations

import argparse
import sys
from datetime import UTC, date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.backtest import run_backtest, store_results  # noqa: E402
from engine.queries import ACTIVE_CONFIG_VERSION  # noqa: E402


def _pct(x) -> str:
    return "—" if x is None else f"{x * 100:+.1f}%"


def _sharpe(x) -> str:
    return "—" if x is None else f"{x:.2f}"


def build_text(out: dict) -> str:
    """Console report (fixed-width)."""
    nb = out["n_buckets"]
    lines = [
        "=" * 72,
        f"FACTOR BACKTEST — {out['config_version']}  {out['start']} -> {out['end']}  "
        f"({out['rebalances']} monthly rebalances)",
        f"buckets={nb}  cost={out['cost_bps']}bps/side  EQUAL-WEIGHT, monthly rebalance",
        "=" * 72,
    ]
    order = ["composite"] + [k for k in out["results"] if k != "composite"]
    for name in order:
        res = out["results"][name]
        lines.append(f"\n=== {name.upper()} — quintile forward returns "
                     f"(bucket {nb} = highest-ranked) ===")
        lines.append(f"  {'bucket':>6}  {'CAGR':>8}  {'total':>8}  {'Sharpe':>7}  "
                     f"{'maxDD':>7}  {'~names':>6}")
        for b in range(1, nb + 1):
            s = res["buckets"].get(b, {})
            lines.append(f"  {b:>6}  {_pct(s.get('cagr')):>8}  {_pct(s.get('total_return')):>8}  "
                         f"{_sharpe(s.get('sharpe')):>7}  {_pct(s.get('max_drawdown')):>7}  "
                         f"{s.get('avg_names', 0):>6}")
        ls = res["long_short"]
        lines.append(f"  LONG-SHORT (top-bottom): CAGR {_pct(ls.get('cagr'))}  "
                     f"total {_pct(ls.get('total_return'))}  Sharpe {_sharpe(ls.get('sharpe'))}  "
                     f"maxDD {_pct(ls.get('max_drawdown'))}")
        turn = res["avg_turnover"]
        lines.append(f"  avg turnover/mo (top bucket): "
                     f"{'—' if turn is None else f'{turn * 100:.0f}%'}")
    lines += [
        "\n" + "-" * 72,
        "CAVEATS: survivor-only universe (no delisted names) -> absolute returns",
        "are OPTIMISTIC. The signal is the SPREAD (top bucket > bottom, monotone",
        "across buckets, positive long-short Sharpe), not the headline CAGR.",
        "Validates the ranking methodology; not a tradeable strategy.",
    ]
    return "\n".join(lines)


def build_markdown(out: dict) -> str:
    """GitHub-viewable Markdown report (written by --out)."""
    nb = out["n_buckets"]
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    md = [
        "# Factor backtest — latest run",
        "",
        f"_Generated {stamp} • auto-updated by `.github/workflows/backtest.yml`; "
        "do not edit by hand._",
        "",
        f"**Config** `{out['config_version']}` • **Window** {out['start']} → {out['end']} "
        f"({out['rebalances']} monthly rebalances) • **Buckets** {nb} • "
        f"**Cost** {out['cost_bps']}bps/side • equal-weight",
        "",
        "> ⚠️ **Survivor-only universe** (no delisted names) → absolute returns are "
        "OPTIMISTIC. The signal is the **spread** (top bucket beats bottom, monotone, "
        "positive long-short Sharpe), not the headline CAGR. Validates the ranking "
        "methodology — not a tradeable strategy.",
        "",
    ]
    order = ["composite"] + [k for k in out["results"] if k != "composite"]
    for name in order:
        res = out["results"][name]
        ls = res["long_short"]
        turn = res["avg_turnover"]
        md += [
            f"## {name.title()}",
            "",
            f"| Bucket ({nb}=top) | CAGR | Total | Sharpe | Max DD | ~Names |",
            "|---|---|---|---|---|---|",
        ]
        for b in range(nb, 0, -1):
            s = res["buckets"].get(b, {})
            md.append(f"| {b} | {_pct(s.get('cagr'))} | {_pct(s.get('total_return'))} | "
                      f"{_sharpe(s.get('sharpe'))} | {_pct(s.get('max_drawdown'))} | "
                      f"{s.get('avg_names', 0)} |")
        md += [
            "",
            f"**Long-short (top − bottom):** CAGR {_pct(ls.get('cagr'))} • "
            f"Sharpe {_sharpe(ls.get('sharpe'))} • maxDD {_pct(ls.get('max_drawdown'))} • "
            f"turnover {'—' if turn is None else f'{turn * 100:.0f}%/mo'}",
            "",
        ]
    return "\n".join(md)


def main() -> int:
    ap = argparse.ArgumentParser(description="Point-in-time factor backtest.")
    ap.add_argument("--start", type=date.fromisoformat, default=None)
    ap.add_argument("--end", type=date.fromisoformat, default=None)
    ap.add_argument("--buckets", type=int, default=5)
    ap.add_argument("--cost-bps", type=float, default=10.0)
    ap.add_argument("--config", default=ACTIVE_CONFIG_VERSION)
    ap.add_argument("--out", type=Path, default=None, help="Write a Markdown report here.")
    ap.add_argument("--store", action="store_true",
                    help="Persist results to backtest_results (feeds the Lab page).")
    args = ap.parse_args()

    out = run_backtest(
        config_version=args.config, start=args.start, end=args.end,
        n_buckets=args.buckets, cost_bps=args.cost_bps,
    )
    print("\n" + build_text(out))
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(build_markdown(out), encoding="utf-8")
        print(f"\n[backtest] wrote {args.out}")
    if args.store:
        bid = store_results(out)
        print(f"[backtest] stored backtest_results id {bid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
