"""Shared data-access layer — pure SQL functions over the DB.

Returns plain Python dicts/lists/frozensets. Called directly by api/ routers.

Write operations are scoped strictly to `watchlist`, `theses`, and the AI
result caches (`ai_summaries`, `decision_briefs`). Pipeline tables (securities,
factor_scores, fundamental_metrics, prices_daily, macro_series, etc.) are
never touched here.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import date, timedelta
from typing import Any

from engine.db import get_connection

MACRO_SERIES_IDS = ["DGS10", "DGS2", "FEDFUNDS", "CPIAUCSL", "VIXCLS"]

# Which scoring config the app serves. factor_scores can hold several config
# versions per score_date (e.g. v1_linear and v2_linear side by side); every
# read below pins to this one so the screener/deep-dive never double-count.
# Flip to 'v2_linear' at cutover (after the v2 universe re-score lands).
ACTIVE_CONFIG_VERSION = "v2_linear"


def _f(v) -> float | None:
    """Coerce Decimal/None/NaN to float."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if f != f else f
    except (TypeError, ValueError):
        return None


# ── read queries ──────────────────────────────────────────────────────────────

def active_tickers() -> list[str]:
    """Tickers of all active securities (for the live-quote overlay)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT ticker FROM securities WHERE is_active ORDER BY ticker")
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def top_quote_tickers(limit: int = 300) -> list[str]:
    """Top-N active tickers by latest composite, PLUS anything currently held
    in the portfolio ledger — the bounded set for the live overlay. Fetching
    live quotes for the whole ~5.5k universe is slow (yfinance) and rate-limit-
    prone, so only the names at the top of the board and the user's own
    holdings get intraday prices; the long tail shows the nightly close. Falls
    back to all active tickers if no scores exist yet.

    The held-shares check is raw buy-sell sums (no split adjustment) — a name
    whose post-split sell zeroes the position could linger in the set, which
    only costs one extra quote fetch.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.ticker
                FROM securities s
                JOIN factor_scores fs
                  ON fs.security_id = s.security_id
                  AND fs.config_version = %s
                  AND fs.score_date = (SELECT max(score_date) FROM factor_scores
                                       WHERE config_version = %s)
                WHERE s.is_active
                ORDER BY fs.composite DESC NULLS LAST
                LIMIT %s
                """,
                (ACTIVE_CONFIG_VERSION, ACTIVE_CONFIG_VERSION, limit),
            )
            rows = [r[0] for r in cur.fetchall()]
            cur.execute(
                """
                SELECT s.ticker
                FROM portfolio_transactions t
                JOIN securities s ON s.security_id = t.security_id
                WHERE t.txn_type IN ('buy', 'sell')
                GROUP BY s.ticker
                HAVING SUM(CASE WHEN t.txn_type = 'buy' THEN t.shares
                                ELSE -t.shares END) > 0
                """
            )
            held = [r[0] for r in cur.fetchall()]
            seen = set(rows)
            rows += [t for t in held if t not in seen]
            # SPY rides along as the market pulse for the Market tab header.
            if "SPY" not in seen and "SPY" not in held:
                rows.append("SPY")
            return rows or active_tickers()
    finally:
        conn.close()


def latest_backtest(config_version: str = ACTIVE_CONFIG_VERSION) -> dict[str, Any] | None:
    """Most recent stored backtest run for the Lab page; None if never run."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT backtest_id, config_version, generated_at,
                       start_date, end_date, params, results
                FROM backtest_results
                WHERE config_version = %s
                ORDER BY generated_at DESC
                LIMIT 1
                """,
                (config_version,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    bid, cv, gen, sd, ed, params, results = row
    if isinstance(params, str):
        params = json.loads(params)
    if isinstance(results, str):
        results = json.loads(results)
    return {
        "backtest_id": int(bid),
        "config_version": cv,
        "generated_at": gen.isoformat(),
        "start_date": str(sd),
        "end_date": str(ed),
        "params": params,
        "results": results.get("results", {}),
        "benchmarks": results.get("benchmarks"),
    }


def screener_rows(complete_only: bool = True) -> tuple[list[dict[str, Any]], date | None]:
    """Active securities at the latest score_date with last two prices.

    complete_only (default True): restrict to names that have all four component
    factors present, so the composite ranking is apples-to-apples. Names missing
    any factor are excluded; rank rebuilds 1..N over the returned set.

    Returns (rows, score_date). Each row is a plain dict; rank starts at 1.
    """
    complete_clause = (
        " AND fs.growth_pctl IS NOT NULL AND fs.value_pctl IS NOT NULL"
        " AND fs.quality_pctl IS NOT NULL AND fs.momentum_pctl IS NOT NULL"
        if complete_only
        else ""
    )
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT max(score_date) FROM factor_scores WHERE config_version = %s",
                (ACTIVE_CONFIG_VERSION,),
            )
            score_date = cur.fetchone()[0]
            cur.execute(
                f"""
                SELECT s.ticker, s.name, s.sector, s.exchange,
                       fs.composite,
                       fs.growth_pctl, fs.value_pctl, fs.quality_pctl, fs.momentum_pctl,
                       lp.close  AS last_price,
                       lp2.close AS prev_close,
                       lp.close * sh.value AS market_cap,
                       s.security_id
                FROM securities s
                JOIN factor_scores fs
                    ON fs.security_id = s.security_id AND fs.score_date = %s
                    AND fs.config_version = %s
                LEFT JOIN LATERAL (
                    SELECT close FROM prices_daily p
                    WHERE p.security_id = s.security_id
                    ORDER BY p.date DESC LIMIT 1
                ) lp ON true
                LEFT JOIN LATERAL (
                    SELECT close FROM prices_daily p2
                    WHERE p2.security_id = s.security_id
                    ORDER BY p2.date DESC LIMIT 1 OFFSET 1
                ) lp2 ON true
                LEFT JOIN LATERAL (
                    SELECT value FROM xbrl_facts f
                    WHERE f.security_id = s.security_id
                      AND f.normalized_concept = 'shares_outstanding'
                    ORDER BY f.period_end DESC LIMIT 1
                ) sh ON true
                WHERE s.is_active{complete_clause}
                ORDER BY fs.composite DESC NULLS LAST
                """,
                (score_date, ACTIVE_CONFIG_VERSION),
            )
            db_rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()

    numeric = {
        "composite", "growth_pctl", "value_pctl", "quality_pctl", "momentum_pctl",
        "last_price", "prev_close", "market_cap",
    }
    rows: list[dict[str, Any]] = []
    for rank, raw in enumerate(db_rows, start=1):
        row = dict(zip(cols, raw, strict=True))
        for k in numeric:
            row[k] = _f(row.get(k))
        row["rank"] = rank
        rows.append(row)
    return rows, score_date


# ── screener cache (stale-while-revalidate, keyed on score_date) ────────────────
# screener_rows runs three correlated lookups per company (last price, prev
# close, shares) across the full ~5.5k universe — ~15s cold. But its payload
# (factor scores + EOD prices + market cap) is IMMUTABLE for a given score_date:
# it only changes when the nightly writes a new one. So we cache per
# complete_only and key-check on score_date. A hit serves instantly; a new
# score_date serves the prior snapshot while a background thread recomputes
# (so the morning's first open is never blocked); a cold cache computes inline
# once. Live intraday prices ride a separate /quotes overlay, so caching EOD
# here never makes the visible price stale.
_screener_lock = threading.Lock()
_screener_cache: dict[bool, dict[str, Any]] = {}
_screener_refreshing: set[bool] = set()


def _latest_screen_score_date() -> date | None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT max(score_date) FROM factor_scores WHERE config_version = %s",
                (ACTIVE_CONFIG_VERSION,),
            )
            return cur.fetchone()[0]
    finally:
        conn.close()


def _refresh_screener(complete_only: bool) -> None:
    """Recompute one variant into the cache (runs inline or in a daemon thread)."""
    try:
        rows, score_date = screener_rows(complete_only=complete_only)
        with _screener_lock:
            _screener_cache[complete_only] = {
                "score_date": score_date,
                "rows": rows,
                "t": time.monotonic(),
            }
    finally:
        with _screener_lock:
            _screener_refreshing.discard(complete_only)


def _start_screener_refresh(complete_only: bool) -> None:
    """Spawn a background recompute for one variant if not already running."""
    with _screener_lock:
        if complete_only in _screener_refreshing:
            return
        _screener_refreshing.add(complete_only)
    threading.Thread(target=_refresh_screener, args=(complete_only,), daemon=True).start()


def warm_screener() -> None:
    """Pre-warm both screener variants in the background (called at API startup)
    so the first open after boot is usually instant."""
    _start_screener_refresh(True)
    _start_screener_refresh(False)


def screener_rows_cached(
    complete_only: bool = True,
) -> tuple[list[dict[str, Any]], date | None]:
    """Cached screener_rows. See the cache note above.

    Replaces a ~15s full query with a ~100ms score_date probe + in-memory serve
    on every request except the once-per-day recompute (which runs in the
    background, never blocking a request once any snapshot exists)."""
    score_date = _latest_screen_score_date()
    with _screener_lock:
        entry = _screener_cache.get(complete_only)

    if entry is not None and entry["score_date"] == score_date:
        return entry["rows"], score_date  # hit

    if entry is not None:
        # new score_date landed (nightly ran): serve the prior snapshot now,
        # recompute in the background — the frontend's refetch-on-focus picks
        # up the fresh date moments later without anyone waiting ~15s.
        _start_screener_refresh(complete_only)
        return entry["rows"], entry["score_date"]

    # cold cache (first request after boot, before warm finished): compute inline.
    rows, score_date = screener_rows(complete_only=complete_only)
    with _screener_lock:
        _screener_cache[complete_only] = {
            "score_date": score_date,
            "rows": rows,
            "t": time.monotonic(),
        }
    return rows, score_date


def security_header(ticker: str) -> dict[str, Any] | None:
    """Security info + latest factor_scores (+ details) + last price.

    Returns None if the ticker is not found or inactive.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.security_id, s.ticker, s.name, s.sector,
                       s.exchange, s.industry,
                       fs.score_date, fs.composite,
                       fs.growth_pctl, fs.value_pctl,
                       fs.quality_pctl, fs.momentum_pctl,
                       fs.details,
                       lp.close AS last_price, lp.date AS price_date
                FROM securities s
                LEFT JOIN factor_scores fs
                    ON fs.security_id = s.security_id
                    AND fs.config_version = %s
                    AND fs.score_date = (SELECT max(score_date) FROM factor_scores
                                         WHERE config_version = %s)
                LEFT JOIN LATERAL (
                    SELECT close, date FROM prices_daily p
                    WHERE p.security_id = s.security_id
                    ORDER BY p.date DESC LIMIT 1
                ) lp ON true
                WHERE s.ticker = %s AND s.is_active
                """,
                (ACTIVE_CONFIG_VERSION, ACTIVE_CONFIG_VERSION, ticker),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()

    d = dict(zip(cols, row, strict=True))
    if isinstance(d.get("details"), str):
        d["details"] = json.loads(d["details"])
    for k in ("composite", "growth_pctl", "value_pctl", "quality_pctl",
              "momentum_pctl", "last_price"):
        d[k] = _f(d.get(k))
    return d


def price_history_rows(ticker: str, days: int | None = None) -> list[dict[str, Any]]:
    """Adj_close + close price history for one ticker, ordered ascending.

    If days is provided, returns only the most recent N calendar days.
    """
    cutoff: date | None = None
    if days is not None:
        cutoff = date.today() - timedelta(days=days)

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            if cutoff is not None:
                cur.execute(
                    """
                    SELECT p.date, p.adj_close, p.close
                    FROM prices_daily p
                    JOIN securities s ON s.security_id = p.security_id
                    WHERE s.ticker = %s AND s.is_active AND p.date >= %s
                    ORDER BY p.date
                    """,
                    (ticker, cutoff),
                )
            else:
                cur.execute(
                    """
                    SELECT p.date, p.adj_close, p.close
                    FROM prices_daily p
                    JOIN securities s ON s.security_id = p.security_id
                    WHERE s.ticker = %s AND s.is_active
                    ORDER BY p.date
                    """,
                    (ticker,),
                )
            rows = cur.fetchall()
    finally:
        conn.close()

    return [{"date": r[0], "adj_close": _f(r[1]), "close": _f(r[2])} for r in rows]


def fundamental_metric_rows(ticker: str) -> list[dict[str, Any]]:
    """Point-in-time fundamental_metrics for one ticker (metric_version=v1).

    Returns flat list of {as_of_date, metric, value}, ordered by date DESC.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT fm.as_of_date, fm.metric, fm.value
                FROM fundamental_metrics fm
                JOIN securities s ON s.security_id = fm.security_id
                WHERE s.ticker = %s AND s.is_active AND fm.metric_version = 'v1'
                ORDER BY fm.as_of_date DESC, fm.metric
                """,
                (ticker,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    return [{"as_of_date": r[0], "metric": r[1], "value": _f(r[2])} for r in rows]


def macro_latest_rows() -> dict[str, list[dict[str, Any]]]:
    """For each tracked macro series: the two most recent observations.

    Returns {series_id: [{"date": d, "value": v}, ...]}, latest first.
    MACRO IS CONTEXT ONLY — never feeds factor scores.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT series_id, date, value FROM (
                    SELECT series_id, date, value,
                           row_number() OVER (
                               PARTITION BY series_id ORDER BY date DESC
                           ) AS rn
                    FROM macro_series
                    WHERE series_id = ANY(%s)
                ) t
                WHERE rn <= 2
                ORDER BY series_id, date DESC
                """,
                (MACRO_SERIES_IDS,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    out: dict[str, list[dict[str, Any]]] = {}
    for sid, d, v in rows:
        out.setdefault(sid, []).append({"date": d, "value": _f(v)})
    return out


def macro_series_rows(series_id: str) -> list[dict[str, Any]]:
    """Full history for one macro series (for chart overlays)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT date, value FROM macro_series WHERE series_id = %s ORDER BY date",
                (series_id,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    return [{"date": r[0], "value": _f(r[1])} for r in rows]


def sparkline_rows(tickers: list[str], n: int = 30) -> dict[str, list[float]]:
    """Last n adj_close points per ticker, oldest→newest. Used for sparklines."""
    if not tickers:
        return {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ticker, adj_close FROM (
                    SELECT s.ticker, p.adj_close, p.date,
                           row_number() OVER (
                               PARTITION BY p.security_id ORDER BY p.date DESC
                           ) AS rn
                    FROM prices_daily p
                    JOIN securities s ON s.security_id = p.security_id
                    WHERE s.ticker = ANY(%s) AND s.is_active
                ) t
                WHERE rn <= %s
                ORDER BY ticker, date
                """,
                (tickers, n),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    out: dict[str, list[float]] = {t: [] for t in tickers}
    for ticker, adj_close in rows:
        f = _f(adj_close)
        if f is not None:
            out.setdefault(ticker, []).append(f)
    return out


def watchlist_rows() -> list[dict[str, Any]]:
    """Watchlist rows joined with securities + latest factor scores."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.ticker, s.name, s.sector, w.added_at,
                       fs.composite, fs.growth_pctl, fs.value_pctl,
                       fs.quality_pctl, fs.momentum_pctl,
                       lp.close AS last_price,
                       w.id AS watchlist_id, s.security_id
                FROM watchlist w
                JOIN securities s ON s.security_id = w.security_id
                LEFT JOIN factor_scores fs
                    ON fs.security_id = s.security_id
                    AND fs.config_version = %s
                    AND fs.score_date = (SELECT max(score_date) FROM factor_scores
                                         WHERE config_version = %s)
                LEFT JOIN LATERAL (
                    SELECT close FROM prices_daily p
                    WHERE p.security_id = s.security_id
                    ORDER BY p.date DESC LIMIT 1
                ) lp ON true
                ORDER BY w.added_at DESC
                """,
                (ACTIVE_CONFIG_VERSION, ACTIVE_CONFIG_VERSION),
            )
            db_rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()

    numeric = {
        "composite", "growth_pctl", "value_pctl", "quality_pctl",
        "momentum_pctl", "last_price",
    }
    result = []
    for raw in db_rows:
        row = dict(zip(cols, raw, strict=True))
        for k in numeric:
            row[k] = _f(row.get(k))
        result.append(row)
    return result


def watchlist_tickers() -> frozenset[str]:
    """Frozenset of tickers currently in the watchlist."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT s.ticker FROM watchlist w "
                "JOIN securities s ON s.security_id = w.security_id"
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return frozenset(r[0] for r in rows)


def all_theses_rows() -> list[dict[str, Any]]:
    """All active theses joined with securities + latest composite score."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.ticker, s.name, s.sector,
                       t.id AS thesis_id, t.security_id,
                       t.summary, t.invalidation_rules,
                       t.review_date, t.conviction, t.updated_at,
                       fs.composite
                FROM theses t
                JOIN securities s ON s.security_id = t.security_id
                LEFT JOIN factor_scores fs
                    ON fs.security_id = s.security_id
                    AND fs.config_version = %s
                    AND fs.score_date = (SELECT max(score_date) FROM factor_scores
                                         WHERE config_version = %s)
                WHERE t.status = 'active'
                ORDER BY t.review_date ASC NULLS LAST, t.updated_at DESC
                """,
                (ACTIVE_CONFIG_VERSION, ACTIVE_CONFIG_VERSION),
            )
            db_rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()

    result = []
    for raw in db_rows:
        row = dict(zip(cols, raw, strict=True))
        row["composite"] = _f(row.get("composite"))
        result.append(row)
    return result


# ── write helpers (watchlist + theses only) ────────────────────────────────────

def watchlist_add_by_ticker(ticker: str) -> tuple[str, int | None]:
    """Idempotent watchlist add.

    Returns (status, security_id) where status is one of:
      "added"           — newly inserted
      "already_present" — ticker was already in the watchlist
      "not_found"       — ticker not in securities or inactive
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT security_id FROM securities WHERE ticker = %s AND is_active LIMIT 1",
                (ticker,),
            )
            row = cur.fetchone()
            if row is None:
                return "not_found", None
            security_id: int = row[0]

            cur.execute(
                "INSERT INTO watchlist (security_id) VALUES (%s) "
                "ON CONFLICT (security_id) DO NOTHING",
                (security_id,),
            )
            added = cur.rowcount > 0
        conn.commit()
    finally:
        conn.close()

    return ("added" if added else "already_present"), security_id


def watchlist_remove_by_ticker(ticker: str) -> tuple[bool, str]:
    """Remove a ticker from the watchlist.

    Returns (removed, status) where status is one of:
      "removed"          — row was deleted
      "not_in_watchlist" — ticker found but not in watchlist
      "not_found"        — ticker not in securities or inactive
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT security_id FROM securities WHERE ticker = %s AND is_active LIMIT 1",
                (ticker,),
            )
            row = cur.fetchone()
            if row is None:
                return False, "not_found"
            security_id: int = row[0]

            cur.execute("DELETE FROM watchlist WHERE security_id = %s", (security_id,))
            deleted = cur.rowcount > 0
        conn.commit()
    finally:
        conn.close()

    return deleted, ("removed" if deleted else "not_in_watchlist")


