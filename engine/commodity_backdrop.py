"""Forward commodity backdrop — CONTEXT ONLY (forward-context layer, Slice 1).

Maps an oil & gas PRODUCER to the forward EIA STEO price paths for the
commodities it sells and reports whether they're forecast to rise or fall. This
never changes a factor score; it is a caveat surfaced next to the (honest,
backward-looking) valuation so a user can see when trailing cheapness — low
EV/EBITDA, high FCF yield computed on realized high-price earnings — may be
flattered by a commodity price forecast to decline. It is the direct answer to
"why does APA rank so cheap when oil is forecast to fall?": the score can't see
the forward curve; this flag can.

Scope + honesty:
  * Only upstream oil & gas PRODUCERS get a backdrop — their P&L is directly a
    function of the commodity price. Refiners (crack spreads, often inverse to
    crude), midstream/pipelines & distributors (toll/regulated), and drillers/
    field services (indirect) are NOT flagged — the link is ambiguous and we do
    not fabricate a signal.
  * We can't tell a name's OIL vs GAS weighting from its SIC industry alone
    ("Crude Petroleum & Natural Gas" holds oil-heavy APA and gas-pure EQT
    alike), so producers get BOTH the oil (WTI) and gas (Henry Hub) backdrops
    and the user applies whichever matches the company's mix. We never assert a
    single commodity drives a specific name.
  * The near anchor is the STEO's near-term month, labeled "near-term" — NOT a
    realized spot (the EIA value endpoint doesn't flag actual vs forecast).
  * Vintage is the retrieval month, surfaced as "retrieved", not a claimed STEO
    edition.

Metals/materials names are a future slice (EIA STEO is energy-only). Data
source: EIA Short-Term Energy Outlook via commodity_forecasts (see
scripts/ingest_commodity_forecasts.py).
"""
from __future__ import annotations

import threading
import time
from datetime import UTC, datetime
from typing import Any

from engine.db import acquire, release

# EIA STEO series metadata (label/unit for display).
SERIES_META: dict[str, dict[str, str]] = {
    "WTIPUUS": {"commodity": "oil", "label": "WTI crude", "unit": "$/bbl"},
    "BREPUUS": {"commodity": "oil", "label": "Brent crude", "unit": "$/bbl"},
    "NGHHMCF": {"commodity": "natural gas", "label": "Henry Hub gas", "unit": "$/MMBtu"},
}

# The commodity paths an upstream producer sells — shown together so the user can
# apply whichever matches the company's oil/gas weighting.
_PRODUCER_SERIES = ("WTIPUUS", "NGHHMCF")

# Exact SIC-derived industry labels for upstream oil & gas producers whose
# trailing valuation is directly driven by commodity prices. (Verified against
# the live securities table's Energy-sector industry values.)
_PRODUCER_INDUSTRIES = frozenset({
    "Crude Petroleum & Natural Gas",
    "Oil & Gas Exploration & Production",
    "Integrated Oil & Gas",
})

# Forward-slope thresholds: below/above these we call the backdrop declining /
# rising; in between it's roughly flat and no caveat is warranted.
_DECLINE_THRESHOLD = -0.10
_RISE_THRESHOLD = 0.10


def is_producer(sector: str | None, industry: str | None) -> bool:
    """True when the name is an upstream oil & gas producer we flag (else we
    deliberately don't, to avoid a misleading/indirect signal)."""
    return (sector or "") == "Energy" and (industry or "") in _PRODUCER_INDUSTRIES


def _classify(slope: float | None) -> str:
    if slope is None:
        return "unknown"
    if slope <= _DECLINE_THRESHOLD:
        return "declining"
    if slope >= _RISE_THRESHOLD:
        return "rising"
    return "flat"


def backdrop(series_id: str) -> dict[str, Any] | None:
    """The newest-vintage forward path for one series, summarized: the near-term
    STEO level, the furthest-out forecast, the slope between them, a direction
    label, and the compact path for a sparkline. None if we have no stored
    forecast yet (e.g. before the first ingest)."""
    meta = SERIES_META.get(series_id)
    if meta is None:
        return None

    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT max(vintage) FROM commodity_forecasts WHERE series_id = %s",
                (series_id,),
            )
            row = cur.fetchone()
            vintage = row[0] if row else None
            if vintage is None:
                return None
            cur.execute(
                "SELECT period, value, is_forecast FROM commodity_forecasts "
                "WHERE series_id = %s AND vintage = %s ORDER BY period",
                (series_id, vintage),
            )
            path = [(p, float(v), bool(f)) for p, v, f in cur.fetchall()]
    finally:
        release(conn)

    if not path:
        return None

    # Near anchor = the STEO's near-term month (latest period on/before today).
    # We label it "near-term", NOT a realized spot: the EIA value endpoint gives
    # no actual/forecast flag, so we don't claim the point is realized. Fall
    # back to the first point if the whole path is in the future.
    today = datetime.now(UTC).date()
    near_pts = [(p, v) for p, v, _ in path if p <= today]
    near_period, near_value = near_pts[-1] if near_pts else (path[0][0], path[0][1])
    fwd_period, fwd_value = path[-1][0], path[-1][1]

    slope = (fwd_value - near_value) / near_value if near_value else None
    return {
        "series_id": series_id,
        "commodity": meta["commodity"],
        "label": meta["label"],
        "unit": meta["unit"],
        "vintage": vintage.isoformat(),
        "near_price": round(near_value, 2),
        "near_period": near_period.isoformat(),
        "forward_price": round(fwd_value, 2),
        "forward_period": fwd_period.isoformat(),
        "slope_pct": round(slope * 100, 1) if slope is not None else None,
        "direction": _classify(slope),
        "path": [
            {"period": p.isoformat(), "value": round(v, 2), "is_forecast": f}
            for p, v, f in path
        ],
    }


# The oil+gas backdrops are the same for every producer, so compute them once
# and reuse for a short TTL — they only change on the nightly EIA ingest. This
# keeps the screener hot path (a producer marker per row) off the DB.
_PB_TTL_SECONDS = 600.0
_pb_lock = threading.Lock()
_pb_cache: dict[str, Any] = {"at": 0.0, "val": None}


def producer_backdrops() -> list[dict[str, Any]] | None:
    """The oil (WTI) + gas (Henry Hub) forward paths an upstream producer sells,
    computed once and cached for a short TTL. None before the first ingest.
    Shared by the deep-dive card and the screener producer marker."""
    now = time.monotonic()
    cached = _pb_cache["val"]
    if cached is not None and (now - _pb_cache["at"]) < _PB_TTL_SECONDS:
        return cached
    out = [b for sid in _PRODUCER_SERIES if (b := backdrop(sid)) is not None]
    val = out or None
    with _pb_lock:
        _pb_cache["val"] = val
        _pb_cache["at"] = now
    return val


def for_security(sector: str | None, industry: str | None) -> list[dict[str, Any]] | None:
    """Forward commodity backdrops for one security — the oil and gas paths for
    upstream producers, else None. Returns None (not []) for non-producers and
    when no forecast data exists yet, so the UI simply omits the card."""
    return producer_backdrops() if is_producer(sector, industry) else None
