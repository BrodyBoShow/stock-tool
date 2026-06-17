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

from engine.db import _is_transient_connection_error, get_connection, reopen
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


def _prices_at(conn, on: date, lookback_days: int = 7) -> dict[int, float]:
    """Latest adj_close on/before `on` (within lookback) per security.

    Uses the caller's shared connection (run_backtest threads one connection
    through the whole replay to minimize pooler churn)."""
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


# ── significance / robustness (all seeded → reproducible, no random drift) ────
BOOTSTRAP_SEED = 12345
NULL_SEED = 67890


def _safe_spearman(a: pd.Series, b: pd.Series) -> float | None:
    """Per-period rank correlation (Information Coefficient) of score vs forward
    return. None when too few names to be meaningful."""
    df = pd.DataFrame({"a": a, "b": b}).dropna()
    if len(df) < 8:
        return None
    # Spearman = Pearson on the ranks (avoids a scipy dependency).
    c = df["a"].rank().corr(df["b"].rank())
    return float(c) if pd.notna(c) else None


def _ic_block(ic_pairs: list[tuple[str, float | None]]) -> dict | None:
    """Aggregate the IC time series: mean, information ratio (mean/std), its
    t-stat, hit rate, and the per-period series for charting."""
    vals = np.array([v for _, v in ic_pairs if v is not None], dtype=float)
    if len(vals) < 6:
        return None
    mean = float(vals.mean())
    std = float(vals.std(ddof=1)) if len(vals) > 1 else 0.0
    ir = mean / std if std > 1e-9 else None
    t_stat = ir * np.sqrt(len(vals)) if ir is not None else None
    return {
        "mean": mean,
        "ir": float(ir) if ir is not None else None,
        "t_stat": float(t_stat) if t_stat is not None else None,
        "pct_positive": float((vals > 0).mean()),
        "n": int(len(vals)),
        "series": [{"date": d, "ic": (float(v) if v is not None else None)} for d, v in ic_pairs],
    }


def _block_bootstrap_ci(
    period_returns: list[float | None], n_resamples: int = 2000, block: int = 3
) -> dict | None:
    """90% CI on CAGR and Sharpe via stationary block bootstrap of the per-period
    returns (blocks preserve short-run autocorrelation). Seeded for reproducibility."""
    r = np.array([x for x in period_returns if x is not None], dtype=float)
    if len(r) < 8:
        return None
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    n = len(r)
    n_blocks = int(np.ceil(n / block))
    cagrs: list[float] = []
    sharpes: list[float] = []
    for _ in range(n_resamples):
        starts = rng.integers(0, n, size=n_blocks)
        samp = np.concatenate([r[s : s + block] for s in starts])[:n]
        if len(samp) == 0:
            continue
        curve = np.cumprod(1.0 + samp)
        years = len(samp) / PERIODS_PER_YEAR
        if years > 0 and curve[-1] > 0:
            cagrs.append(curve[-1] ** (1 / years) - 1)
        sd = samp.std()
        if sd > 1e-9:
            sharpes.append(samp.mean() / sd * np.sqrt(PERIODS_PER_YEAR))

    def _ci(a: list[float]) -> dict | None:
        arr = np.array([x for x in a if not np.isnan(x)], dtype=float)
        if len(arr) == 0:
            return None
        return {"lo": float(np.percentile(arr, 5)), "hi": float(np.percentile(arr, 95))}

    return {"cagr": _ci(cagrs), "sharpe": _ci(sharpes), "n_resamples": n_resamples}


def _random_portfolio_null(
    rebal: list[date], scores: dict[date, pd.DataFrame],
    px: dict[date, dict[int, float]], n_buckets: int = 5, n_sims: int = 1000,
) -> dict | None:
    """Monkey-portfolio test: each month, compare the composite top quintile's
    equal-weight forward return against `n_sims` RANDOM equal-weight baskets of
    the same size drawn from the same eligible universe (without replacement).
    Chains both across the window and reports where the real strategy's CAGR
    lands in the random distribution. Seeded → reproducible.

    GROSS of costs on both sides (the random arm has no cost concept), so this
    isolates selection skill, not turnover drag."""
    rng = np.random.default_rng(NULL_SEED)
    actual_rets: list[float] = []
    sim_period: list[np.ndarray] = []
    baskets: list[int] = []
    for t, t_next in zip(rebal[:-1], rebal[1:], strict=False):
        rep = scores.get(t)
        if rep is None or "composite" not in rep.columns:
            continue
        p0, p1 = px[t], px[t_next]
        ranks = rep["composite"].dropna()
        fwd = pd.Series({
            sid: p1[sid] / p0[sid] - 1.0
            for sid in ranks.index if sid in p0 and sid in p1 and p0[sid] > 0
        })
        common = ranks.index.intersection(fwd.index)
        if len(common) < n_buckets * 4:
            continue
        rk = ranks.loc[common].rank(method="first")
        top_mask = (pd.qcut(rk, n_buckets, labels=False) + 1 == n_buckets).to_numpy()
        f = fwd.loc[common].to_numpy()
        k = int(top_mask.sum())
        if k < 1:
            continue
        actual_rets.append(float(f[top_mask].mean()))
        baskets.append(k)
        # n_sims random size-k subsets (without replacement) via argsort of noise
        order = rng.random((n_sims, len(f))).argsort(axis=1)[:, :k]
        sim_period.append(f[order].mean(axis=1))
    if len(actual_rets) < 6:
        return None
    actual = np.array(actual_rets, dtype=float)
    sims = np.vstack(sim_period)  # (periods, n_sims)

    def _cagr(series: np.ndarray) -> float:
        curve = np.cumprod(1.0 + series)
        years = len(series) / PERIODS_PER_YEAR
        return curve[-1] ** (1 / years) - 1 if years > 0 and curve[-1] > 0 else np.nan

    actual_cagr = _cagr(actual)
    sim_cagrs = np.array([_cagr(sims[:, j]) for j in range(sims.shape[1])])
    sim_cagrs = sim_cagrs[~np.isnan(sim_cagrs)]
    if len(sim_cagrs) == 0 or np.isnan(actual_cagr):
        return None
    return {
        "actual_cagr": float(actual_cagr),
        "p5": float(np.percentile(sim_cagrs, 5)),
        "p50": float(np.percentile(sim_cagrs, 50)),
        "p95": float(np.percentile(sim_cagrs, 95)),
        "percentile": float((sim_cagrs < actual_cagr).mean()),
        "n_sims": int(n_sims),
        "avg_basket": int(np.mean(baskets)),
        "periods": int(len(actual_rets)),
    }


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
    ic_pairs: list[tuple[str, float | None]] = []  # (date, rank-IC of score vs fwd)

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
        ic_pairs.append((str(t_next), _safe_spearman(ranks.loc[common], fwd.loc[common])))
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
        "ic": _ic_block(ic_pairs),
        "bootstrap": {
            "top": _block_bootstrap_ci(bucket_series[n_buckets]),
            "long_short": _block_bootstrap_ci(ls_series),
        },
    }


