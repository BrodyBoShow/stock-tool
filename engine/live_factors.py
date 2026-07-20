"""Phase 16 — Live-adjusted factor scores (intraday overlay).

The nightly factor pipeline ranks on *closing* prices and rolls over once per
night (engine.scoring). Intraday, a user watching the screener wants the
price-driven factors to reflect *today's* move, not last night's close — without
the cost or fragility of refetching live prices for the whole ~5.5k universe.

This module provides that overlay, and ONLY for the price-driven sub-signals:

  • Value:    pe, ps, fcf_yield  (recomputed exactly from the stored nightly
              denominators + the live price). ev_ebitda is held at its nightly
              percentile — its debt/cash terms dampen the price effect and the
              raw inputs needed to recompute it exactly aren't stored yet.
  • Momentum: r3m, r6m  (their windows end on the latest price, so they move
              with it). r12_1m is the 12-minus-1 signal — both endpoints are
              lagged prices, so today's move does NOT affect it; held nightly.
  • Growth / Quality: held nightly. They only change when a new 10-Q/10-K is
              filed, so an intraday price move is irrelevant to them.

Method — frozen-distribution percentile. The cross-section (where all ~4.5k
names sit on each sub-metric) is taken from LAST NIGHT'S scores and held fixed;
we recompute only the focal name's raw sub-metric from its live price, then find
where that single value ranks in the frozen distribution. This is exact at the
close (live price == nightly close reproduces the stored percentile — see
scripts/verify_live_factors.py) and a tight approximation intraday on a normal
day. Its one honest limitation: it compares today's value against yesterday's
cross-section, so on a broad market-wide move the distribution drifts slightly.
The API/UI label these values "live (est.)" rather than claiming a true
intraday re-rank.

CONTEXT/DISPLAY ONLY: this never writes factor_scores or any pipeline table. It
reads the nightly snapshot and overlays a computed view on top.
"""
from __future__ import annotations

import json
import threading
import time
from typing import Any

import numpy as np
import pandas as pd

from engine import quotes as quotes_engine
from engine.queries import ACTIVE_CONFIG_VERSION, acquire, release, top_quote_tickers

# How long a built snapshot is reused before we re-check the score_date. The
# cross-section only changes on a nightly run, so this just bounds how quickly a
# fresh nightly is picked up; in between, every live_adjust call is pure CPU
# (no DB round-trip), which keeps the screener batch path cheap.
_SNAPSHOT_TTL_SECONDS = 600

# (sub-metric -> rank direction) mirroring engine.scoring.FACTOR_DEFS_V6_TREND
# exactly, so a percentile computed here matches one the nightly run would
# produce. MUST be kept in lock-step with the ACTIVE_CONFIG_VERSION's factor
# spec: the original version of this map mirrored V2 and kept live-adjusting
# `pe` (dropped from Value at v4) and `r3m`/`r6m` (dropped from Momentum at
# v4/v6) long after they left the factors — so the "live" score drifted from
# the nightly for reasons that weren't price moves (caught 2026-07-20).
_DIRECTION = {
    "ps": "lower",
    "fcf_yield": "higher",
    "prox_52w": "higher",
}

# Price-driven sub-metrics we recompute from the live price, by factor (v6):
#   Value    = ps + fcf_yield live; ev_ebitda held at its nightly percentile.
#   Momentum = prox_52w live (live/hi52 == min(1, nightly_prox x ratio), exact
#              because a price above the trailing high IS the new high);
#              r12_1m held (its window SKIPS the last month, so the live price
#              is outside it by construction) and pos_days held (a daily
#              up-day fraction; one intraday move doesn't change it).
_VALUE_LIVE = ("ps", "fcf_yield")
_MOMENTUM_LIVE = ("prox_52w",)

# Raw nightly inputs needed to rebuild the distributions + per-name scaling.
_DIST_INPUTS = ("ps", "fcf_yield", "prox_52w")


