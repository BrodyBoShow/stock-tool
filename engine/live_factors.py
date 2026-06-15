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

import pandas as pd

from engine.queries import ACTIVE_CONFIG_VERSION, acquire, release

# How long a built snapshot is reused before we re-check the score_date. The
# cross-section only changes on a nightly run, so this just bounds how quickly a
# fresh nightly is picked up; in between, every live_adjust call is pure CPU
# (no DB round-trip), which keeps the screener batch path cheap.
_SNAPSHOT_TTL_SECONDS = 600

# (sub-metric -> rank direction) mirroring engine.scoring.FACTOR_DEFS_V2 exactly,
# so a percentile computed here matches one the nightly run would produce.
_DIRECTION = {
    "pe": "lower",
    "ps": "lower",
    "fcf_yield": "higher",
    "ev_ebitda": "lower",
    "r3m": "higher",
    "r6m": "higher",
    "r12_1m": "higher",
}

# Price-driven sub-metrics we recompute from the live price, by factor. The
# remaining sub-metrics in each factor are held at their nightly percentile.
_VALUE_LIVE = ("pe", "ps", "fcf_yield")   # ev_ebitda held nightly
_VALUE_ALL = ("pe", "ps", "ev_ebitda", "fcf_yield")
_MOMENTUM_LIVE = ("r3m", "r6m")           # r12_1m held nightly
_MOMENTUM_ALL = ("r3m", "r6m", "r12_1m")

# Raw nightly inputs needed to rebuild the distributions + per-name scaling.
_DIST_INPUTS = ("pe", "ps", "fcf_yield", "r3m", "r6m")


class _Snapshot:
    """The frozen nightly cross-section for one score_date."""

    def __init__(self, score_date: str, dist: pd.DataFrame, meta: dict[int, dict],
                 weights: dict[str, float]):
        self.score_date = score_date
        self.dist = dist            # index=security_id, cols=_DIST_INPUTS (raw values)
        self.meta = meta            # security_id -> per-name nightly fields
        self.weights = weights


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
                SELECT fs.security_id, fs.growth_pctl, fs.value_pctl,
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
    weights: dict[str, float] = {}
    for sid, g, v, q, m, comp, details in rows:
        d = _coerce_details(details)
        inputs = d.get("inputs") or {}
        sub = d.get("sub_pctls") or {}
        if not weights and d.get("weights"):
            weights = {k: float(x) for k, x in d["weights"].items()}
        dist_rows[sid] = {k: inputs.get(k) for k in _DIST_INPUTS}
        meta[sid] = {
            "close": inputs.get("close"),
            "ev_ebitda_pctl": sub.get("ev_ebitda"),
            "r12_1m_pctl": sub.get("r12_1m"),
            "growth_pctl": float(g) if g is not None else None,
            "value_pctl": float(v) if v is not None else None,
            "quality_pctl": float(q) if q is not None else None,
            "momentum_pctl": float(m) if m is not None else None,
            "composite": float(comp) if comp is not None else None,
        }

    dist = pd.DataFrame.from_dict(dist_rows, orient="index", columns=list(_DIST_INPUTS))
    dist = dist.apply(pd.to_numeric, errors="coerce")
    snap = _Snapshot(str(latest), dist, meta, weights)
    with _lock:
        _cache["snap"] = snap
        _cache["checked_monotonic"] = time.monotonic()
    return snap


def _pctl_of(series: pd.Series, sid: int, value: float, direction: str) -> float:
    """Percentile (0-100) of `value` placed at `sid` in the frozen distribution.

    Replicates engine.scoring._pctl exactly: rank among non-null holders, average
    method, higher=better unless direction='lower'. Replacing the focal name's
    own nightly value means that at the close (value == nightly) this reproduces
    the stored sub-percentile.
    """
    s = series.dropna().copy()
    s.loc[sid] = value
    ranks = s.rank(ascending=(direction == "higher"), pct=True, method="average") * 100.0
    return float(ranks.loc[sid])


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
        if metric in ("pe", "ps"):
            return float(nv) * ratio              # price in numerator
        if metric == "fcf_yield":
            return float(nv) / ratio              # price in denominator
        if metric in ("r3m", "r6m"):
            return (1.0 + float(nv)) * ratio - 1.0  # window ends on today's price
        return float(nv)

    # Value: live pe/ps/fcf_yield vs frozen distribution + nightly ev_ebitda pctl.
    value_subs: list[float | None] = []
    for metric in _VALUE_LIVE:
        lv = live_raw(metric)
        if lv is not None:
            value_subs.append(_pctl_of(snap.dist[metric], security_id, lv, _DIRECTION[metric]))
        else:
            value_subs.append(None)
    value_subs.append(m["ev_ebitda_pctl"])  # held nightly
    value_live = _mean_available(value_subs)
    if value_live is None:
        value_live = nightly["value"]

    # Momentum: live r3m/r6m vs frozen distribution + nightly r12_1m pctl.
    mom_subs: list[float | None] = []
    for metric in _MOMENTUM_LIVE:
        lv = live_raw(metric)
        if lv is not None:
            mom_subs.append(_pctl_of(snap.dist[metric], security_id, lv, _DIRECTION[metric]))
        else:
            mom_subs.append(None)
    mom_subs.append(m["r12_1m_pctl"])  # held nightly
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


def live_adjust_many(price_by_sid: dict[int, float | None]) -> dict[int, dict[str, Any]]:
    """Batch live_adjust for the screener overlay. Skips names not in the
    snapshot. Cheap: the snapshot/distribution is built once and reused."""
    out: dict[int, dict[str, Any]] = {}
    for sid, price in price_by_sid.items():
        res = live_adjust(sid, price)
        if res is not None:
            out[sid] = res
    return out