def thesis_upsert_by_ticker(
    ticker: str,
    summary: str,
    invalidation_rules: str | None,
    review_date: date | None,
) -> tuple[str, int | None]:
    """Create or update the active thesis for a ticker.

    Returns (status, security_id) where status is one of:
      "created"   — new thesis row inserted
      "updated"   — existing thesis row updated
      "not_found" — ticker not in securities or inactive
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT security_id FROM securities WHERE ticker = %s AND is_active LIMIT 1",
                (ticker,),
            )
            row = cur.fetchone()
            if row is None:
                return "not_found", None
            security_id: int = row[0]

            cur.execute(
                "SELECT id FROM theses WHERE security_id = %s AND status = 'active' LIMIT 1",
                (security_id,),
            )
            existing = cur.fetchone()

            if existing:
                cur.execute(
                    """
                    UPDATE theses
                    SET summary = %s, invalidation_rules = %s,
                        review_date = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (summary, invalidation_rules or None, review_date, existing[0]),
                )
                status = "updated"
            else:
                cur.execute(
                    """
                    INSERT INTO theses (security_id, summary, invalidation_rules, review_date)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (security_id, summary, invalidation_rules or None, review_date),
                )
                status = "created"
        conn.commit()
    finally:
        conn.close()

    return status, security_id


def thesis_delete_by_ticker(ticker: str) -> tuple[bool, str]:
    """Delete the active thesis for a ticker.

    Returns (deleted, status) where status is one of:
      "deleted"           — thesis row removed
      "not_found_thesis"  — ticker found but no active thesis
      "not_found_ticker"  — ticker not in securities or inactive
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT security_id FROM securities WHERE ticker = %s AND is_active LIMIT 1",
                (ticker,),
            )
            row = cur.fetchone()
            if row is None:
                return False, "not_found_ticker"
            security_id: int = row[0]

            cur.execute(
                "DELETE FROM theses WHERE security_id = %s AND status = 'active'",
                (security_id,),
            )
            deleted = cur.rowcount > 0
        conn.commit()
    finally:
        conn.close()

    return deleted, ("deleted" if deleted else "not_found_thesis")