class _Snapshot:
    """The frozen nightly cross-section for one score_date.

    `sorted_vals` holds each sub-metric's nightly values pre-sorted ascending,
    so a live percentile is an O(log n) searchsorted instead of an O(n log n)
    re-rank — what makes the 300-name screener overlay cheap.
    """

    def __init__(self, score_date: str, dist: pd.DataFrame, meta: dict[int, dict],
                 weights: dict[str, float], by_ticker: dict[str, int]):
        self.score_date = score_date
        self.dist = dist            # index=security_id, cols=_DIST_INPUTS (raw values)
        self.meta = meta            # security_id -> per-name nightly fields
        self.weights = weights
        self.by_ticker = by_ticker  # ticker -> security_id (for the screener overlay)
        self.sorted_vals: dict[str, np.ndarray] = {
            col: np.sort(dist[col].dropna().to_numpy(dtype=float))
            for col in _DIST_INPUTS
        }


_lock = threading.Lock()
_cache: dict[str, Any] = {"snap": None, "checked_monotonic": 0.0}


def _coerce_details(d: Any) -> dict:
    if isinstance(d, dict):
        return d
    if isinstance(d, str) and d:
        try:
            return json.loads(d)
        except json.JSONDecodeError:
            return {}
    return {}


def _load_snapshot() -> _Snapshot | None:
    """Build (or return cached) the frozen nightly cross-section.

    One query over the latest score_date's active, scored names. Cached in
    process and reused for a TTL (then we cheaply re-check the score_date and
    only rebuild if a nightly run has advanced it), so the distribution is
    assembled at most once per scoring snapshot and most calls never touch the DB.
    """
    snap = _cache.get("snap")
    if snap is not None:
        if (time.monotonic() - _cache["checked_monotonic"]) < _SNAPSHOT_TTL_SECONDS:
            return snap

    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT max(score_date) FROM factor_scores WHERE config_version = %s",
                (ACTIVE_CONFIG_VERSION,),
            )
            latest = cur.fetchone()[0]
            if latest is None:
                return None
            if snap is not None and snap.score_date == str(latest):
                with _lock:
                    _cache["checked_monotonic"] = time.monotonic()
                return snap
            cur.execute(
                """
                SELECT fs.security_id, s.ticker, fs.growth_pctl, fs.value_pctl,
                       fs.quality_pctl, fs.momentum_pctl, fs.composite, fs.details
                FROM factor_scores fs
                JOIN securities s ON s.security_id = fs.security_id
                WHERE s.is_active AND fs.config_version = %s AND fs.score_date = %s
                """,
                (ACTIVE_CONFIG_VERSION, latest),
            )
            rows = cur.fetchall()
    finally:
        release(conn)

    dist_rows: dict[int, dict[str, float]] = {}
    meta: dict[int, dict] = {}
    by_ticker: dict[str, int] = {}
    weights: dict[str, float] = {}
    for sid, ticker, g, v, q, m, comp, details in rows:
        d = _coerce_details(details)
        inputs = d.get("inputs") or {}
        sub = d.get("sub_pctls") or {}
        if not weights and d.get("weights"):
            weights = {k: float(x) for k, x in d["weights"].items()}
        by_ticker[ticker] = sid
        dist_rows[sid] = {k: inputs.get(k) for k in _DIST_INPUTS}
        meta[sid] = {
            "close": inputs.get("close"),
            "ev_ebitda_pctl": sub.get("ev_ebitda"),
            "r12_1m_pctl": sub.get("r12_1m"),
            "pos_days_pctl": sub.get("pos_days"),
            "growth_pctl": float(g) if g is not None else None,
            "value_pctl": float(v) if v is not None else None,
            "quality_pctl": float(q) if q is not None else None,
            "momentum_pctl": float(m) if m is not None else None,
            "composite": float(comp) if comp is not None else None,
        }

    dist = pd.DataFrame.from_dict(dist_rows, orient="index", columns=list(_DIST_INPUTS))
    dist = dist.apply(pd.to_numeric, errors="coerce")
    snap = _Snapshot(str(latest), dist, meta, weights, by_ticker)
    with _lock:
        _cache["snap"] = snap
        _cache["checked_monotonic"] = time.monotonic()
    return snap