def _benchmark_curves(conn, rebal: list[date], px: dict[date, dict[int, float]],
                      scores: dict[date, pd.DataFrame]) -> dict:
    """Growth-of-$1 curves for SPY and the equal-weight scored universe."""
    with conn.cursor() as cur:
        cur.execute("SELECT security_id FROM securities WHERE ticker = 'SPY' LIMIT 1")
        row = cur.fetchone()
        spy_sid = row[0] if row else None

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


def store_results(out: dict, conn=None) -> int:
    """Persist a run to backtest_results (the Lab page reads the latest row).

    Uses the caller's connection when given (so the backtest can reuse its one
    threaded connection); otherwise opens and closes its own."""
    owns_conn = conn is None
    if owns_conn:
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
                                "benchmarks": out.get("benchmarks"),
                                "significance": out.get("significance")}),
                ),
            )
            bid = cur.fetchone()[0]
        conn.commit()
        return int(bid)
    finally:
        if owns_conn and not conn.closed:
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
    # Thread ONE long-read connection through the whole replay (~99 short-lived
    # opens -> 1), so a flaky transaction pooler has far fewer chances to drop a
    # connection mid-run. Each month is wrapped in a reopen-and-retry so a
    # transient pooler drop reopens and retries that month instead of aborting
    # the 40-minute job. The connection is held across the loop, but every
    # borrowed read-only month rolls back its snapshot (see scoring.run), so the
    # idle window between queries stays well under the read idle ceiling.
    conn = get_connection(long_read=True)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT min(date), max(date) FROM prices_daily")
            pmin, pmax = cur.fetchone()
        conn.rollback()  # release the snapshot before the long loop
        start = start or (pmin + timedelta(days=400))  # need 12m history for momentum
        end = end or pmax
        rebal = _rebalance_dates(start, end)
        if len(rebal) < 4:
            raise RuntimeError("backtest window too short")

        print(f"[backtest] {config_version}: {len(rebal)} monthly rebalances "
              f"{rebal[0]}..{rebal[-1]}", flush=True)

        scores: dict[date, pd.DataFrame] = {}
        px: dict[date, dict[int, float]] = {}
        factor_cols = list(FACTOR_DEFS_BY_VERSION[config_version].keys())
        for i, t in enumerate(rebal, 1):
            for attempt in (1, 2):
                try:
                    rep = score_run(config_version, write=False, log_job=False,
                                    as_of=t, conn=conn)["report"]
                    px[t] = _prices_at(conn, t)
                    break
                except Exception as exc:  # noqa: BLE001
                    if attempt == 2 or not _is_transient_connection_error(exc):
                        raise
                    print(f"[backtest] connection drop at {t}, reopening: {exc}",
                          flush=True)
                    conn = reopen(conn, long_read=True)
            if complete_only:
                rep = rep.dropna(subset=factor_cols)
            scores[t] = rep
            if i % 6 == 0:
                print(f"[backtest] scored {i}/{len(rebal)} ({t})", flush=True)

        keys = {"composite": _backtest_key(rebal, scores, px, "composite", n_buckets, cost_bps)}
        for f in factor_cols:
            keys[f] = _backtest_key(rebal, scores, px, f, n_buckets, cost_bps)
        benchmarks = _benchmark_curves(conn, rebal, px, scores)

        print("[backtest] running random-portfolio null (composite)…", flush=True)
        significance = {
            "random_portfolio": _random_portfolio_null(rebal, scores, px, n_buckets),
            "seed": NULL_SEED,
        }

        return {
            "config_version": config_version,
            "start": str(rebal[0]),
            "end": str(rebal[-1]),
            "rebalances": len(rebal),
            "n_buckets": n_buckets,
            "cost_bps": cost_bps,
            "results": keys,
            "benchmarks": benchmarks,
            "significance": significance,
        }
    finally:
        if not conn.closed:
            conn.close()