# ── filings + AI summaries (read; summaries written via save_filing_summary) ────

def filings_for_ticker(ticker: str, limit: int = 12) -> list[dict[str, Any]]:
    """Recent filings for a ticker (newest first)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT f.accession_no, f.form, f.filed_date,
                       f.period_of_report, f.primary_doc_url
                FROM filings f
                JOIN securities s ON s.security_id = f.security_id
                WHERE s.ticker = %s AND s.is_active
                ORDER BY f.filed_date DESC
                LIMIT %s
                """,
                (ticker, limit),
            )
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    return [dict(zip(cols, r, strict=True)) for r in rows]


def latest_filing(ticker: str, form: str = "10-K") -> dict[str, Any] | None:
    """Most recent filing of a given form for a ticker (incl. security_id)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.security_id, f.accession_no, f.form, f.filed_date,
                       f.period_of_report, f.primary_doc_url
                FROM filings f
                JOIN securities s ON s.security_id = f.security_id
                WHERE s.ticker = %s AND s.is_active AND f.form = %s
                ORDER BY f.filed_date DESC
                LIMIT 1
                """,
                (ticker, form),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    return dict(zip(cols, row, strict=True))


def get_cached_summary(
    accession_no: str, prompt_version: str, schema_version: str
) -> dict[str, Any] | None:
    """Cached AI summary for a filing (by accession + prompt/schema version)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT accession_no, form, summary, model,
                       prompt_version, schema_version, generated_at
                FROM ai_summaries
                WHERE accession_no = %s AND prompt_version = %s AND schema_version = %s
                LIMIT 1
                """,
                (accession_no, prompt_version, schema_version),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    d = dict(zip(cols, row, strict=True))
    if isinstance(d.get("summary"), str):
        d["summary"] = json.loads(d["summary"])
    return d