def _pctl_of(sorted_asc: np.ndarray, value: float, direction: str) -> float:
    """Percentile (0-100) of `value` within a pre-sorted nightly distribution.

    Reproduces engine.scoring._pctl's average-rank semantics via searchsorted:
    for a value present in the set, rank = (#below) + (1 + #equal)/2, then
    rank/N*100 (counted from the top when direction='lower'). At the close, the
    focal name's own nightly value is in the array, so this returns exactly its
    stored sub-percentile (see scripts/verify_live_factors.py). Intraday it
    ranks the live value against the frozen cross-section — the focal's stale
    entry is left in the array, a ≤1/N (≈0.02 pctl) effect that's invisible at
    the one-decimal precision shown.
    """
    n = sorted_asc.size
    if n == 0:
        return float("nan")
    lo = int(np.searchsorted(sorted_asc, value, side="left"))   # count strictly below
    hi = int(np.searchsorted(sorted_asc, value, side="right"))  # count <= value
    n_eq = hi - lo
    below = lo if direction == "higher" else n - hi             # "worse" side
    rank = below + (1 + n_eq) / 2.0
    return rank / n * 100.0


def _mean_available(vals: list[float | None]) -> float | None:
    present = [v for v in vals if v is not None]
    return sum(present) / len(present) if present else None


def _composite(factors: dict[str, float | None], weights: dict[str, float]) -> float | None:
    """Weighted composite, weights renormalized over available factors —
    identical to engine.scoring's composite construction."""
    num = 0.0
    den = 0.0
    for f, val in factors.items():
        if val is not None and f in weights:
            num += val * weights[f]
            den += weights[f]
    return num / den if den > 0 else None


def live_adjust(security_id: int, live_price: float | None) -> dict[str, Any] | None:
    """Live-adjusted factor view for one security at `live_price`.

    Returns a dict with both the nightly and live-adjusted Value / Momentum /
    Composite (Growth and Quality are filing-driven, so live == nightly). Returns
    None if the name isn't in the latest scored snapshot. If no live price (or no
    nightly close to scale from) is available, returns nightly values with
    live=False — never raises, so a quote outage can't break the caller.
    """
    snap = _load_snapshot()
    if snap is None or security_id not in snap.meta:
        return None
    m = snap.meta[security_id]
    p0 = m["close"]

    nightly = {
        "growth": m["growth_pctl"],
        "value": m["value_pctl"],
        "quality": m["quality_pctl"],
        "momentum": m["momentum_pctl"],
        "composite": m["composite"],
    }
    base = {
        "security_id": security_id,
        "price": live_price,
        "nightly": nightly,
        "growth": m["growth_pctl"],      # held nightly
        "quality": m["quality_pctl"],    # held nightly
        "value": nightly["value"],
        "momentum": nightly["momentum"],
        "composite": nightly["composite"],
        "live": False,
    }
    if live_price is None or not p0 or p0 <= 0 or live_price <= 0:
        return base

    ratio = live_price / p0
    if ratio == 1.0:
        return base  # at the close: live == nightly by construction

    row = snap.dist.loc[security_id] if security_id in snap.dist.index else None

    def live_raw(metric: str) -> float | None:
        if row is None:
            return None
        nv = row.get(metric)
        if nv is None or pd.isna(nv):
            return None
        if metric == "ps":
            return float(nv) * ratio              # price in numerator
        if metric == "fcf_yield":
            return float(nv) / ratio              # price in denominator
        if metric == "prox_52w":
            # prox = close / trailing-52wk-high. A live price above the trailing
            # high IS the new high, so live prox = live/max(hi52, live) =
            # min(1, nightly_prox x ratio) — exact, not an approximation.
            return min(1.0, float(nv) * ratio)
        return float(nv)

    # Value (v6 = v4's): live ps/fcf_yield vs frozen distribution + nightly
    # ev_ebitda pctl (pe left the factor at v4 — don't blend it back in).
    value_subs: list[float | None] = []
    for metric in _VALUE_LIVE:
        lv = live_raw(metric)
        if lv is not None:
            value_subs.append(_pctl_of(snap.sorted_vals[metric], lv, _DIRECTION[metric]))
        else:
            value_subs.append(None)
    value_subs.append(m["ev_ebitda_pctl"])  # held nightly
    value_live = _mean_available(value_subs)
    if value_live is None:
        value_live = nightly["value"]

    # Momentum (v6): live prox_52w vs frozen distribution + nightly r12_1m and
    # pos_days pctls (r12_1m's window skips the last month; pos_days is a daily
    # up-day fraction — neither is moved by an intraday price).
    mom_subs: list[float | None] = []
    for metric in _MOMENTUM_LIVE:
        lv = live_raw(metric)
        if lv is not None:
            mom_subs.append(_pctl_of(snap.sorted_vals[metric], lv, _DIRECTION[metric]))
        else:
            mom_subs.append(None)
    mom_subs.append(m["r12_1m_pctl"])   # held nightly
    mom_subs.append(m["pos_days_pctl"])  # held nightly
    momentum_live = _mean_available(mom_subs)
    if momentum_live is None:
        momentum_live = nightly["momentum"]

    composite_live = _composite(
        {
            "growth": m["growth_pctl"],
            "value": value_live,
            "quality": m["quality_pctl"],
            "momentum": momentum_live,
        },
        snap.weights,
    )

    base.update(
        value=round(value_live, 2) if value_live is not None else None,
        momentum=round(momentum_live, 2) if momentum_live is not None else None,
        composite=round(composite_live, 4) if composite_live is not None else None,
        live=True,
    )
    return base


