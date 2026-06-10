"""Phase 6 — Factor scoring (factor_scores, config_version='v1_linear').

Computes Growth / Value / Quality / Momentum percentiles and a weighted
composite per security for the latest score_date (= newest prices_daily
date), with raw inputs stored in `details` for the deep-dive page.

Methodology:

- Sub-metrics rank ONLY among securities that have them (pandas NaN-aware
  percentile ranks). A bank with no gross margin simply isn't ranked on
  gross margin; its quality score averages the sub-percentiles it has.
  Missing is never worst-ranked. If a whole factor is missing, the
  composite renormalizes the remaining factors' weights.
- Percentiles are 0-100, higher = more attractive. Lower-better metrics
  (P/E, P/S, EV/EBITDA, debt/equity, net-debt/EBITDA) are ranked descending.
- ROIC pools: companies whose stored `roic` is the ROA proxy (detected by
  mirroring the metrics engine's own condition — no operating-income TTM or
  no valid invested capital) are ranked in a SEPARATE pool from true-ROIC
  companies; the two within-pool percentiles are then merged into one
  quality sub-percentile. Proxy values never contaminate true-ROIC ranks.
- Momentum = cross-sectional percentile of raw 3/6/12-month total returns
  from adj_close (inherently relative to the universe; no SPY fetch in v1).
- Valuation uses the split-adjusted raw `close` (same basis as ttm_eps) and
  score-time fundamentals recomputed from xbrl_facts with the Phase 5
  helpers: market cap = close x split-adjusted shares; EV = mktcap + total
  debt - cash; EBITDA = TTM operating income + TTM D&A. Non-positive
  denominators (EPS, revenue, EBITDA) make the ratio missing, not ranked.
- Weights come from score_config (config_version 'v1_linear'), not code.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

from engine.db import get_connection
from engine.jobs import finish_job, start_job
from engine.metrics import (
    Fact,
    _preferred_shares,
    fact_is_clean,
    latest_instant,
    snapshot,
    total_debt_at,
    ttm,
)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

JOB_NAME = "factor_scoring"
JOB_VERSION = "v1"
CONFIG_VERSION = "v1_linear"

MOMENTUM_WINDOWS = {"r3m": 91, "r6m": 182, "r12m": 365}
MOMENTUM_LOOKBACK_GRACE = 20  # days a reference bar may precede the target

# (column, direction) per factor; direction 'higher' or 'lower' = better.
FACTOR_DEFS = {
    "growth": [("revenue_cagr", "higher"), ("eps_growth", "higher")],
    "value": [
        ("pe", "lower"),
        ("ps", "lower"),
        ("ev_ebitda", "lower"),
        ("fcf_yield", "higher"),
    ],
    "quality": [
        ("gross_margin", "higher"),
        ("operating_margin", "higher"),
        ("roic", "higher"),  # ranked in split pools, see _roic_percentiles
        ("debt_to_equity", "lower"),
        ("net_debt_ebitda", "lower"),
    ],
    "momentum": [("r3m", "higher"), ("r6m", "higher"), ("r12m", "higher")],
}

SCORE_TIME_CONCEPTS = (
    "operating_income",
    "depreciation_amortization",
    "total_equity",
    "total_debt",
    "cash_and_equivalents",
    "shares_outstanding",
)


def _load_weights(cur) -> dict[str, float]:
    cur.execute(
        "SELECT weights FROM score_config WHERE config_version = %s", (CONFIG_VERSION,)
    )
    row = cur.fetchone()
    if row is None or not row[0]:
        raise RuntimeError(f"score_config '{CONFIG_VERSION}' missing or has no weights")
    return {k: float(v) for k, v in row[0].items()}


def _load_latest_metrics(cur) -> pd.DataFrame:
    """Latest value per (security, metric) from fundamental_metrics."""
    cur.execute(
        """
        SELECT DISTINCT ON (m.security_id, m.metric)
               m.security_id, m.metric, m.value
        FROM fundamental_metrics m
        WHERE m.metric_version = 'v1'
        ORDER BY m.security_id, m.metric, m.as_of_date DESC
        """
    )
    df = pd.DataFrame(cur.fetchall(), columns=["security_id", "metric", "value"])
    if df.empty:
        return df
    df["value"] = df["value"].astype(float)
    return df.pivot(index="security_id", columns="metric", values="value")


def _load_price_inputs(cur, score_date) -> pd.DataFrame:
    """Latest close + 3/6/12-month total returns per security."""
    start = score_date - timedelta(days=max(MOMENTUM_WINDOWS.values()) + 40)
    cur.execute(
        """
        SELECT security_id, date, close, adj_close
        FROM prices_daily WHERE date >= %s
        """,
        (start,),
    )
    px = pd.DataFrame(cur.fetchall(), columns=["security_id", "date", "close", "adj_close"])
    px["close"] = px["close"].astype(float)
    px["adj_close"] = px["adj_close"].astype(float)
    out = {}
    for sid, g in px.groupby("security_id"):
        g = g.sort_values("date")
        last = g.iloc[-1]
        if (score_date - last["date"]).days > 10:
            continue  # stale price; skip valuation/momentum for this name
        row = {"close": last["close"]}
        for name, days in MOMENTUM_WINDOWS.items():
            target = score_date - timedelta(days=days)
            ref = g[(g["date"] <= target)
                    & (g["date"] >= target - timedelta(days=MOMENTUM_LOOKBACK_GRACE))]
            if not ref.empty and ref.iloc[-1]["adj_close"] > 0:
                row[name] = last["adj_close"] / ref.iloc[-1]["adj_close"] - 1.0
        out[sid] = row
    return pd.DataFrame.from_dict(out, orient="index")


def _load_score_time_fundamentals(cur) -> pd.DataFrame:
    """Per-security shares, debt, cash, EBITDA and the ROIC-pool flag.

    Recomputed from xbrl_facts at each security's latest snapshot using the
    Phase 5 helpers (same hygiene, same debt composition, same anchoring).
    """
    cur.execute(
        """
        SELECT security_id, concept, normalized_concept, unit, value,
               period_start, period_end, fiscal_period, filed_date
        FROM xbrl_facts WHERE normalized_concept = ANY(%s)
        """,
        (list(SCORE_TIME_CONCEPTS),),
    )
    by_sid: dict[int, list[Fact]] = defaultdict(list)
    for row in cur.fetchall():
        f = Fact(*row[1:])
        if fact_is_clean(f):
            by_sid[row[0]].append(f)

    cur.execute(
        """
        SELECT security_id, ex_date, ratio FROM corporate_actions
        WHERE action_type = 'split' AND ratio IS NOT NULL ORDER BY ex_date
        """
    )
    splits_by_sid: dict[int, list] = defaultdict(list)
    for sid, ex, ratio in cur.fetchall():
        splits_by_sid[sid].append((ex, float(ratio)))

    out = {}
    for sid, facts in by_sid.items():
        snap = snapshot(facts, max(f.filed for f in facts))
        oi_ttm, _, _ = ttm(snap, "operating_income")
        da_ttm, _, _ = ttm(snap, "depreciation_amortization")
        equity_pt = latest_instant(snap, "total_equity")
        anchor = equity_pt[0] if equity_pt else None
        equity = equity_pt[1] if equity_pt else None
        debt = total_debt_at(snap, anchor) if anchor else None
        cash = None
        if anchor:
            from engine.metrics import instant_at

            cash = instant_at(snap, "cash_and_equivalents", anchor)
        shares = _preferred_shares(snap, splits_by_sid.get(sid, []))
        ebitda = oi_ttm + da_ttm if (oi_ttm is not None and da_ttm is not None) else None
        ic_valid = equity is not None and equity > 0 and (
            equity + (debt or 0.0) - (cash or 0.0)
        ) > 0
        out[sid] = {
            "shares": shares,
            "debt": debt,
            "cash": cash,
            "ebitda": ebitda,
            "roic_is_proxy": not (oi_ttm is not None and ic_valid),
        }
    return pd.DataFrame.from_dict(out, orient="index")


def _pctl(series: pd.Series, direction: str) -> pd.Series:
    """0-100 percentile rank among non-null holders; higher = better."""
    return series.rank(ascending=(direction == "higher"), pct=True, method="average") * 100


def _roic_percentiles(df: pd.DataFrame) -> pd.Series:
    """Rank true-ROIC and ROA-proxy values in separate pools, then merge."""
    proxy = df["roic_is_proxy"].fillna(True).astype(bool)
    out = pd.Series(index=df.index, dtype=float)
    out[~proxy] = _pctl(df.loc[~proxy, "roic"], "higher")
    out[proxy] = _pctl(df.loc[proxy, "roic"], "higher")
    return out


def run() -> dict:
    conn = get_connection()
    with conn.cursor() as cur:
        weights = _load_weights(cur)
        cur.execute("SELECT max(date) FROM prices_daily")
        score_date = cur.fetchone()[0]
        cur.execute(
            "SELECT security_id, ticker FROM securities WHERE is_active ORDER BY ticker"
        )
        tickers = dict(cur.fetchall())

    job_id = start_job(
        conn,
        JOB_NAME,
        job_version=JOB_VERSION,
        params={"config_version": CONFIG_VERSION, "weights": weights},
        data_date=score_date,
    )

    try:
        with conn.cursor() as cur:
            metrics = _load_latest_metrics(cur)
            prices = _load_price_inputs(cur, score_date)
            fundamentals = _load_score_time_fundamentals(cur)

        df = metrics.join(prices, how="outer").join(fundamentals, how="outer")
        df = df[df.index.isin(tickers)]
        df["ticker"] = df.index.map(tickers)

        # --- valuation sub-metrics ---
        df["mktcap"] = df["close"] * df["shares"]
        df["pe"] = df.apply(
            lambda r: r["close"] / r["ttm_eps"]
            if pd.notna(r.get("close")) and pd.notna(r.get("ttm_eps")) and r["ttm_eps"] > 0
            else float("nan"),
            axis=1,
        )
        df["ps"] = df.apply(
            lambda r: r["mktcap"] / r["ttm_revenue"]
            if pd.notna(r.get("mktcap")) and pd.notna(r.get("ttm_revenue"))
            and r["ttm_revenue"] > 0
            else float("nan"),
            axis=1,
        )
        df["ev_ebitda"] = df.apply(
            lambda r: (r["mktcap"] + (r["debt"] if pd.notna(r.get("debt")) else 0.0)
                       - (r["cash"] if pd.notna(r.get("cash")) else 0.0)) / r["ebitda"]
            if pd.notna(r.get("mktcap")) and pd.notna(r.get("ebitda")) and r["ebitda"] > 0
            else float("nan"),
            axis=1,
        )
        df["fcf_yield"] = df.apply(
            lambda r: r["fcf"] / r["mktcap"]
            if pd.notna(r.get("fcf")) and pd.notna(r.get("mktcap")) and r["mktcap"] > 0
            else float("nan"),
            axis=1,
        )

        # --- sub-metric percentiles ---
        sub_pctls: dict[str, pd.Series] = {}
        for _factor, defs in FACTOR_DEFS.items():
            for col, direction in defs:
                if col == "roic":
                    sub_pctls[col] = _roic_percentiles(df)
                elif col in df.columns:
                    sub_pctls[col] = _pctl(df[col], direction)
                else:
                    sub_pctls[col] = pd.Series(index=df.index, dtype=float)

        # --- factor percentiles: mean of available sub-percentiles ---
        factor_pctls: dict[str, pd.Series] = {}
        for factor, defs in FACTOR_DEFS.items():
            cols = pd.DataFrame({c: sub_pctls[c] for c, _ in defs})
            factor_pctls[factor] = cols.mean(axis=1, skipna=True)

        # --- composite: weights renormalized over available factors ---
        fp = pd.DataFrame(factor_pctls)
        w = pd.Series(weights)
        avail_w = fp.notna() @ w.reindex(fp.columns).fillna(0)  # total weight available
        weighted = (fp * w.reindex(fp.columns)).sum(axis=1, skipna=True)
        composite = weighted / avail_w.replace(0, float("nan"))

        # --- write factor_scores ---
        rows = []
        for sid in df.index:
            details = {
                "inputs": {
                    c: (round(float(df.at[sid, c]), 6) if pd.notna(df.at[sid, c]) else None)
                    for c in [
                        "revenue_cagr", "eps_growth", "pe", "ps", "ev_ebitda", "fcf_yield",
                        "gross_margin", "operating_margin", "roic", "debt_to_equity",
                        "net_debt_ebitda", "r3m", "r6m", "r12m", "close", "shares", "mktcap",
                    ]
                    if c in df.columns
                },
                "sub_pctls": {
                    c: (round(float(s[sid]), 2) if pd.notna(s[sid]) else None)
                    for c, s in sub_pctls.items()
                },
                "flags": {
                    "roic_pool": (
                        "roa_proxy"
                        if bool(df.at[sid, "roic_is_proxy"])
                        else "true_roic"
                    )
                    if pd.notna(df.at[sid, "roic_is_proxy"])
                    else None,
                    "momentum_basis": "cross_sectional_raw_returns_no_spy",
                },
                "weights": weights,
            }

            def val(series, _sid=sid):
                v = series[_sid]
                return round(float(v), 2) if pd.notna(v) else None

            comp = composite[sid]
            rows.append(
                (
                    int(sid),
                    score_date,
                    CONFIG_VERSION,
                    val(factor_pctls["growth"]),
                    val(factor_pctls["value"]),
                    val(factor_pctls["quality"]),
                    val(factor_pctls["momentum"]),
                    round(float(comp), 4) if pd.notna(comp) else None,
                    json.dumps(details),
                )
            )

        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO factor_scores
                  (security_id, score_date, config_version, growth_pctl, value_pctl,
                   quality_pctl, momentum_pctl, composite, details)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (security_id, score_date, config_version) DO UPDATE
                  SET growth_pctl = EXCLUDED.growth_pctl,
                      value_pctl = EXCLUDED.value_pctl,
                      quality_pctl = EXCLUDED.quality_pctl,
                      momentum_pctl = EXCLUDED.momentum_pctl,
                      composite = EXCLUDED.composite,
                      details = EXCLUDED.details
                """,
                rows,
            )
        conn.commit()

        scored = sum(1 for r in rows if r[7] is not None)
        finish_job(conn, job_id, status="success", rows_affected=len(rows))

        # --- sanity report data ---
        report = df[["ticker"]].copy()
        for f in FACTOR_DEFS:
            report[f] = factor_pctls[f]
        report["composite"] = composite

        return {
            "score_date": str(score_date),
            "rows_written": len(rows),
            "scored_with_composite": scored,
            "true_roic_pool": int((~df["roic_is_proxy"].fillna(True).astype(bool)).sum()),
            "roa_proxy_pool": int(df["roic_is_proxy"].fillna(True).astype(bool).sum()),
            "weights": weights,
            "report": report,
            "job_id": job_id,
        }
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        finish_job(conn, job_id, status="failed", error=str(exc))
        raise
    finally:
        if not conn.closed:
            conn.close()