def save_filing_summary(
    *,
    security_id: int,
    accession_no: str,
    form: str | None,
    summary: dict[str, Any],
    model: str,
    prompt_version: str,
    schema_version: str,
    input_tokens: int | None,
    output_tokens: int | None,
) -> None:
    """Upsert a generated AI summary into the ai_summaries cache."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ai_summaries
                  (security_id, accession_no, form, summary, model,
                   prompt_version, schema_version, input_tokens, output_tokens,
                   validation_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'valid')
                ON CONFLICT (accession_no, prompt_version, schema_version)
                DO UPDATE SET
                  summary = EXCLUDED.summary,
                  model = EXCLUDED.model,
                  input_tokens = EXCLUDED.input_tokens,
                  output_tokens = EXCLUDED.output_tokens,
                  validation_status = 'valid',
                  generated_at = NOW()
                """,
                (
                    security_id, accession_no, form, json.dumps(summary), model,
                    prompt_version, schema_version, input_tokens, output_tokens,
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ── filing diligence Q&A (Phase 14 — context only) ────────────────────────────

def get_cached_filing_qa(
    accession_no: str, prompt_version: str, schema_version: str
) -> dict[str, Any] | None:
    """Cached deep filing answers for a 10-K (by accession + versions)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT accession_no, form, answers, model, generated_at
                FROM filing_answers
                WHERE accession_no = %s AND prompt_version = %s AND schema_version = %s
                LIMIT 1
                """,
                (accession_no, prompt_version, schema_version),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    d = dict(zip(cols, row, strict=True))
    if isinstance(d.get("answers"), str):
        d["answers"] = json.loads(d["answers"])
    return d


def save_filing_qa(
    *,
    security_id: int,
    accession_no: str,
    form: str | None,
    answers: dict[str, Any],
    model: str,
    prompt_version: str,
    schema_version: str,
    input_tokens: int | None,
    output_tokens: int | None,
) -> None:
    """Upsert generated diligence answers into the filing_answers cache."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO filing_answers
                  (security_id, accession_no, form, answers, model,
                   prompt_version, schema_version, input_tokens, output_tokens)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (accession_no, prompt_version, schema_version)
                DO UPDATE SET
                  answers = EXCLUDED.answers,
                  model = EXCLUDED.model,
                  input_tokens = EXCLUDED.input_tokens,
                  output_tokens = EXCLUDED.output_tokens,
                  generated_at = NOW()
                """,
                (
                    security_id, accession_no, form, json.dumps(answers), model,
                    prompt_version, schema_version, input_tokens, output_tokens,
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ── material events (Phase 13 — 8-K, context only) ────────────────────────────

def events_for_ticker(ticker: str, months: int = 12, limit: int = 60) -> list[dict[str, Any]]:
    """Recent 8-K material events for one ticker, newest event first.

    Returns raw rows (item codes + dates + doc url); the API layer attaches
    plain-English labels and the high-signal flag from engine.events.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT e.event_date, e.filed_date, e.form, e.items,
                       e.primary_doc_url, e.accession_no
                FROM material_events e
                JOIN securities s ON s.security_id = e.security_id
                WHERE s.ticker = %s
                  AND coalesce(e.event_date, e.filed_date)
                      >= CURRENT_DATE - %s * INTERVAL '1 month'
                ORDER BY coalesce(e.event_date, e.filed_date) DESC, e.filed_date DESC
                LIMIT %s
                """,
                (ticker, months, limit),
            )
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    return [dict(zip(cols, r, strict=True)) for r in rows]


# ── decision briefs (Phase 11) ────────────────────────────────────────────────

# Metrics carried in factor_scores.details.inputs that peers are compared on.
BRIEF_METRICS = [
    "pe", "ps", "ev_ebitda", "fcf_yield",
    "gross_margin", "operating_margin", "roic",
    "debt_to_equity", "net_debt_ebitda",
    "revenue_cagr", "eps_growth",
]


def factor_history(ticker: str, limit: int = 95) -> list[dict[str, Any]]:
    """Composite + factor percentiles + universe rank at every score_date.

    Rank (1 = best composite among active securities) is recomputed per
    score_date, so rank moves are comparable across snapshots. Returns the
    most recent `limit` snapshots, oldest first. History accrues one row per
    scoring run, so trend windows lengthen automatically over time.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                -- Rank within the COMPLETE-factor set per score_date (same basis
                -- as the screener), so the deep-dive rank matches the board and
                -- isn't distorted by partial momentum-only names. Partial names
                -- get a NULL rank (LEFT JOIN) rather than dropping out.
                WITH complete_ranked AS (
                    SELECT fs.security_id, fs.score_date,
                           RANK() OVER (PARTITION BY fs.score_date
                                        ORDER BY fs.composite DESC
                           ) AS univ_rank
                    FROM factor_scores fs
                    JOIN securities s ON s.security_id = fs.security_id
                    WHERE s.is_active AND fs.config_version = %s
                      AND fs.growth_pctl IS NOT NULL AND fs.value_pctl IS NOT NULL
                      AND fs.quality_pctl IS NOT NULL AND fs.momentum_pctl IS NOT NULL
                )
                SELECT fs.score_date, fs.composite, fs.growth_pctl, fs.value_pctl,
                       fs.quality_pctl, fs.momentum_pctl, cr.univ_rank
                FROM factor_scores fs
                JOIN securities s ON s.security_id = fs.security_id
                LEFT JOIN complete_ranked cr
                    ON cr.security_id = fs.security_id AND cr.score_date = fs.score_date
                WHERE s.ticker = %s AND fs.config_version = %s
                ORDER BY fs.score_date DESC
                LIMIT %s
                """,
                (ACTIVE_CONFIG_VERSION, ticker, ACTIVE_CONFIG_VERSION, limit),
            )
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()

    out: list[dict[str, Any]] = []
    for row in reversed(rows):  # newest-first query result -> oldest-first list
        d = dict(zip(cols, row, strict=True))
        for k in ("composite", "growth_pctl", "value_pctl",
                  "quality_pctl", "momentum_pctl"):
            d[k] = _f(d.get(k))
        d["rank"] = int(d["univ_rank"]) if d.get("univ_rank") is not None else None
        del d["univ_rank"]
        out.append(d)
    return out


