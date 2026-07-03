"""Universal per-company forward sensitivity (forward-context layer, Slice 2b).

Every company gets a forward-looking read, not just oil & gas producers. A
firm's own forward earnings aren't available for free (analyst estimates are
paid / personal-use-only), so universality comes from mapping each SECTOR to its
dominant FREE forward driver — reusing the market forward-regime (yield curve,
credit spreads, inflation expectations) plus the 10-year Treasury level. Each
driver carries a factual note on WHY it matters for that sector and its current
level + ~1-month direction.

CONTEXT ONLY — never feeds factor scores. Honest about limits: sectors whose
macro link is diffuse (e.g. Health Care) get an explicit "no single driver"
note rather than a fabricated one, and energy PRODUCERS are handled separately
by the commodity backdrop (their dominant driver is the commodity price itself).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from engine.db import acquire, release
from engine.market import _dir, _forward_regime, _value_ago

# Sector -> ordered dominant forward driver keys.
#   curve   = yield-curve slope (10y-2y)   credit  = HY credit spread (OAS)
#   inflation = 10y breakeven              rate10y = 10-year Treasury level
# Empty list = diffuse (no single dominant free driver) → honest note, no fabrication.
SECTOR_DRIVERS: dict[str, list[str]] = {
    "Financials": ["curve", "credit"],
    "Industrials": ["curve", "credit"],
    "Real Estate": ["rate10y"],
    "Utilities": ["rate10y"],
    "Information Technology": ["rate10y"],
    "Communication Services": ["rate10y"],
    "Consumer Discretionary": ["rate10y", "credit"],
    "Consumer Staples": ["inflation"],
    "Materials": ["inflation"],
    "Health Care": [],
    "Energy": [],  # producers → commodity backdrop; refiners/midstream are diffuse here
}

# (sector, driver) -> factual note on why this driver matters for the sector.
_NOTES: dict[tuple[str, str], str] = {
    ("Financials", "curve"): (
        "Banks earn the spread between long and short rates, so a steeper curve tends "
        "to widen net interest margins; a flat or inverted curve compresses them."
    ),
    ("Financials", "credit"): (
        "Widening credit spreads raise funding costs and signal rising default risk "
        "across lending books."
    ),
    ("Industrials", "curve"): (
        "The yield curve is a classic cycle gauge — flattening/inversion has "
        "historically preceded slowdowns in cyclical demand."
    ),
    ("Industrials", "credit"): (
        "Wider spreads tighten financing for capex-heavy customers and the sector itself."
    ),
    ("Real Estate", "rate10y"): (
        "REIT valuations and financing costs are highly sensitive to long rates; "
        "rising 10-year yields pressure both."
    ),
    ("Utilities", "rate10y"): (
        "Utilities trade as bond proxies for their steady dividends, so they tend to "
        "weaken as long rates rise and firm as they fall."
    ),
    ("Information Technology", "rate10y"): (
        "High-multiple, long-duration growth is most sensitive to the discount rate; "
        "rising 10-year yields compress valuations."
    ),
    ("Communication Services", "rate10y"): (
        "Long-duration growth names here are discounted by long rates; rising yields "
        "pressure valuations."
    ),
    ("Consumer Discretionary", "rate10y"): (
        "Long rates set mortgage and big-ticket financing costs; higher 10-year yields "
        "lift the cost of housing-linked and financed discretionary purchases, weighing "
        "on demand."
    ),
    ("Consumer Discretionary", "credit"): (
        "Wider spreads and tighter credit curb the borrowing that funds discretionary "
        "spending."
    ),
    ("Consumer Staples", "inflation"): (
        "Staples' margins hinge on input-cost inflation versus their pricing power; "
        "rising expectations pressure margins."
    ),
    ("Materials", "inflation"): (
        "Materials prices track inflation and commodity cycles; StockBud doesn't yet "
        "carry a free metals-price forecast, so inflation expectations are the "
        "available forward proxy."
    ),
}

_DIFFUSE_NOTE = (
    "No single free forward-macro driver cleanly dominates this sector, so we don't "
    "assert one. The market-wide forward regime (Market tab) is the most relevant "
    "backdrop."
)


def _load(cur) -> tuple[dict[str, list[tuple[date, float]]], dict[str, float]]:
    ids = ["DGS10", "DGS2", "BAMLH0A0HYM2", "T10YIE"]
    cur.execute(
        "SELECT series_id, date, value FROM macro_series "
        "WHERE series_id = ANY(%s) AND date >= %s AND value IS NOT NULL "
        "ORDER BY series_id, date",
        (ids, date.today() - timedelta(days=420)),
    )
    series: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for sid, d, v in cur.fetchall():
        series[sid].append((d, float(v)))
    latest = {sid: obs[-1][1] for sid, obs in series.items() if obs}
    return series, latest


def _rate10y(series: dict[str, list[tuple[date, float]]],
             latest: dict[str, float]) -> dict[str, Any] | None:
    """10-year Treasury level + ~1-month direction. No level bucket (a single
    rate has no clean 'stress' threshold) — we show the level and its move."""
    if "DGS10" not in latest:
        return None
    val = round(latest["DGS10"], 2)
    prior = _value_ago(series.get("DGS10", []), 30)
    delta = round(val - prior, 2) if prior is not None else None
    return {
        "driver": "rate10y", "label": "10-year Treasury yield",
        "value": val, "unit": "%", "bucket": None, "delta": delta,
        "direction": _dir(delta, 0.05, "rising", "falling"), "stress": False,
    }


def for_security(sector: str | None, industry: str | None) -> dict[str, Any] | None:
    """Forward sensitivity for one security: its sector's dominant free forward
    driver(s) with current level + direction + a factual relationship note, or
    a diffuse-sector note. None for an unknown sector (we omit rather than guess).
    """
    drivers = SECTOR_DRIVERS.get(sector or "")
    if drivers is None:
        return None

    conn = acquire()
    try:
        with conn.cursor() as cur:
            series, latest = _load(cur)
    finally:
        release(conn)

    regime = _forward_regime(series, latest) or {"dims": []}
    dim_by = {d["key"]: d for d in regime["dims"]}
    rate = _rate10y(series, latest)

    out: list[dict[str, Any]] = []
    for key in drivers:
        d = rate if key == "rate10y" else dim_by.get(key)
        if d is None:
            continue
        # Regime dims key off "key"; rate10y off "driver" — normalize to "driver".
        out.append({
            "driver": key,
            "label": d["label"],
            "value": d["value"],
            "unit": d["unit"],
            "bucket": d.get("bucket"),
            "delta": d.get("delta"),
            "direction": d["direction"],
            "stress": d.get("stress", False),
            "note": _NOTES.get((sector or "", key), ""),
        })

    return {
        "sector": sector,
        "drivers": out,
        "diffuse_note": _DIFFUSE_NOTE if not out else None,
    }
