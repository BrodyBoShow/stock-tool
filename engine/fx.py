"""FX rates (USD conversion) — CONTEXT for the valuation engine.

Free daily USD exchange rates from FRED (ingested into macro_series by
scripts/ingest_macro.py). Lets the intrinsic-value engine convert a foreign
filer's reporting-currency financials into USD so the USD-priced multiples/DCF
are apples-to-apples, instead of suppressing the valuation outright.

Direction is baked per series and was verified against FRED's own unit labels:
some DEX* series quote USD per one foreign unit (EUR/GBP/AUD/NZD), the rest
quote foreign units per one USD. `usd_per_unit(ccy)` normalizes both to "USD per
1 unit of ccy". Never fabricates: a currency with no series (or no recent
observation) returns None, and the caller keeps suppressing that valuation.
"""
from __future__ import annotations

import threading
import time
from datetime import date
from typing import Any

from engine.db import acquire, release

# ccy -> (FRED series id, series_is_foreign_per_usd). When True the series quotes
# foreign units per 1 USD, so usd_per_unit = 1 / value; when False it already
# quotes USD per 1 foreign unit. Verified live against each series' FRED units.
FX_SERIES: dict[str, tuple[str, bool]] = {
    "EUR": ("DEXUSEU", False),   # U.S. Dollars to One Euro
    "GBP": ("DEXUSUK", False),   # U.S. Dollars to One U.K. Pound
    "AUD": ("DEXUSAL", False),   # U.S. Dollars to One Australian Dollar
    "NZD": ("DEXUSNZ", False),   # U.S. Dollars to One New Zealand Dollar
    "JPY": ("DEXJPUS", True),    # Japanese Yen to One U.S. Dollar
    "CAD": ("DEXCAUS", True),    # Canadian Dollars to One U.S. Dollar
    "SGD": ("DEXSIUS", True),    # Singapore Dollars to One U.S. Dollar
    "CNY": ("DEXCHUS", True),    # Chinese Yuan to One U.S. Dollar
    "HKD": ("DEXHKUS", True),    # Hong Kong Dollars to One U.S. Dollar
    "CHF": ("DEXSZUS", True),    # Swiss Francs to One U.S. Dollar
    "KRW": ("DEXKOUS", True),    # South Korean Won to One U.S. Dollar
    "TWD": ("DEXTAUS", True),    # Taiwan Dollars to One U.S. Dollar
    "INR": ("DEXINUS", True),    # Indian Rupees to One U.S. Dollar
    "BRL": ("DEXBZUS", True),    # Brazilian Reals to One U.S. Dollar
    "MXN": ("DEXMXUS", True),    # Mexican Pesos to One U.S. Dollar
    "SEK": ("DEXSDUS", True),    # Swedish Kronor to One U.S. Dollar
}

# All FX series ids — used by scripts/ingest_macro.py so they're refreshed nightly.
FX_SERIES_IDS = sorted({sid for sid, _ in FX_SERIES.values()})

_TTL = 600.0
_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "rates": None}


def _load_rates() -> dict[str, tuple[float, date]]:
    """Latest value per FX series id from macro_series, keyed by series id."""
    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (series_id) series_id, date, value
                FROM macro_series
                WHERE series_id = ANY(%s) AND value IS NOT NULL
                ORDER BY series_id, date DESC
                """,
                (FX_SERIES_IDS,),
            )
            return {sid: (float(v), d) for sid, d, v in cur.fetchall()}
    finally:
        release(conn)


def _rates() -> dict[str, tuple[float, date]]:
    now = time.monotonic()
    if _cache["rates"] is not None and (now - _cache["at"]) < _TTL:
        return _cache["rates"]
    rates = _load_rates()
    with _lock:
        _cache["rates"] = rates
        _cache["at"] = now
    return rates


def usd_per_unit(ccy: str | None) -> tuple[float | None, date | None]:
    """USD per 1 unit of `ccy`, and the rate's observation date. USD → (1.0, None).
    Returns (None, None) for an unsupported currency or a series with no stored
    observation (caller must then suppress rather than fabricate)."""
    if not ccy:
        return None, None
    if ccy == "USD":
        return 1.0, None
    entry = FX_SERIES.get(ccy)
    if entry is None:
        return None, None
    series_id, foreign_per_usd = entry
    hit = _rates().get(series_id)
    if hit is None:
        return None, None
    value, obs_date = hit
    if value <= 0:
        return None, None
    rate = (1.0 / value) if foreign_per_usd else value
    return rate, obs_date
