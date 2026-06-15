"""Live intraday quotes (Phase 15) — a thin real-time-ish price layer.

The factor pipeline is end-of-day by design: scores rank on *closing* prices and
roll over once per night. But a user opening the screener intraday wants the
Price column to reflect *now*, not yesterday's close. This module fetches
current quotes from yfinance (batched, one HTTP call for the whole universe) and
caches them in-process for a short TTL so repeated page opens are instant and we
don't hammer the source.

CONTEXT ONLY: quotes never touch factor_scores or any pipeline table — they're a
display overlay. Free yfinance quotes are typically ~15 minutes delayed; the API
labels them accordingly rather than claiming true real-time.
"""
from __future__ import annotations

import threading
import time
from typing import Any

import pandas as pd
import yfinance as yf

# Short server-side cache: one fetch serves all opens within this window, so
# the data is never more than ~TTL + source-delay stale. Keyed by the requested
# ticker-set so distinct callers (screener top-N, a single deep-dive name, a
# portfolio's holdings) don't overwrite each other's payloads.
_TTL_SECONDS = 90
_lock = threading.Lock()
_cache: dict[str, dict[str, Any]] = {}  # cache_key -> {fetched_monotonic, payload}


def _cache_key(tickers: list[str]) -> str:
    return "|".join(sorted(set(tickers)))


def _fetch(tickers: list[str]) -> dict[str, Any]:
    """Batched yfinance pull: last two daily rows → current price + prev close.

    On an in-progress trading day yfinance includes a row for today whose Close
    is the latest (delayed) price; the row before it is the prior close, giving
    the day change. Returns {quotes: {ticker: {...}}, as_of_epoch}.
    """
    quotes: dict[str, dict[str, float | None]] = {}
    if not tickers:
        return {"quotes": quotes, "as_of_epoch": time.time()}

    df = yf.download(
        tickers, period="2d", interval="1d",
        progress=False, auto_adjust=False, threads=True,
    )
    close = df["Close"] if "Close" in df else pd.DataFrame()
    # Single-ticker downloads come back without a ticker column level.
    if isinstance(close, pd.Series):
        close = close.to_frame(name=tickers[0])

    for t in tickers:
        if t not in close.columns:
            continue
        col = close[t].dropna()
        if col.empty:
            continue
        last = float(col.iloc[-1])
        prev = float(col.iloc[-2]) if len(col) >= 2 else None
        change_pct = ((last / prev - 1.0) * 100.0) if prev else None
        quotes[t] = {
            "price": last,
            "prev_close": prev,
            "change_pct": change_pct,
        }
    return {"quotes": quotes, "as_of_epoch": time.time()}


def get_quotes(tickers: list[str], *, force: bool = False) -> dict[str, Any]:
    """Cached live quotes for the given tickers.

    Serves a cached payload if it's younger than the TTL, else refetches under a
    lock (so concurrent opens trigger a single upstream call). Cache is keyed by
    the ticker-set, so a single-name lookup never evicts the screener's top-N
    payload. Returns {quotes, as_of_epoch, age_seconds, stale}.
    """
    key = _cache_key(tickers)
    now = time.monotonic()
    entry = _cache.get(key)
    if not force and entry is not None and (now - entry["fetched_monotonic"]) < _TTL_SECONDS:
        return {**entry["payload"], "age_seconds": round(now - entry["fetched_monotonic"], 1),
                "stale": False}

    with _lock:
        # Re-check inside the lock: another thread may have just refreshed.
        now = time.monotonic()
        entry = _cache.get(key)
        if not force and entry is not None and (now - entry["fetched_monotonic"]) < _TTL_SECONDS:
            return {**entry["payload"], "age_seconds": round(now - entry["fetched_monotonic"], 1),
                    "stale": False}
        try:
            payload = _fetch(tickers)
            _cache[key] = {"fetched_monotonic": time.monotonic(), "payload": payload}
            return {**payload, "age_seconds": 0.0, "stale": False}
        except Exception:  # noqa: BLE001 — never let a quote outage break the page
            if entry is not None:
                return {
                    **entry["payload"],
                    "age_seconds": round(time.monotonic() - entry["fetched_monotonic"], 1),
                    "stale": True,
                }
            return {"quotes": {}, "as_of_epoch": time.time(), "age_seconds": 0.0,
                    "stale": True}


def get_quote_one(ticker: str) -> dict[str, Any]:
    """Live quote for a single ticker (its own cache slot). Returns
    {price, prev_close, change_pct, as_of_epoch, stale} — price is None if the
    source had nothing for it."""
    t = ticker.upper()
    payload = get_quotes([t])
    row = payload["quotes"].get(t, {})
    return {
        "price": row.get("price"),
        "prev_close": row.get("prev_close"),
        "change_pct": row.get("change_pct"),
        "as_of_epoch": payload["as_of_epoch"],
        "stale": payload["stale"],
    }