def sector_metric_medians(sector: str) -> dict[str, Any]:
    """Median of each sub-metric across a sector at the latest score_date.

    Reads factor_scores.details.inputs for every active security in the
    sector. Returns {"n": peer_count, "medians": {metric: median_or_None}}.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT fs.details
                FROM factor_scores fs
                JOIN securities s ON s.security_id = fs.security_id
                WHERE s.is_active AND s.sector = %s
                  AND fs.config_version = %s
                  AND fs.score_date = (SELECT max(score_date) FROM factor_scores
                                       WHERE config_version = %s)
                """,
                (sector, ACTIVE_CONFIG_VERSION, ACTIVE_CONFIG_VERSION),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    values: dict[str, list[float]] = {m: [] for m in BRIEF_METRICS}
    for (details,) in rows:
        d = details if isinstance(details, dict) else json.loads(details or "{}")
        inputs = d.get("inputs") or {}
        for m in BRIEF_METRICS:
            v = _f(inputs.get(m))
            if v is not None:
                values[m].append(v)

    def _median(xs: list[float]) -> float | None:
        if not xs:
            return None
        xs = sorted(xs)
        n = len(xs)
        mid = n // 2
        return xs[mid] if n % 2 else (xs[mid - 1] + xs[mid]) / 2.0

    return {"n": len(rows), "medians": {m: _median(v) for m, v in values.items()}}


