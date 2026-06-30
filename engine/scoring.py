"""Phase 6 — Factor scoring (factor_scores).

Computes Growth / Value / Quality / Momentum percentiles and a weighted
composite per security for the latest score_date (= newest prices_daily
date), with raw inputs stored in `details` for the deep-dive page.

Versioned via config_version (FACTOR_DEFS_BY_VERSION + score_config):
- v1_linear: the frozen baseline.
- v2_linear: adds Sloan accruals, net-share-issuance and discretionary
  insider net-buy to the Quality factor, and swaps raw 12-month momentum for
  the academic-standard 12-minus-1 construction (skip the reversal-prone last
  month). run(config_version=...) selects the spec; run(write=False) is a dry
  run for validating a config without touching factor_scores. Both versions'
  rows coexist per score_date; engine.queries.ACTIVE_CONFIG_VERSION decides
  which the app serves.

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
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import psycopg
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

# Which config the nightly/weekly default run writes, and which the read layer
# (engine.queries.ACTIVE_CONFIG_VERSION) serves. Bumped to 'v4_lean' at the
# 2026-06-30 cutover — v5_qmean carries the pruning into the Quality MEAN, dropping
# the three measured-noise members (gross_margin/debt_to_equity/net_debt_ebitda) the
# equal-weight average still diluted Quality with. Cleanly beat v4_lean on the §6
# gate (IC +0.067->+0.072, t 5.47->5.73, Sharpe 1.04->1.06, turnover flat) AND in
# both split-halves. Prior configs' rows coexist for rollback (flip both constants
# back to 'v4_lean' / 'v3_pruned' / 'v2_linear').
DEFAULT_CONFIG_VERSION = "v5_qmean"

# 12-month return SKIPPING the most recent ~month: the last month exhibits
# short-term reversal, so the academic-standard momentum signal is the
# 12-minus-1 return. v2 momentum uses it in place of raw r12m.
MOMENTUM_WINDOWS = {"r3m": 91, "r6m": 182, "r12m": 365}
MOMENTUM_SKIP_DAYS = 21       # the "minus one month" gap for 12-1 momentum
MOMENTUM_LOOKBACK_GRACE = 20  # days a reference bar may precede the target

# Data-integrity guards on the price-return inputs, mirroring the backtest's
# _fwd_returns so the live screener and the Lab rank the SAME universe. Without
# them an unadjusted reverse split (e.g. PPCB adj_close $0.01 -> $250, a +2.5M%
# "return") would rank as the #1 momentum name.
#   (1) MIN_PRICE — drop names whose latest close is below $1 from scoring
#       entirely. Sub-$1 names are untradeable in practice AND the main source of
#       unadjusted-split price errors. Applied to the whole universe so every
#       factor's percentiles are computed over the same >=$1 set as the backtest.
#   (2) winsorize the 3/6/12-month returns. NOTE the cap is far higher than the
#       backtest's monthly +200% because these are CUMULATIVE multi-month returns
#       (a real name can legitimately be up several hundred % over 12 months); the
#       cap exists only to neutralize gross data errors (10x+), not clip winners.
MIN_PRICE = 1.0            # drop names with latest close < $1
RET_WINSOR_CAP = 9.0       # cap a cumulative return at +900% (10x)
RET_WINSOR_FLOOR = -0.95   # floor a cumulative return at -95%

# (column, direction) per factor; direction 'higher' or 'lower' = better.
# Versioned: v1_linear is the frozen baseline; v2_linear adds the Sloan
# accruals + net-share-issuance + discretionary-insider-net-buy quality
# sub-signals and swaps raw 12m momentum for the 12-minus-1 construction.
FACTOR_DEFS_V1 = {
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

FACTOR_DEFS_V2 = {
    "growth": FACTOR_DEFS_V1["growth"],
    "value": FACTOR_DEFS_V1["value"],
    "quality": [
        ("gross_margin", "higher"),
        ("operating_margin", "higher"),
        ("roic", "higher"),
        ("debt_to_equity", "lower"),
        ("net_debt_ebitda", "lower"),
        ("accruals", "lower"),           # Sloan: cash-backed earnings = better
        ("share_count_trend", "lower"),  # net issuance bad, buybacks good
        ("insider_net_buy", "higher"),   # discretionary insider conviction
    ],
    "momentum": [("r3m", "higher"), ("r6m", "higher"), ("r12_1m", "higher")],
}

# v3_pruned: drop the two Quality sub-signals the Phase-0 per-sub-metric IC
# backtest disqualified — `accruals` (PREDICTIVE BUT WRONG-SIGNED: IC t=-4.1,
# consistently negative in BOTH halves of 2022-26, so the Sloan low-accruals
# premium is inverted in this survivor universe and was dragging Quality) and
# `insider_net_buy` (INSUFFICIENT DATA: median 0 valid names/month — too sparse
# to rank). Both stay computed in fundamental_metrics and shown on the deep-dive;
# they're only removed from the ranked Quality mean. Everything else is identical
# to v2_linear, so v3_pruned shares its 4 factor weights — seeded as its own
# score_config row in migration 0024 (factor_scores' config_version FK needs one).
FACTOR_DEFS_V3_PRUNED = {
    "growth": FACTOR_DEFS_V2["growth"],
    "value": FACTOR_DEFS_V2["value"],
    "quality": [
        ("gross_margin", "higher"),
        ("operating_margin", "higher"),
        ("roic", "higher"),
        ("debt_to_equity", "lower"),
        ("net_debt_ebitda", "lower"),
        ("share_count_trend", "lower"),
    ],
    "momentum": FACTOR_DEFS_V2["momentum"],
}

# v4_lean: v3_pruned, plus drop the two sub-metrics the Phase-0 backtest scored as
# PURE NOISE — `pe` (IC t=+0.1, sign even flips across split-halves) from Value and
# `r3m` (IC t=+0.1) from Momentum. Value keeps ps + ev_ebitda + fcf_yield (still 3,
# so coverage isn't thinned); Momentum keeps r6m + r12_1m. Subtraction candidate —
# ship only if it's no worse than v3_pruned on the §6 gate. Reuses v2 weights.
FACTOR_DEFS_V4_LEAN = {
    "growth": FACTOR_DEFS_V3_PRUNED["growth"],
    "value": [("ps", "lower"), ("ev_ebitda", "lower"), ("fcf_yield", "higher")],
    "quality": FACTOR_DEFS_V3_PRUNED["quality"],
    "momentum": [("r6m", "higher"), ("r12_1m", "higher")],
}

# v5_qmean: carry the Phase-0 pruning INTO the Quality factor mean. v4_lean still
# averages three measured-noise members into Quality — `gross_margin` (IC t=-0.5),
# `debt_to_equity` (t=-1.7) and `net_debt_ebitda` (t=0.6) — diluting the three that
# actually predict: operating_margin (t=3.8), roic (t=5.3), share_count_trend
# (t=6.5, our strongest signal). Dropping the noise from the *average* (not just
# from the ranked list, as v4 did for pe/r3m) is the safest, survivorship-FAVOURABLE
# subtraction: it removes the leverage/distress metrics whose academic edge lives in
# the delisted losers this universe censors. Zero new parameters (the keep/drop uses
# pre-measured ICs, not an in-sample fit), so the bar is parity-or-better, with the
# subtraction tie-break. Growth/Value/Momentum unchanged from v4_lean. Dropped
# metrics stay in details.inputs as deep-dive context. Dormant until it clears the
# §6 gate vs v4_lean; reuses v2/v4 factor weights (migration 0026).
FACTOR_DEFS_V5_QMEAN = {
    "growth": FACTOR_DEFS_V4_LEAN["growth"],
    "value": FACTOR_DEFS_V4_LEAN["value"],
    "quality": [
        ("operating_margin", "higher"),
        ("roic", "higher"),
        ("share_count_trend", "lower"),
    ],
    "momentum": FACTOR_DEFS_V4_LEAN["momentum"],
}

FACTOR_DEFS_BY_VERSION = {
    "v1_linear": FACTOR_DEFS_V1,
    "v2_linear": FACTOR_DEFS_V2,
    "v3_pruned": FACTOR_DEFS_V3_PRUNED,
    "v4_lean": FACTOR_DEFS_V4_LEAN,
    "v5_qmean": FACTOR_DEFS_V5_QMEAN,
}

# details.inputs key list per version (v1 frozen exactly; v2 adds the new
# sub-signals it actually ranks on; v3_pruned drops the two it disqualified).
_BASE_INPUTS = [
    "revenue_cagr", "eps_growth", "pe", "ps", "ev_ebitda", "fcf_yield",
    "gross_margin", "operating_margin", "roic", "debt_to_equity",
    "net_debt_ebitda", "r3m", "r6m", "r12m", "close", "shares", "mktcap",
]
INPUTS_BY_VERSION = {
    "v1_linear": _BASE_INPUTS,
    "v2_linear": _BASE_INPUTS + ["r12_1m", "accruals", "share_count_trend",
                                 "insider_net_buy"],
    "v3_pruned": _BASE_INPUTS + ["r12_1m", "share_count_trend"],
    # v4 keeps pe/r3m's raw values in details.inputs as deep-dive context even
    # though they're no longer ranked (absent from sub_pctls).
    "v4_lean": _BASE_INPUTS + ["r12_1m", "share_count_trend"],
    # v5 keeps the same input list as v4 — the three metrics it drops from the
    # Quality mean (gross_margin/debt_to_equity/net_debt_ebitda) are already in
    # _BASE_INPUTS, so they remain visible on the deep-dive as raw context.
    "v5_qmean": _BASE_INPUTS + ["r12_1m", "share_count_trend"],
}

MOMENTUM_BASIS_BY_VERSION = {
    "v1_linear": "cross_sectional_raw_returns_no_spy",
    "v2_linear": "12_minus_1_momentum_plus_3_6m_raw_no_spy",
    "v3_pruned": "12_minus_1_momentum_plus_3_6m_raw_no_spy",
    "v4_lean": "12_minus_1_momentum_plus_6m_raw_no_spy",
    "v5_qmean": "12_minus_1_momentum_plus_6m_raw_no_spy",
}

# Discretionary insider net-buy signal window (trailing months).
INSIDER_WINDOW_MONTHS = 12

SCORE_TIME_CONCEPTS = (
    "operating_income",
    "depreciation_amortization",
    "depreciation",   # fallback components when no combined D&A line is reported
    "amortization",   # (many large caps tag Depreciation + intangible amort separately)
    "total_equity",
    "total_debt",
    "cash_and_equivalents",
    "shares_outstanding",
)


def _load_weights(cur, config_version: str) -> dict[str, float]:
    cur.execute(
        "SELECT weights FROM score_config WHERE config_version = %s", (config_version,)
    )
    row = cur.fetchone()
    if row is None or not row[0]:
        raise RuntimeError(f"score_config '{config_version}' missing or has no weights")
    return {k: float(v) for k, v in row[0].items()}


def _load_latest_metrics(cur, as_of: date | None = None) -> pd.DataFrame:
    """Latest value per (security, metric) from fundamental_metrics.

    as_of restricts to snapshots known by that date (as_of_date <= as_of) —
    the point-in-time view the backtester needs; None = newest available.
    """
    cur.execute(
        """
        SELECT DISTINCT ON (m.security_id, m.metric)
               m.security_id, m.metric, m.value
        FROM fundamental_metrics m
        WHERE m.metric_version = 'v1'
          AND (%s::date IS NULL OR m.as_of_date <= %s)
        ORDER BY m.security_id, m.metric, m.as_of_date DESC
        """,
        (as_of, as_of),
    )
    df = pd.DataFrame(cur.fetchall(), columns=["security_id", "metric", "value"])
    if df.empty:
        return df
    df["value"] = df["value"].astype(float)
    return df.pivot(index="security_id", columns="metric", values="value")


def _load_price_inputs(cur, score_date) -> pd.DataFrame:
    """Latest close + 3/6/12-month total returns per security."""
    start = score_date - timedelta(days=max(MOMENTUM_WINDOWS.values()) + 40)
    # Cap at score_date so a backtest never sees a future price (no look-ahead).
    # Join to active securities so the planner walks the (security_id, date) PK
    # per active name instead of a date-only scan over every staged/inactive
    # ticker too — far fewer rows, and it stops the CI statement timeout. Scoring
    # only ranks active names anyway, so the result set is unchanged.
    cur.execute(
        """
        SELECT p.security_id, p.date, p.close, p.adj_close
        FROM prices_daily p
        JOIN securities s ON s.security_id = p.security_id AND s.is_active
        WHERE p.date >= %s AND p.date <= %s
        """,
        (start, score_date),
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
        def _ref_adj(days_back: int, _g=g, _sd=score_date):
            """Adj close at ~days_back, within the lookback grace window."""
            target = _sd - timedelta(days=days_back)
            ref = _g[(_g["date"] <= target)
                     & (_g["date"] >= target - timedelta(days=MOMENTUM_LOOKBACK_GRACE))]
            return ref.iloc[-1]["adj_close"] if not ref.empty else None

        def _winsor(r: float) -> float:
            return min(RET_WINSOR_CAP, max(RET_WINSOR_FLOOR, r))

        row = {"close": last["close"]}
        for name, days in MOMENTUM_WINDOWS.items():
            ref = _ref_adj(days)
            if ref is not None and ref > 0:
                row[name] = _winsor(last["adj_close"] / ref - 1.0)
        # 12-minus-1 momentum: return from ~12 months ago to ~1 month ago,
        # skipping the most recent month (short-term reversal). Numerator and
        # denominator are both lagged prices, not today's close.
        num = _ref_adj(MOMENTUM_SKIP_DAYS)
        den = _ref_adj(MOMENTUM_WINDOWS["r12m"])
        if num is not None and den is not None and den > 0:
            row["r12_1m"] = _winsor(num / den - 1.0)
        out[sid] = row
    return pd.DataFrame.from_dict(out, orient="index")


def _load_insider_signal(cur, as_of: date | None = None) -> pd.DataFrame:
    """Discretionary insider net-buy value per security over the window.

    Open-market buys (code P) minus sells (code S), EXCLUDING pre-scheduled
    10b5-1 plan trades (which carry little signal). Only securities with at
    least one discretionary open-market transaction get a value; everyone
    else is absent (NaN), so the sparse signal never penalizes the ~80% of
    names with no insider trading. Scaled by market cap in run(), where it's
    available. Buys are the documented signal; the asymmetry is preserved by
    netting at value and letting buys push the rank up. as_of (point-in-time)
    bounds the window to [as_of - window, as_of] and to filings known by then.
    """
    eff = as_of or date.today()
    cur.execute(
        """
        SELECT s.security_id,
               sum(CASE WHEN it.transaction_code = 'P'
                        THEN coalesce(it.value, 0) ELSE 0 END) AS buy_value,
               sum(CASE WHEN it.transaction_code = 'S'
                        THEN coalesce(it.value, 0) ELSE 0 END) AS sell_value,
               count(*) FILTER (WHERE it.transaction_code = 'P') AS buy_n,
               count(*) FILTER (WHERE it.transaction_code = 'S') AS sell_n
        FROM insider_transactions it
        JOIN securities s ON s.security_id = it.security_id
        WHERE it.transaction_code IN ('P', 'S')
          AND coalesce(it.plan_10b5_1, false) = false
          AND it.transaction_date >= %s::date - %s * INTERVAL '1 month'
          AND it.transaction_date <= %s::date
          AND it.filed_date <= %s::date
        GROUP BY s.security_id
        """,
        (eff, INSIDER_WINDOW_MONTHS, eff, eff),
    )
    out = {}
    for sid, buy_v, sell_v, buy_n, sell_n in cur.fetchall():
        out[sid] = {
            "insider_net_value": float(buy_v or 0) - float(sell_v or 0),
            "insider_buy_n": int(buy_n or 0),
            "insider_sell_n": int(sell_n or 0),
        }
    return pd.DataFrame.from_dict(out, orient="index")


def _load_score_time_fundamentals(cur, as_of: date | None = None) -> pd.DataFrame:
    """Per-security shares, debt, cash, EBITDA and the ROIC-pool flag.

    Recomputed from xbrl_facts at each security's latest snapshot using the
    Phase 5 helpers (same hygiene, same debt composition, same anchoring).
    as_of restricts to facts filed by that date so the snapshot anchors at the
    latest filing then known — point-in-time for the backtester; None = newest.
    """
    cur.execute(
        """
        SELECT security_id, concept, normalized_concept, unit, value,
               period_start, period_end, fiscal_period, filed_date
        FROM xbrl_facts
        WHERE normalized_concept = ANY(%s)
          AND (%s::date IS NULL OR filed_date <= %s)
        """,
        (list(SCORE_TIME_CONCEPTS), as_of, as_of),
    )
    by_sid: dict[int, list[Fact]] = defaultdict(list)
    for row in cur.fetchall():
        f = Fact(*row[1:])
        if fact_is_clean(f):
            by_sid[row[0]].append(f)

    cur.execute(
        """
        SELECT security_id, ex_date, ratio FROM corporate_actions
        WHERE action_type = 'split' AND ratio IS NOT NULL
          AND (%s::date IS NULL OR ex_date <= %s)
        ORDER BY ex_date
        """,
        (as_of, as_of),
    )
    splits_by_sid: dict[int, list] = defaultdict(list)
    for sid, ex, ratio in cur.fetchall():
        splits_by_sid[sid].append((ex, float(ratio)))

    out = {}
    for sid, facts in by_sid.items():
        snap = snapshot(facts, max(f.filed for f in facts))
        oi_ttm, _, _ = ttm(snap, "operating_income")
        da_ttm, _, _ = ttm(snap, "depreciation_amortization")
        if da_ttm is None:
            # No combined D&A line — reconstruct from separately-tagged components
            # (Depreciation + intangible amortization), as MSFT/GOOGL/TSLA/AVGO/etc.
            # report them. Components are summed only when the combined tag is
            # absent, so a filer that reports both is never double-counted.
            dep_ttm, _, _ = ttm(snap, "depreciation")
            amort_ttm, _, _ = ttm(snap, "amortization")
            if dep_ttm is not None or amort_ttm is not None:
                da_ttm = (dep_ttm or 0.0) + (amort_ttm or 0.0)
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


def run(
    config_version: str = DEFAULT_CONFIG_VERSION,
    write: bool = True,
    log_job: bool = True,
    as_of: date | None = None,
    conn: psycopg.Connection | None = None,
) -> dict:
    """Score the universe under `config_version`.

    config_version selects the factor spec (FACTOR_DEFS_BY_VERSION) and weights
    (score_config). write=False is a dry run: everything is computed and the
    report returned, but factor_scores is NOT written — used to validate a
    config before cutover. log_job=False skips the job_runs bookkeeping.

    as_of (a past date) reconstructs the point-in-time scores known then: the
    score_date becomes the latest price bar on/before as_of, and every loader is
    restricted to data filed/dated by then (no look-ahead). The backtester calls
    run(as_of=T, write=False, log_job=False) across a grid of dates. as_of=None
    is the normal "score today" path.
    """
    factor_defs = FACTOR_DEFS_BY_VERSION.get(config_version)
    if factor_defs is None:
        raise RuntimeError(f"unknown config_version '{config_version}'")
    input_keys = INPUTS_BY_VERSION[config_version]
    momentum_basis = MOMENTUM_BASIS_BY_VERSION[config_version]
    uses_insider = any(
        col == "insider_net_buy" for defs in factor_defs.values() for col, _ in defs
    )

    # A caller (the backtester) may pass a shared connection to thread one
    # connection through all 48 months, slashing pooler churn; otherwise we open
    # our own. The backtester's call (write=False, log_job=False) gets the longer
    # analytical-read timeouts so per-month Python gaps don't trip the idle
    # ceiling and the wide pulls don't trip the statement ceiling. Single
    # transaction stays fast (warm connection) — not autocommit, which routed
    # every statement through the pooler cold and itself caused statement timeouts.
    owns_conn = conn is None
    if owns_conn:
        conn = get_connection(long_read=(not write and not log_job))
    with conn.cursor() as cur:
        weights = _load_weights(cur, config_version)
        if as_of is None:
            cur.execute("SELECT max(date) FROM prices_daily")
        else:
            cur.execute("SELECT max(date) FROM prices_daily WHERE date <= %s", (as_of,))
        score_date = cur.fetchone()[0]
        if score_date is None:
            raise RuntimeError(f"no price data on/before as_of={as_of}")
        cur.execute(
            "SELECT security_id, ticker FROM securities WHERE is_active ORDER BY ticker"
        )
        tickers = dict(cur.fetchall())

    job_id = (
        start_job(
            conn,
            JOB_NAME,
            job_version=JOB_VERSION,
            params={"config_version": config_version, "weights": weights,
                    "write": write},
            data_date=score_date,
        )
        if log_job else None
    )

    try:
        with conn.cursor() as cur:
            metrics = _load_latest_metrics(cur, as_of)
            prices = _load_price_inputs(cur, score_date)
            fundamentals = _load_score_time_fundamentals(cur, as_of)
            insiders = _load_insider_signal(cur, as_of) if uses_insider else pd.DataFrame()

        df = metrics.join(prices, how="outer").join(fundamentals, how="outer")
        if not insiders.empty:
            df = df.join(insiders, how="outer")
        df = df[df.index.isin(tickers)]
        df["ticker"] = df.index.map(tickers)

        # Data-integrity: drop sub-$1 names so untradeable penny stocks (and their
        # unadjusted-split price errors) can't pollute the percentile ranks, and so
        # the live universe matches the >=$1 universe the backtest validates. close
        # is NaN for names with no recent price -> NaN < MIN_PRICE is False, so only
        # known sub-$1 names are removed; the rest are scored as before.
        if "close" in df.columns:
            df = df[~(df["close"] < MIN_PRICE)]

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

        # Discretionary insider net-buy, scaled by market cap so a $1M buy at a
        # $1B name outweighs the same dollars at a $1T name. Only names with a
        # discretionary open-market transaction carry a value (the loader's
        # join leaves the rest NaN -> unranked).
        if "insider_net_value" in df.columns:
            df["insider_net_buy"] = df.apply(
                lambda r: r["insider_net_value"] / r["mktcap"]
                if pd.notna(r.get("insider_net_value"))
                and pd.notna(r.get("mktcap")) and r["mktcap"] > 0
                else float("nan"),
                axis=1,
            )

        # --- sub-metric percentiles ---
        sub_pctls: dict[str, pd.Series] = {}
        for _factor, defs in factor_defs.items():
            for col, direction in defs:
                if col == "roic":
                    sub_pctls[col] = _roic_percentiles(df)
                elif col in df.columns:
                    sub_pctls[col] = _pctl(df[col], direction)
                else:
                    sub_pctls[col] = pd.Series(index=df.index, dtype=float)

        # --- factor percentiles: mean of available sub-percentiles ---
        factor_pctls: dict[str, pd.Series] = {}
        for factor, defs in factor_defs.items():
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
                    for c in input_keys
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
                    "momentum_basis": momentum_basis,
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
                    config_version,
                    val(factor_pctls["growth"]),
                    val(factor_pctls["value"]),
                    val(factor_pctls["quality"]),
                    val(factor_pctls["momentum"]),
                    round(float(comp), 4) if pd.notna(comp) else None,
                    json.dumps(details),
                )
            )

        if write:
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
        if log_job:
            finish_job(
                conn, job_id,
                status="success" if write else "dry_run",
                rows_affected=len(rows) if write else 0,
            )

        # --- sanity report data ---
        report = df[["ticker"]].copy()
        for f in factor_defs:
            report[f] = factor_pctls[f]
        report["composite"] = composite
        # Phase 0 (per-sub-metric IC attribution): attach each ranked sub-metric's
        # direction-adjusted percentile as a report column, keyed by the same sid
        # index. REPORT-ONLY — the written rows + details.sub_pctls JSON above
        # (the frozen v1/v2 deep-dive contract) are untouched. Sub-metric names
        # never collide with the factor-name columns or 'ticker'/'composite', so
        # the backtest can bucket on any of them exactly like a factor.
        for sub_col, sub_series in sub_pctls.items():
            report[sub_col] = sub_series
        # rows-as-written, keyed by sid, so a dry run can be diffed vs the DB
        report_rows = {r[0]: r for r in rows}

        # On a BORROWED connection, a read-only month leaves an open snapshot;
        # release it so the next borrowed month starts a fresh transaction.
        if not write and not owns_conn:
            conn.rollback()

        return {
            "score_date": str(score_date),
            "config_version": config_version,
            "written": write,
            "rows_written": len(rows) if write else 0,
            "rows_computed": len(rows),
            "scored_with_composite": scored,
            "true_roic_pool": int((~df["roic_is_proxy"].fillna(True).astype(bool)).sum()),
            "roa_proxy_pool": int(df["roic_is_proxy"].fillna(True).astype(bool).sum()),
            "weights": weights,
            "report": report,
            "rows": report_rows,
            "job_id": job_id,
        }
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        if log_job and job_id is not None:
            finish_job(conn, job_id, status="failed", error=str(exc))
        raise
    finally:
        if owns_conn and not conn.closed:
            conn.close()
