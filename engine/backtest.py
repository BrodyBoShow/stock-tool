"""Phase 11 — Factor backtest (point-in-time efficacy study).

Validates whether the factor model actually ranks future returns, by replaying
it through history: on each rebalance date T it scores the universe AS OF T
(engine.scoring.run(as_of=T) — only data filed/priced by then, no look-ahead),
sorts names into buckets by composite (or a single factor), and measures the
forward total return of each bucket to the next rebalance. Reports bucket
spreads, a long-short curve, CAGR / Sharpe / max-drawdown, turnover, and
per-factor attribution.

HONEST LIMITATIONS — read before trusting any number:
- SURVIVORSHIP. The universe is today's listed names; delisted/bankrupt
  companies are absent. Returns are therefore OPTIMISTIC in absolute terms.
  The bucket *spread* (top vs bottom) is far more robust to this than the
  absolute level, which is why this study leans on spreads, not CAGR bragging.
- IN-SAMPLE. Weights weren't fit here, but the universe and period are what we
  have; treat this as "does the ranking have signal?", not a track record.
- COSTS are a flat per-name bps estimate on turnover, not real fills.
This validates the RANKING METHODOLOGY directionally. It is not a strategy.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

import numpy as np
import pandas as pd

from engine.db import get_connection
from engine.queries import ACTIVE_CONFIG_VERSION
from engine.scoring import FACTOR_DEFS_BY_VERSION
from engine.scoring import run as score_run

PERIODS_PER_YEAR = 12  # monthly rebalance


def _rebalance_dates(start: date, end: date) -> list[date]:
    """Month-end-ish grid: the 1st of each month from start to end inclusive."""
    out: list[date] = []
    y, m = start.year, start.month
    while date(y, m, 1) <= end:
        out.append(date(y, m, 1))
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def _prices_at(on: date, lookback_days: int = 7) -> dict[int, float]:
    """Latest adj_close on/before `on` (within lookback) per security.

    Opens its own short-lived connection: scoring each rebalance date uses a
    separate connection and takes seconds, so a long-lived one held across the
    loop would be killed by the idle-in-transaction timeout.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (security_id) security_id, adj_close
                FROM prices_daily
                WHERE date <= %s AND date >= %s AND adj_close IS NOT NULL
                ORDER BY security_id, date DESC
                """,
                (on, on - timedelta(days=lookback_days)),
            )
            return {sid: float(ac) for sid, ac in cur.fetchall()}
    finally:
        if not conn.closed:
            conn.close()


def _bucket_returns(
    ranks: pd.Series, fwd: pd.Series, n_buckets: int
) -> tuple[dict[int, float], dict[int, int]]:
    """Equal-weight mean forward return per bucket (1=worst rank .. n=best)."""
    df = pd.DataFrame({"rank": ranks, "fwd": fwd}).dropna()
    if len(df) < n_buckets * 2:
        return {}, {}
    df["bucket"] = pd.qcut(df["rank"].rank(method="first"), n_buckets, labels=False) + 1
    means = df.groupby("bucket")["fwd"].mean().to_dict()
    counts = df.groupby("bucket")["fwd"].size().to_dict()
    return {int(k): float(v) for k, v in means.items()}, {int(k): int(v) for k, v in counts.items()}


def _curve_stats(period_returns: list[float]) -> dict:
    """CAGR, annualized Sharpe, max drawdown from a list of per-period returns."""
    r = np.array([x for x in period_returns if x is not None], dtype=float)
    if len(r) == 0:
        return {"cagr": None, "sharpe": None, "max_drawdown": None, "total_return": None}
    curve = np.cumprod(1.0 + r)
    total = curve[-1] - 1.0
    years = len(r) / PERIODS_PER_YEAR
    cagr = curve[-1] ** (1 / years) - 1 if years > 0 and curve[-1] > 0 else None
    sharpe = (r.mean() / r.std() * np.sqrt(PERIODS_PER_YEAR)) if r.std() > 1e-9 else None
    peak = np.maximum.accumulate(curve)
    max_dd = float((curve / peak - 1.0).min())
    return {
        "total_return": float(total),
        "cagr": float(cagr) if cagr is not None else None,
        "sharpe": float(sharpe) if sharpe is not None else None,
        "max_drawdown": max_dd,
    }


def _cum_curve(returns: list[float | None]) -> list[float]:
    """Cumulative growth-of-$1 from per-period returns (None treated as flat)."""
    out, level = [], 1.0
    for r in returns:
        level *= 1.0 + (r or 0.0)
        out.append(round(level, 4))
    return out


def _win_rate(returns: list[float | None]) -> float | None:
    r = [x for x in returns if x is not None]
    return round(sum(1 for x in r if x > 0) / len(r), 4) if r else None


def _backtest_key(
    rebal: list[date], scores: dict[date, pd.DataFrame], px: dict[date, dict[int, float]],
    rank_col: str, n_buckets: int, cost_bps: float,
) -> dict:
    """Run the bucket backtest for one ranking column (composite or a factor)."""
    bucket_series: dict[int, list[float]] = {b: [] for b in range(1, n_buckets + 1)}
    ls_series: list[float] = []
    turnovers: list[float] = []
    prev_top: set[int] = set()
    avg_counts: dict[int, list[int]] = {b: [] for b in range(1, n_buckets + 1)}
    dates: list[str] = []  # period END dates, aligned with the series above

    for t, t_next in zip(rebal[:-1], rebal[1:], strict=False):
        rep = scores.get(t)
        if rep is None or rank_col not in rep.columns:
            continue
        p0, p1 = px[t], px[t_next]
        ranks = rep[rank_col].dropna()
        fwd = pd.Series({
            sid: p1[sid] / p0[sid] - 1.0
            for sid in ranks.index
            if sid in p0 and sid in p1 and p0[sid] > 0
        })
        common = ranks.index.intersection(fwd.index)
        means, counts = _bucket_returns(ranks.loc[common], fwd.loc[common], n_buckets)
        if not means:
            continue
        dates.append(str(t_next))
        # turnover of the top bucket vs last period (round-trip cost estimate)
        rk = ranks.loc[common].rank(method="first")
        top_ids = set(rk[pd.qcut(rk, n_buckets, labels=False) + 1 == n_buckets].index)
        turn = 1.0 if not prev_top else len(top_ids - prev_top) / max(len(top_ids), 1)
        prev_top = top_ids
        turnovers.append(turn)
        cost = turn * 2 * cost_bps / 10_000  # buys + sells on the changed fraction
        for b in range(1, n_buckets + 1):
            v = means.get(b)
            net = (v - (cost if b == n_buckets else 0.0)) if v is not None else None
            bucket_series[b].append(net)
            if b in counts:
                avg_counts[b].append(counts[b])
        if n_buckets in means and 1 in means:
            ls_series.append(means[n_buckets] - means[1] - cost)

    buckets = {
        b: {**_curve_stats(bucket_series[b]),
            "avg_names": int(np.mean(avg_counts[b])) if avg_counts[b] else 0}
        for b in range(1, n_buckets + 1)
    }
    return {
        "buckets": buckets,
        "long_short": _curve_stats(ls_series),
        "avg_turnover": float(np.mean(turnovers)) if turnovers else None,
        "periods": len(ls_series),
        "win_rate_top": _win_rate(bucket_series[n_buckets]),
        "win_rate_ls": _win_rate(ls_series),
        "curves": {
            "dates": dates,
            "top": _cum_curve(bucket_series[n_buckets]),
            "bottom": _cum_curve(bucket_series[1]),
            "long_short": _cum_curve(ls_series),
        },
        "bucket_cagrs": {b: buckets[b].get("cagr") for b in range(1, n_buckets + 1)},
    }


def _benchmark_curves(rebal: list[date], px: dict[date, dict[int, float]],
                      scores: dict[date, pd.DataFrame]) -> dict:
    """Growth-of-$1 curves for SPY and the equal-weight scored universe."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT security_id FROM securities WHERE ticker = 'SPY' LIMIT 1")
            row = cur.fetchone()
            spy_sid = row[0] if row else None
    finally:
        if not conn.closed:
            conn.close()

    dates: list[str] = []
    spy_rets: list[float | None] = []
    ew_rets: list[float | None] = []
    for t, t_next in zip(rebal[:-1], rebal[1:], strict=False):
        p0, p1 = px[t], px[t_next]
        dates.append(str(t_next))
        spy_rets.append(
            p1[spy_sid] / p0[spy_sid] - 1.0
            if spy_sid is not None and spy_sid in p0 and spy_sid in p1 else None
        )
        rep = scores.get(t)
        if rep is not None:
            sids = [s for s in rep.index if s in p0 and s in p1 and p0[s] > 0]
            ew_rets.append(
                float(np.mean([p1[s] / p0[s] - 1.0 for s in sids])) if sids else None
            )
        else:
            ew_rets.append(None)
    return {
        "dates": dates,
        "spy": _cum_curve(spy_rets),
        "universe_ew": _cum_curve(ew_rets),
        "spy_stats": _curve_stats(spy_rets),
        "universe_ew_stats": _curve_stats(ew_rets),
    }