def live_adjust_many_by_ticker(
    price_by_ticker: dict[str, float | None],
) -> dict[str, dict[str, Any]]:
    """Batch live_adjust keyed by ticker (the screener has tickers, not sids).
    Only names that both appear in the latest snapshot and got a live
    adjustment (live=True) are returned, so callers can treat presence as
    'has a live value'. ~25ms for the ~300-name quoted set."""
    snap = _load_snapshot()
    if snap is None:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for ticker, price in price_by_ticker.items():
        sid = snap.by_ticker.get(ticker)
        if sid is None:
            continue
        res = live_adjust(sid, price)
        if res is not None and res["live"]:
            out[ticker] = res
    return out


def live_universe_rank(ticker: str, owner_id: str | None = None) -> dict[str, Any] | None:
    """One ticker's rank under the SAME method the screener's # column uses:
    the complete-factor active universe (matching queries.screener_rows'
    complete_only basis), with live-adjusted composite substituted for the
    bounded top_quote_tickers set (the same overlay /quotes applies) wherever
    a live price landed. Every other name keeps its nightly composite — an
    exact re-derivation of what a user sorted-by-composite on the screener
    would see for this ticker right now.

    Returns {"rank": int, "total": int, "live": bool} (live=True only if
    THIS ticker itself got a live-adjusted composite), or None if the ticker
    isn't in the complete-factor universe today (partial name, unscored, or
    inactive).

    Reuses live_factors' own 600s-cached snapshot (no extra DB round trip
    beyond what's already paid for elsewhere) and quotes' 90s TTL cache for
    the bounded set (the exact ticker set /quotes fetches) — so repeated
    deep-dive opens are cheap and never re-hit yfinance within the TTL.
    """
    snap = _load_snapshot()
    if snap is None:
        return None
    sid = snap.by_ticker.get(ticker)
    if sid is None:
        return None

    # Same population the screener ranks over: active names with all four
    # component factors present (screener_rows(complete_only=True)).
    complete = {
        s: m["composite"]
        for s, m in snap.meta.items()
        if m["growth_pctl"] is not None
        and m["value_pctl"] is not None
        and m["quality_pctl"] is not None
        and m["momentum_pctl"] is not None
        and m["composite"] is not None
    }
    if sid not in complete:
        return None

    bounded = top_quote_tickers(owner_id=owner_id)
    quote_payload = quotes_engine.get_quotes(bounded)
    price_by_ticker = {t: q.get("price") for t, q in quote_payload["quotes"].items()}
    overlay = live_adjust_many_by_ticker(price_by_ticker)
    for t, adj in overlay.items():
        s2 = snap.by_ticker.get(t)
        if s2 in complete and adj.get("composite") is not None:
            complete[s2] = adj["composite"]

    ordered = sorted(complete.items(), key=lambda kv: kv[1], reverse=True)
    rank = next((i + 1 for i, (s, _) in enumerate(ordered) if s == sid), None)
    if rank is None:
        return None
    return {"rank": rank, "total": len(ordered), "live": ticker in overlay}
