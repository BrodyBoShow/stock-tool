"""Portfolio analytics — the serve-time layer behind the Portfolio tab's
diagnostic features: per-holding betas/correlations/sparklines, the aligned
daily-returns matrix that powers the client-side What-If Rebalance Simulator,
and historical stress tests.

HONESTY NOTES
- Our price history starts 2021-06, so the 2022 rate-hike episode is replayed
  from each holding's ACTUAL daily prices. 2008 and 2020 predate the data:
  those presets are β-mapped estimates (holding beta × the episode's documented
  S&P 500 drawdown) and are labeled `method: "beta_mapped"` — an estimate of
  market sensitivity, not a claim about how the specific company would have
  traded.
- Expected returns are shrunk 50% toward an ~8%/yr market prior (same constants
  as the Monte Carlo projection) because trailing means are unreliable.

Everything is computed from prices_daily — no new tables, no external calls.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np

from engine.db import acquire, release
from engine.portfolio import compute_portfolio
from engine.portfolio_projection import MARKET_PRIOR, RETURN_SHRINK, TRADING_DAYS

# Broad funds offered as benchmarks / simulator buy candidates (all have full
# history in prices_daily; validated at build time).
BENCH_CANDIDATES = ["SPY", "QQQ", "VTI", "SCHD", "IWM", "AGG"]

_MIN_PAIR_OBS = 60          # min overlapping daily returns for beta/corr
_AXIS_DAYS = 252            # returns-matrix window (~1 trading year)
_SPARK_SESSIONS = 30

# Stress episodes. `window` episodes are replayed from actual prices in our
# data; `shock` episodes are β-mapped (data predates our history). The S&P
# drawdowns are the documented peak-to-trough closes for each episode.
STRESS_PRESETS = [
    {"key": "gfc2008", "label": "2008 GFC", "sub": "Oct '07 – Mar '09",
     "method": "beta_mapped", "shock": -0.55},
    {"key": "covid2020", "label": "2020 COVID", "sub": "Feb – Mar 2020",
     "method": "beta_mapped", "shock": -0.34},
    {"key": "hikes2022", "label": "2022 Rate Hikes", "sub": "Jan – Oct 2022",
     "method": "replay",
     "start": date(2022, 1, 3), "end": date(2022, 10, 12)},
]


def _resolve_sids(cur, tickers: list[str]) -> dict[str, int]:
    cur.execute(
        "SELECT ticker, security_id FROM securities WHERE ticker = ANY(%s)",
        (tickers,),
    )
    return {r[0]: int(r[1]) for r in cur.fetchall()}


def _load_closes(cur, sids: list[int], since: date) -> dict[int, dict[date, float]]:
    if not sids:
        return {}
    cur.execute(
        """
        SELECT security_id, date, close FROM prices_daily
        WHERE security_id = ANY(%s) AND date >= %s AND close IS NOT NULL
        ORDER BY date
        """,
        (sids, since),
    )
    out: dict[int, dict[date, float]] = {}
    for sid, d, c in cur.fetchall():
        out.setdefault(int(sid), {})[d] = float(c)
    return out


def _pair_stats(a: list[float | None], b: list[float | None],
                want: str) -> float | None:
    """Pairwise-complete beta ('beta' of a vs b) or correlation ('corr')."""
    pairs = [(x, y) for x, y in zip(a, b, strict=False)
             if x is not None and y is not None]
    if len(pairs) < _MIN_PAIR_OBS:
        return None
    ax = np.array([p[0] for p in pairs])
    bx = np.array([p[1] for p in pairs])
    if bx.var() < 1e-12 or ax.var() < 1e-12:
        return None
    if want == "beta":
        return round(float(np.cov(ax, bx)[0][1] / bx.var()), 3)
    return round(float(np.corrcoef(ax, bx)[0][1]), 3)


def _replay_window(cur, sid_by_ticker: dict[str, int],
                   weights: dict[str, float], bench_sid: int,
                   start: date, end: date) -> dict[str, Any] | None:
    """Replay a historical window against CURRENT weights using actual daily
    prices. Weights are renormalized over the holdings that cover the window."""
    sids = [sid_by_ticker[t] for t in weights if t in sid_by_ticker]
    closes = _load_closes(cur, sids + [bench_sid], start - timedelta(days=7))
    trimmed = {sid: {d: c for d, c in s.items() if start <= d <= end}
               for sid, s in closes.items()}

    bench_series = trimmed.get(bench_sid, {})
    if len(bench_series) < 40:
        return None
    axis = sorted(bench_series)

    covered: dict[str, dict[date, float]] = {}
    for tk in weights:
        sid = sid_by_ticker.get(tk)
        s = trimmed.get(sid, {}) if sid else {}
        # require ≥80% of the window's sessions so partial listings don't skew
        if len(s) >= 0.8 * len(axis):
            covered[tk] = s
    if not covered:
        return None
    w_sum = sum(weights[t] for t in covered)
    if w_sum <= 0:
        return None

    # weighted normalized value path over the window
    base = {t: covered[t][min(covered[t])] for t in covered}
    path: list[float] = []
    per_ticker_ret: dict[str, float] = {}
    last_px: dict[str, float] = dict(base)
    for d in axis:
        v = 0.0
        for t, s in covered.items():
            px = s.get(d, last_px[t])
            last_px[t] = px
            v += (weights[t] / w_sum) * (px / base[t])
        path.append(v)
    arr = np.array(path)
    peak = np.maximum.accumulate(arr)
    max_dd = float((arr / peak - 1.0).min())
    for t, s in covered.items():
        d_last = max(s)
        per_ticker_ret[t] = s[d_last] / base[t] - 1.0

    b0 = bench_series[axis[0]]
    bench_arr = np.array([bench_series[d] for d in axis]) / b0
    bench_peak = np.maximum.accumulate(bench_arr)
    bench_dd = float((bench_arr / bench_peak - 1.0).min())

    contributors = sorted(
        ({"ticker": t, "ret": round(r, 4),
          "contrib_pp": round((weights[t] / w_sum) * r * 100, 2)}
         for t, r in per_ticker_ret.items()),
        key=lambda c: c["contrib_pp"])
    return {
        "portfolio_dd": round(max_dd, 4),
        "portfolio_ret": round(float(arr[-1] - 1.0), 4),
        "bench_dd": round(bench_dd, 4),
        "contributors": contributors,
        "coverage": round(w_sum, 4),
        "skipped": sorted(t for t in weights if t not in covered),
    }


def portfolio_analytics(owner_id: str | None = None,
                        benchmark: str = "SPY") -> dict[str, Any]:
    """Diagnostic layer for the Portfolio tab. Serve-time, bounded to the
    user's holdings + the fixed benchmark candidates."""
    benchmark = (benchmark or "SPY").upper().strip()
    port = compute_portfolio(owner_id=owner_id, benchmark=benchmark)
    if not port.get("has_transactions") or not port.get("holdings"):
        return {"has_portfolio": False}

    holdings = [h for h in port["holdings"]
                if h.get("ticker") and h.get("market_value")]
    if not holdings:
        return {"has_portfolio": False}
    weights = {h["ticker"]: (h["weight"] or 0.0) for h in holdings}

    tickers = [h["ticker"] for h in holdings]
    extra = [t for t in BENCH_CANDIDATES if t not in tickers]
    if benchmark not in tickers and benchmark not in extra:
        extra.append(benchmark)
    all_tickers = tickers + extra

    conn = acquire()
    try:
        with conn.cursor() as cur:
            sid_by_ticker = _resolve_sids(cur, all_tickers)
            if benchmark not in sid_by_ticker:
                # unknown ticker → fall back to SPY EVERYWHERE (axis, betas,
                # stress, and the reported benchmark name), mirroring
                # compute_portfolio — otherwise betas/stress silently go null
                # while the payload still claims the requested benchmark
                benchmark = "SPY"
            bench_sid = sid_by_ticker.get(benchmark)
            if bench_sid is None:
                return {"has_portfolio": True, "error": "no benchmark prices"}

            since = date.today() - timedelta(days=550)  # slack over 252 sessions
            closes = _load_closes(
                cur, sorted(set(sid_by_ticker.values())), since)

            # axis = benchmark's last _AXIS_DAYS trading days
            bench_dates = sorted(closes.get(bench_sid, {}))[-(_AXIS_DAYS + 1):]
            if len(bench_dates) < _MIN_PAIR_OBS:
                return {"has_portfolio": True, "error": "insufficient history"}
            axis = bench_dates[1:]

            # aligned simple returns per ticker (None when a date is missing)
            returns: dict[str, list[float | None]] = {}
            sparks: dict[str, list[float]] = {}
            for tk in all_tickers:
                sid = sid_by_ticker.get(tk)
                s = closes.get(sid, {}) if sid else {}
                rets: list[float | None] = []
                for i, d in enumerate(axis):
                    prev_d = bench_dates[i]
                    c0, c1 = s.get(prev_d), s.get(d)
                    rets.append(round(c1 / c0 - 1.0, 6)
                                if c0 and c1 and c0 > 0 else None)
                returns[tk] = rets
                spark_dates = sorted(s)[-_SPARK_SESSIONS:]
                sparks[tk] = [round(s[d], 4) for d in spark_dates]

            bench_rets = returns.get(benchmark, [])
            betas = {tk: _pair_stats(returns[tk], bench_rets, "beta")
                     for tk in tickers}

            corr: list[list[float | None]] = []
            for a in tickers:
                row: list[float | None] = []
                for b in tickers:
                    row.append(1.0 if a == b
                               else _pair_stats(returns[a], returns[b], "corr"))
                corr.append(row)

            # shrunk expected return + trailing vol per ticker (simulator inputs)
            expected: dict[str, dict[str, float | None]] = {}
            for tk in all_tickers:
                obs = [r for r in returns[tk] if r is not None]
                if len(obs) < _MIN_PAIR_OBS:
                    expected[tk] = {"exp_return": None, "vol": None}
                    continue
                arr = np.array(obs)
                mu_trail = float(arr.mean()) * TRADING_DAYS
                expected[tk] = {
                    "exp_return": round((1 - RETURN_SHRINK) * mu_trail
                                        + RETURN_SHRINK * MARKET_PRIOR, 4),
                    "vol": round(float(arr.std()) * float(np.sqrt(TRADING_DAYS)), 4),
                }

            last_close = {}
            for tk in all_tickers:
                sid = sid_by_ticker.get(tk)
                s = closes.get(sid, {}) if sid else {}
                last_close[tk] = round(s[max(s)], 4) if s else None

            # stress presets
            stress: list[dict[str, Any]] = []
            for preset in STRESS_PRESETS:
                item: dict[str, Any] = {k: preset[k] for k in
                                        ("key", "label", "sub", "method")}
                if preset["method"] == "replay":
                    res = _replay_window(cur, sid_by_ticker, weights,
                                         bench_sid, preset["start"], preset["end"])
                    if res is None:
                        continue
                    item.update(res)
                    item["note"] = ("Replayed from your holdings' actual daily "
                                    "prices over this window, at current weights.")
                else:
                    shock = preset["shock"]
                    # renormalize over beta-covered weight (same convention as
                    # the replay path) — otherwise beta-less holdings act like
                    # cash and understate the estimated drawdown
                    covered_w = sum(weights[tk] for tk in tickers
                                    if betas.get(tk) is not None)
                    if covered_w <= 0:
                        continue
                    contribs = []
                    port_est = 0.0
                    for tk in tickers:
                        b = betas.get(tk)
                        if b is None:
                            continue
                        est = max(b * shock, -0.95)
                        wn = weights[tk] / covered_w
                        port_est += wn * est
                        contribs.append({"ticker": tk, "ret": round(est, 4),
                                         "contrib_pp": round(wn * est * 100, 2)})
                    contribs.sort(key=lambda c: c["contrib_pp"])
                    item.update({
                        "portfolio_dd": round(port_est, 4),
                        "bench_dd": shock,
                        "contributors": contribs,
                        "coverage": round(covered_w, 4),
                        "skipped": sorted(tk for tk in tickers
                                          if betas.get(tk) is None),
                        "note": ("β-mapped estimate: each holding's trailing-1Y "
                                 "beta × the episode's documented S&P 500 "
                                 "drawdown. Our price data starts 2021 — this is "
                                 "a sensitivity estimate, not a replay."),
                    })
                stress.append(item)
    finally:
        release(conn)

    return {
        "has_portfolio": True,
        "as_of": str(axis[-1]),
        "benchmark": benchmark,
        "tickers": tickers,
        "candidates": [t for t in BENCH_CANDIDATES if t in sid_by_ticker],
        "axis_dates": [str(d) for d in axis],
        "returns": returns,
        "betas": betas,
        "corr": corr,
        "sparks": sparks,
        "expected": expected,
        "last_close": last_close,
        "stress": stress,
    }