def store_results(out: dict) -> int:
    """Persist a run to backtest_results (the Lab page reads the latest row)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO backtest_results
                  (config_version, start_date, end_date, params, results)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING backtest_id
                """,
                (
                    out["config_version"], out["start"], out["end"],
                    json.dumps({"n_buckets": out["n_buckets"],
                                "cost_bps": out["cost_bps"],
                                "rebalances": out["rebalances"]}),
                    json.dumps({"results": out["results"],
                                "benchmarks": out.get("benchmarks")}),
                ),
            )
            bid = cur.fetchone()[0]
        conn.commit()
        return int(bid)
    finally:
        if not conn.closed:
            conn.close()


def run_backtest(
    config_version: str = ACTIVE_CONFIG_VERSION,
    start: date | None = None,
    end: date | None = None,
    n_buckets: int = 5,
    cost_bps: float = 10.0,
    complete_only: bool = True,
) -> dict:
    """Point-in-time factor backtest. Returns composite + per-factor results.

    n_buckets=5 -> quintiles (robust for a few-thousand-name universe). Scores
    each rebalance date once, then reuses those scores for the composite and
    every single-factor attribution run (cheap relative to scoring).
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT min(date), max(date) FROM prices_daily")
            pmin, pmax = cur.fetchone()
    finally:
        if not conn.closed:
            conn.close()
    start = start or (pmin + timedelta(days=400))  # need 12m history for momentum
    end = end or pmax
    rebal = _rebalance_dates(start, end)
    if len(rebal) < 4:
        raise RuntimeError("backtest window too short")

    print(f"[backtest] {config_version}: {len(rebal)} monthly rebalances "
          f"{rebal[0]}..{rebal[-1]}", flush=True)

    # Each iteration uses fresh short-lived connections (score_run owns its own,
    # _prices_at owns its own) — nothing is held idle across the slow scoring.
    scores: dict[date, pd.DataFrame] = {}
    px: dict[date, dict[int, float]] = {}
    factor_cols = list(FACTOR_DEFS_BY_VERSION[config_version].keys())
    for i, t in enumerate(rebal, 1):
        rep = score_run(config_version, write=False, log_job=False, as_of=t)["report"]
        if complete_only:
            rep = rep.dropna(subset=factor_cols)
        scores[t] = rep
        px[t] = _prices_at(t)
        if i % 6 == 0:
            print(f"[backtest] scored {i}/{len(rebal)} ({t})", flush=True)

    keys = {"composite": _backtest_key(rebal, scores, px, "composite", n_buckets, cost_bps)}
    for f in factor_cols:
        keys[f] = _backtest_key(rebal, scores, px, f, n_buckets, cost_bps)
    benchmarks = _benchmark_curves(rebal, px, scores)

    return {
        "config_version": config_version,
        "start": str(rebal[0]),
        "end": str(rebal[-1]),
        "rebalances": len(rebal),
        "n_buckets": n_buckets,
        "cost_bps": cost_bps,
        "results": keys,
        "benchmarks": benchmarks,
    }