def get_cached_brief(
    security_id: int, score_date: date, prompt_version: str, schema_version: str
) -> dict[str, Any] | None:
    """Cached Decision Brief for one security at one scoring snapshot."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT score_date, brief, model,
                       prompt_version, schema_version, generated_at
                FROM decision_briefs
                WHERE security_id = %s AND score_date = %s
                  AND prompt_version = %s AND schema_version = %s
                LIMIT 1
                """,
                (security_id, score_date, prompt_version, schema_version),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    d = dict(zip(cols, row, strict=True))
    if isinstance(d.get("brief"), str):
        d["brief"] = json.loads(d["brief"])
    return d


def latest_brief(
    security_id: int, prompt_version: str, schema_version: str
) -> dict[str, Any] | None:
    """Most recent cached brief for a security (any score_date) at these
    versions. Used by the smart-refresh check, which decides whether that
    brief is still valid rather than keying strictly on today's score_date.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT score_date, brief, model,
                       prompt_version, schema_version, generated_at
                FROM decision_briefs
                WHERE security_id = %s AND prompt_version = %s AND schema_version = %s
                ORDER BY score_date DESC
                LIMIT 1
                """,
                (security_id, prompt_version, schema_version),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    d = dict(zip(cols, row, strict=True))
    if isinstance(d.get("brief"), str):
        d["brief"] = json.loads(d["brief"])
    return d


