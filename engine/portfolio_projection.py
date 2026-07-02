"""Portfolio projection — correlated Monte Carlo cone (Phase 2).

A forward "cone of outcomes" for the user's ACTUAL holdings. Adapted from
GoldenPanda's Cholesky-correlated Monte Carlo, but grounded in real data: per-
holding annualized return/vol and the full covariance matrix are ESTIMATED FROM
EACH HOLDING'S OWN PRICE HISTORY (prices_daily), not hardcoded asset-class
guesses. Assets are drawn correlated (Cholesky of the covariance), so they fall
together in stress instead of being treated as independent.

HONEST FRAMING — this is a PROJECTION, not a forecast:
- Geometric-ish Brownian motion understates fat tails and crashes.
- Covariance is backward-looking; correlations rise in real drawdowns (use the
  `stress` toggle to see a pessimistic regime).
- Survivorship etc. do not apply here (we use the user's own holdings), but the
  return/vol assumptions are only as good as the trailing window.

Display only — never feeds the factor model. Seeded → reproducible.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from engine.db import acquire, release
from engine.portfolio import compute_portfolio

PROJECTION_SEED = 424242
MONTHS_PER_YEAR = 12
TRADING_DAYS = 252
MIN_RETURNS = 60  # min overlapping daily returns to keep a holding in the sim

DISCLAIMER = (
    "Projection, not a forecast. A correlated Monte Carlo (geometric Brownian "
    "motion) on your holdings' own history — volatility and covariance are "
    "trailing, drawn correlated via Cholesky so positions move together in "
    "stress. Expected returns are shrunk 50% toward a long-run market prior "
    "(~8%/yr) because short-window means are unreliable. Brownian motion still "
    "understates crashes and fat tails; the percentile cone is only as good as "
    "these assumptions. Not advice."
)


def _load_price_history(sids: list[int], lookback_days: int) -> pd.DataFrame:
    """Wide adj_close frame (index=date, columns=security_id) over the lookback."""
    if not sids:
        return pd.DataFrame()
    cutoff = date.today() - timedelta(days=lookback_days)
    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT security_id, date, adj_close
                FROM prices_daily
                WHERE security_id = ANY(%s) AND date >= %s AND adj_close IS NOT NULL
                ORDER BY date
                """,
                (sids, cutoff),
            )
            rows = cur.fetchall()
    finally:
        release(conn)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["security_id", "date", "adj_close"])
    df["adj_close"] = df["adj_close"].astype(float)
    return df.pivot(index="date", columns="security_id", values="adj_close").sort_index()


def _stress_covariance(cov: np.ndarray) -> np.ndarray:
    """Pessimistic regime: pull correlations toward 1 and inflate vols ~30%."""
    d = np.sqrt(np.clip(np.diag(cov), 1e-12, None))
    corr = cov / np.outer(d, d)
    corr = 0.5 * corr + 0.5  # toward 1
    np.fill_diagonal(corr, 1.0)
    d2 = d * 1.3
    return corr * np.outer(d2, d2)


def _chol(cov: np.ndarray) -> np.ndarray:
    """Cholesky with a jitter fallback if the matrix is fractionally non-PD."""
    for eps in (0.0, 1e-10, 1e-8, 1e-6):
        try:
            return np.linalg.cholesky(cov + eps * np.eye(cov.shape[0]))
        except np.linalg.LinAlgError:
            continue
    # Last resort: zero off-diagonals (treat as independent).
    return np.diag(np.sqrt(np.clip(np.diag(cov), 1e-12, None)))


MARKET_PRIOR = 0.08  # long-run equity expected return (~8%/yr)
RETURN_SHRINK = 0.5  # weight on the prior; short-window means are unreliable


def _resolve_ticker_sids(tickers: list[str]) -> dict[str, int]:
    """ticker → security_id for arbitrary tickers (simulator buy candidates)."""
    if not tickers:
        return {}
    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ticker, security_id FROM securities WHERE ticker = ANY(%s)",
                (tickers,),
            )
            return {r[0]: int(r[1]) for r in cur.fetchall()}
    finally:
        release(conn)


