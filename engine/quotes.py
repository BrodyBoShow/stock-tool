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

import concurrent.futures
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

# yfinance has no request timeout, and Yahoo periodically throttles datacenter
# IPs (e.g. Render) — a throttled call can hang for tens of seconds, stalling
# the HTTP request past the gateway timeout. We run fetches on a small pool so a
# caller can wait a bounded time (timeout=) and fall back to stale/empty while
# the fetch finishes in the background and lands in the cache for the next poll.
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="quotes")
_inflight: dict[str, concurrent.futures.Future[dict[str, Any]]] = {}


def _cache_key(tickers: list[str]) -> str:
    return "|".join(sorted(set(tickers)))


def _fetch(tickers: list[str]) -> dict[str, Any]:
    """Batched yfinance pull: last two daily closes → current price + prev close.

    On an in-progress trading day yfinance includes a row for today whose Close
    is the latest (delayed) price; the row before it is the prior close, giving
    the day change. Returns {quotes: {ticker: {...}}, as_of_epoch}.

    We pull a 5-day window rather than 2: a 2-day calendar window
    intermittently lands a single non-NaN daily close for some names mid-session
    (batch-download index alignment around weekends/holidays), which left those
    rows with a live price but no prior close — so the day-change delta silently
    vanished and the price *looked* stale. Five days guarantees >=2 trading days
    for any active name; we still take only the last two closes, so the live
    price is unchanged.
    """
    quotes: dict[str, dict[str, float | None]] = {}
    if not tickers:
        return {"quotes": quotes, "as_of_epoch": time.time()}

    df = yf.download(
        tickers, period="5d", interval="1d",
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


def _fetch_and_cache(key: str, tickers: list[str]) -> dict[str, Any]:
    """Run a fetch and store it in the cache. Runs on the pool so a caller can
    bound its wait (see get_quotes' timeout) while this still completes in the
    background and lands in the cache for the next poll."""
    payload = _fetch(tickers)
    with _lock:
        _cache[key] = {"fetched_monotonic": time.monotonic(), "payload": payload}
    return payload


def _submit(key: str, tickers: list[str]) -> concurrent.futures.Future[dict[str, Any]]:
    """One in-flight fetch per ticker-set — concurrent callers share it (this is
    the dedup the old in-lock re-check provided, now future-based)."""
    with _lock:
        fut = _inflight.get(key)
        if fut is None or fut.done():
            fut = _executor.submit(_fetch_and_cache, key, tickers)
            _inflight[key] = fut
        return fut


def _fallback(entry: dict[str, Any] | None) -> dict[str, Any]:
    """Serve the last good payload (marked stale) or an empty one — never raise."""
    if entry is not None:
        return {
            **entry["payload"],
            "age_seconds": round(time.monotonic() - entry["fetched_monotonic"], 1),
            "stale": True,
        }
    return {"quotes": {}, "as_of_epoch": time.time(), "age_seconds": 0.0, "stale": True}


def get_quotes(
    tickers: list[str], *, force: bool = False, timeout: float | None = None
) -> dict[str, Any]:
    """Cached live quotes for the given tickers.

    Serves a cached payload if it's younger than the TTL, else fetches (one
    upstream call shared across concurrent openers, keyed by the ticker-set so a
    single-name lookup never evicts the screener's top-N payload). Returns
    {quotes, as_of_epoch, age_seconds, stale}.

    `timeout` bounds the wait for a fresh fetch: yfinance has no request timeout
    and Yahoo throttles datacenter IPs, so an unbounded wait can hang the HTTP
    request past the gateway limit. When the fetch overruns `timeout` we return
    the last good payload (stale) — or empty — while it finishes in the
    background for the next poll. `timeout=None` waits indefinitely (unchanged
    behavior for callers that must have data, e.g. nightly sync).
    """
    key = _cache_key(tickers)
    now = time.monotonic()
    entry = _cache.get(key)
    if not force and entry is not None and (now - entry["fetched_monotonic"]) < _TTL_SECONDS:
        return {**entry["payload"], "age_seconds": round(now - entry["fetched_monotonic"], 1),
                "stale": False}

    fut = _submit(key, tickers)
    try:
        payload = fut.result(timeout=timeout)
        return {**payload, "age_seconds": 0.0, "stale": False}
    except Exception:  # noqa: BLE001 — timeout or outage: never break the page
        return _fallback(entry)


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