def latest_material_filing_date(security_id: int) -> date | None:
    """Most recent filed_date across filings, 8-K events and Form 4s for a
    security — i.e. the last time genuinely new material information arrived.
    The smart-refresh check regenerates a brief when this is newer than the
    cached brief's snapshot.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT max(d) FROM (
                    SELECT max(filed_date) AS d FROM filings WHERE security_id = %s
                    UNION ALL
                    SELECT max(filed_date) FROM material_events WHERE security_id = %s
                    UNION ALL
                    SELECT max(filed_date) FROM insider_transactions WHERE security_id = %s
                ) t
                """,
                (security_id, security_id, security_id),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    return row[0] if row else None


def save_brief(
    *,
    security_id: int,
    score_date: date,
    brief: dict[str, Any],
    model: str,
    prompt_version: str,
    schema_version: str,
    input_tokens: int | None,
    output_tokens: int | None,
) -> None:
    """Upsert a generated Decision Brief into the decision_briefs cache."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO decision_briefs
                  (security_id, score_date, brief, model,
                   prompt_version, schema_version, input_tokens, output_tokens)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (security_id, score_date, prompt_version, schema_version)
                DO UPDATE SET
                  brief = EXCLUDED.brief,
                  model = EXCLUDED.model,
                  input_tokens = EXCLUDED.input_tokens,
                  output_tokens = EXCLUDED.output_tokens,
                  generated_at = NOW()
                """,
                (
                    security_id, score_date, json.dumps(brief), model,
                    prompt_version, schema_version, input_tokens, output_tokens,
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ── insider transactions (Phase 12 — context only) ────────────────────────────

def insider_rows(ticker: str, months: int = 12, limit: int = 2000) -> list[dict[str, Any]]:
    """Recent Form 4 transactions for one ticker, newest first.

    The default limit is sized so the window's aggregates are computed over
    ALL rows even for heavy plan-sellers (NVDA files ~700 lines/year); the
    API truncates the displayed list separately.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT it.transaction_date, it.filed_date, it.owner_name,
                       it.owner_title, it.is_director, it.is_officer,
                       it.is_ten_pct, it.transaction_code, it.acquired_disposed,
                       it.shares, it.price, it.value, it.plan_10b5_1, it.form
                FROM insider_transactions it
                JOIN securities s ON s.security_id = it.security_id
                WHERE s.ticker = %s
                  AND it.transaction_date >= CURRENT_DATE - %s * INTERVAL '1 month'
                ORDER BY it.transaction_date DESC, it.filed_date DESC, it.id DESC
                LIMIT %s
                """,
                (ticker, months, limit),
            )
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()

    out = []
    for row in rows:
        d = dict(zip(cols, row, strict=True))
        for k in ("shares", "price", "value"):
            d[k] = _f(d.get(k))
        out.append(d)
    return out