def project_portfolio(
    years: int = 10,
    monthly: float = 0.0,
    annual_fee: float = 0.0,
    n_sims: int = 1000,
    lookback_days: int = 1095,
    stress: bool = False,
    owner_id: str | None = None,
    weights: dict[str, float] | None = None,
    goal: float | None = None,
    compare_bench: str | None = None,
) -> dict[str, Any]:
    """Correlated Monte Carlo projection of the current holdings (monthly steps).

    Returns the percentile cone, terminal percentiles, a max-drawdown
    distribution, P(end > contributed), the per-holding assumptions used, and a
    disclaimer. Monthly rebalance back to current weights is assumed.

    `weights` (ticker → weight, may include tickers not currently held, e.g. a
    simulated VTI buy) reruns the cone with the SAME starting money reallocated
    to those weights — the Rebalance Simulator's "what if" path. `goal` adds
    P(terminal ≥ goal). `compare_bench` adds a same-contribution single-asset
    cone for that benchmark ticker plus P(beat benchmark).
    """
    years = max(1, min(int(years), 40))
    n_sims = max(200, min(int(n_sims), 5000))
    port = compute_portfolio(owner_id=owner_id)
    if not port.get("has_transactions") or not port.get("holdings"):
        return {"has_portfolio": False}

    held = [h for h in port["holdings"]
            if h.get("market_value") and h["market_value"] > 0 and h.get("security_id")]
    if not held:
        return {"has_portfolio": False}

    if weights:
        # simulated allocation: same starting money, caller-specified weights
        clean = {str(t).upper(): float(w) for t, w in weights.items()
                 if float(w) > 0}
        sid_map = _resolve_ticker_sids(sorted(clean))
        assets = [{"ticker": t, "security_id": sid_map[t], "weight": clean[t]}
                  for t in clean if t in sid_map]
        if not assets:
            return {"has_portfolio": True, "insufficient_history": True,
                    "excluded": sorted(clean)}
        start_money = float(sum(h["market_value"] for h in held))
    else:
        assets = [{"ticker": h.get("ticker"),
                   "security_id": int(h["security_id"]),
                   "weight": float(h["market_value"])} for h in held]
        start_money = float(sum(a["weight"] for a in assets))

    sids = [int(a["security_id"]) for a in assets]
    bench_ticker = (compare_bench or "").upper().strip() or None
    bench_sid = None
    if bench_ticker:
        bench_sid = _resolve_ticker_sids([bench_ticker]).get(bench_ticker)
    px = _load_price_history(
        sids + ([bench_sid] if bench_sid and bench_sid not in sids else []),
        lookback_days)

    # Daily log returns; keep only assets with enough overlapping history.
    rets_full = np.log(px / px.shift(1)) if not px.empty else pd.DataFrame()
    usable, excluded = [], []
    for a in assets:
        sid = int(a["security_id"])
        has_col = not rets_full.empty and sid in rets_full.columns
        col = rets_full[sid].dropna() if has_col else pd.Series(dtype=float)
        (usable if len(col) >= MIN_RETURNS else excluded).append(a)

    if not usable:
        return {"has_portfolio": True, "insufficient_history": True,
                "excluded": [a.get("ticker") for a in excluded]}

    sids_u = [int(a["security_id"]) for a in usable]
    rets = rets_full[sids_u].dropna()  # common dates across the usable set
    if len(rets) < MIN_RETURNS:
        return {"has_portfolio": True, "insufficient_history": True,
                "excluded": [a.get("ticker") for a in excluded]}

    # Weights renormalized over the usable assets; starting equity = the
    # portfolio's current position value (same money, chosen allocation).
    mv = np.array([float(a["weight"]) for a in usable])
    start_balance = start_money
    w = mv / mv.sum()

    mean_d = rets.mean().to_numpy()
    cov_d = np.cov(rets.to_numpy(), rowvar=False)
    if cov_d.ndim == 0:  # single holding
        cov_d = np.array([[float(cov_d)]])
    cov_annual = cov_d * TRADING_DAYS
    if stress:
        cov_annual = _stress_covariance(cov_annual)
    mu_trailing = mean_d * TRADING_DAYS
    # Shrink expected return toward a long-run market prior — short-window means
    # are unreliable and would otherwise project a recent bull run forever.
    # Volatility/correlation are kept trailing (far more estimable).
    mu_annual = (1.0 - RETURN_SHRINK) * mu_trailing + RETURN_SHRINK * MARKET_PRIOR
    vol_annual = np.sqrt(np.clip(np.diag(cov_annual), 0, None))

    mu_m = mu_annual / MONTHS_PER_YEAR
    cov_m = cov_annual / MONTHS_PER_YEAR
    L = _chol(cov_m)
    k = len(sids_u)
    rng = np.random.default_rng(PROJECTION_SEED)
    n_months = years * MONTHS_PER_YEAR
    monthly_fee = (1.0 - annual_fee) ** (1.0 / MONTHS_PER_YEAR) if annual_fee else 1.0

    # Simulate. balance: contribution-bearing value (for the cone). growth: $1
    # market-only path (for max drawdown, so contributions don't mask risk).
    balances = np.full(n_sims, start_balance, dtype=float)
    growth = np.ones(n_sims, dtype=float)
    peak = np.ones(n_sims, dtype=float)
    max_dd = np.zeros(n_sims, dtype=float)
    yearly = np.zeros((n_sims, years), dtype=float)

    for m in range(n_months):
        z = rng.standard_normal((n_sims, k))
        shocks = z @ L.T  # (n_sims, k) ~ N(0, cov_m)
        asset_ret = mu_m + shocks  # arithmetic monthly returns
        port_ret = np.clip(asset_ret @ w, -0.95, None)  # portfolio monthly return
        balances = (balances + monthly) * (1.0 + port_ret) * monthly_fee
        growth = growth * (1.0 + port_ret)
        peak = np.maximum(peak, growth)
        max_dd = np.minimum(max_dd, growth / peak - 1.0)
        if (m + 1) % MONTHS_PER_YEAR == 0:
            yearly[:, (m + 1) // MONTHS_PER_YEAR - 1] = balances

    contributed = start_balance + monthly * n_months

    def pcts(a: np.ndarray) -> dict[str, float]:
        return {
            "p10": float(np.percentile(a, 10)),
            "p50": float(np.percentile(a, 50)),
            "p90": float(np.percentile(a, 90)),
        }

    # Optional benchmark comparison: a single-asset sim of `compare_bench` with
    # the SAME contributions/fee (its own seed) — "what if I just bought SPY".
    bench_out: dict[str, Any] | None = None
    if bench_sid is not None and not rets_full.empty and bench_sid in rets_full.columns:
        bcol = rets_full[bench_sid].dropna()
        if len(bcol) >= MIN_RETURNS:
            b_mu_trail = float(bcol.mean()) * TRADING_DAYS
            b_mu = (1.0 - RETURN_SHRINK) * b_mu_trail + RETURN_SHRINK * MARKET_PRIOR
            b_vol = float(bcol.std()) * float(np.sqrt(TRADING_DAYS))
            b_rng = np.random.default_rng(PROJECTION_SEED + 1)
            b_bal = np.full(n_sims, start_balance, dtype=float)
            b_yearly = np.zeros((n_sims, years), dtype=float)
            b_mu_m = b_mu / MONTHS_PER_YEAR
            b_sd_m = b_vol / np.sqrt(MONTHS_PER_YEAR)
            for m in range(n_months):
                r = np.clip(b_mu_m + b_sd_m * b_rng.standard_normal(n_sims),
                            -0.95, None)
                b_bal = (b_bal + monthly) * (1.0 + r) * monthly_fee
                if (m + 1) % MONTHS_PER_YEAR == 0:
                    b_yearly[:, (m + 1) // MONTHS_PER_YEAR - 1] = b_bal
            bench_out = {
                "ticker": bench_ticker,
                "terminal": {k2: round(v, 2) for k2, v in pcts(b_bal).items()},
                "cone_p50": [round(float(np.percentile(b_yearly[:, y], 50)), 2)
                             for y in range(years)],
                "assumptions": {"ann_return": round(b_mu, 4),
                                "ann_vol": round(b_vol, 4)},
                "prob_beat": round(float((balances > b_bal).mean()), 4),
            }

    cone = {
        "years": list(range(1, years + 1)),
        "p10": [float(np.percentile(yearly[:, y], 10)) for y in range(years)],
        "p50": [float(np.percentile(yearly[:, y], 50)) for y in range(years)],
        "p90": [float(np.percentile(yearly[:, y], 90)) for y in range(years)],
    }
    assumptions = [
        {"ticker": h.get("ticker"), "weight": round(float(w[i]), 4),
         "ann_return": round(float(mu_annual[i]), 4),
         "ann_return_trailing": round(float(mu_trailing[i]), 4),
         "ann_vol": round(float(vol_annual[i]), 4)}
        for i, h in enumerate(usable)
    ]
    port_mu = float(w @ mu_annual)
    port_vol = float(np.sqrt(max(w @ cov_annual @ w, 0.0)))

    return {
        "has_portfolio": True,
        "stress": stress,
        "params": {"years": years, "monthly": monthly, "annual_fee": annual_fee,
                   "n_sims": n_sims, "lookback_days": lookback_days},
        "start_balance": round(start_balance, 2),
        "contributed": round(contributed, 2),
        "terminal": {k2: round(v, 2) for k2, v in pcts(balances).items()},
        "cone": cone,
        "max_drawdown": {"p50": round(float(np.percentile(max_dd, 50)), 4),
                         "p10": round(float(np.percentile(max_dd, 10)), 4)},  # p10 = a bad path
        "prob_gain": round(float((balances > contributed).mean()), 4),
        "prob_goal": (round(float((balances >= float(goal)).mean()), 4)
                      if goal and float(goal) > 0 else None),
        "goal": float(goal) if goal and float(goal) > 0 else None,
        "benchmark": bench_out,
        "simulated_weights": ({a["ticker"]: round(float(wi), 4)
                               for a, wi in zip(usable, w, strict=False)}
                              if weights else None),
        "portfolio_assumptions": {"ann_return": round(port_mu, 4), "ann_vol": round(port_vol, 4),
                                  "n_obs": int(len(rets))},
        "holdings_assumptions": assumptions,
        "excluded": [h.get("ticker") for h in excluded],
        "disclaimer": DISCLAIMER,
        "seed": PROJECTION_SEED,
    }