def insider_summary(rows: list[dict[str, Any]], months: int) -> dict[str, Any]:
    """Open-market buy/sell aggregates over the trailing `months` window.

    Pure function over insider_rows() output (newest first) so the API can
    compute 3m and 12m windows from one query. Only codes P (open-market
    purchase) and S (open-market sale) count — awards, exercises, tax
    withholding and gifts are reported in the table but carry no buy/sell
    intent signal.
    """
    floor = date.today() - timedelta(days=int(months * 30.44))

    buys = [r for r in rows
            if r["transaction_code"] == "P"
            and r["transaction_date"] and r["transaction_date"] >= floor]
    sells = [r for r in rows
             if r["transaction_code"] == "S"
             and r["transaction_date"] and r["transaction_date"] >= floor]

    def _tot(xs):
        vals = [r["value"] for r in xs if r["value"] is not None]
        return sum(vals) if vals else None

    sell_plan = [r for r in sells if r["plan_10b5_1"]]
    return {
        "months": months,
        "buy_count": len(buys),
        "sell_count": len(sells),
        "buy_value": _tot(buys),
        "sell_value": _tot(sells),
        "distinct_buyers": len({r["owner_name"] for r in buys}),
        "distinct_sellers": len({r["owner_name"] for r in sells}),
        "sells_under_plan": len(sell_plan),
    }
