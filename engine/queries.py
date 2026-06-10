"""Shared data-access layer — pure SQL functions over the DB.

No Streamlit dependency. Returns plain Python dicts/lists/frozensets.
Called directly by api/ routers. web/app.py continues to use its own
cached wrappers (it is being retired as a dev harness).

Write operations are scoped strictly to `watchlist` and `theses` tables.
Pipeline tables (securities, factor_scores, fundamental_metrics, prices_daily,
macro_series, etc.) are never touched here.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from engine.db import get_connection

MACRO_SERIES_IDS = ["DGS10", "DGS2", "FEDFUNDS", "CPIAUCSL", "VIXCLS"]


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

def screener_rows() -> tuple[list[dict[str, Any]], date | None]:
    """All active securities at the latest score_date with last two prices.

    Returns (rows, score_date). Each row is a plain dict; rank starts at 1.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT max(score_date) FROM factor_scores")
            score_date = cur.fetchone()[0]
            cur.execute(
                """
                SELECT s.ticker, s.name, s.sector, s.exchange,
                       fs.composite,
                       fs.growth_pctl, fs.value_pctl, fs.quality_pctl, fs.momentum_pctl,
                       lp.close  AS last_price,
                       lp2.close AS prev_close,
                       s.security_id
                FROM securities s
                JOIN factor_scores fs
                    ON fs.security_id = s.security_id AND fs.score_date = %s
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
                WHERE s.is_active
                ORDER BY fs.composite DESC NULLS LAST
                """,
                (score_date,),
            )
            db_rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()

    numeric = {
        "composite", "growth_pctl", "value_pctl", "quality_pctl", "momentum_pctl",
        "last_price", "prev_close",
    }
    rows: list[dict[str, Any]] = []
    for rank, raw in enumerate(db_rows, start=1):
        row = dict(zip(cols, raw, strict=True))
        for k in numeric:
            row[k] = _f(row.get(k))
        row["rank"] = rank
        rows.append(row)
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
                    AND fs.score_date = (SELECT max(score_date) FROM factor_scores)
                LEFT JOIN LATERAL (
                    SELECT close, date FROM prices_daily p
                    WHERE p.security_id = s.security_id
                    ORDER BY p.date DESC LIMIT 1
                ) lp ON true
                WHERE s.ticker = %s AND s.is_active
                """,
                (ticker,),
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
                    AND fs.score_date = (SELECT max(score_date) FROM factor_scores)
                LEFT JOIN LATERAL (
                    SELECT close FROM prices_daily p
                    WHERE p.security_id = s.security_id
                    ORDER BY p.date DESC LIMIT 1
                ) lp ON true
                ORDER BY w.added_at DESC
                """
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


def thesis_for_ticker(ticker: str) -> dict[str, Any] | None:
    """Active thesis for one ticker, or None."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT t.id, t.security_id, t.summary, t.invalidation_rules,
                       t.review_date, t.conviction, t.status,
                       t.created_at, t.updated_at
                FROM theses t
                JOIN securities s ON s.security_id = t.security_id
                WHERE s.ticker = %s AND t.status = 'active'
                ORDER BY t.updated_at DESC
                LIMIT 1
                """,
                (ticker,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    return dict(zip(cols, row, strict=True))


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
                    AND fs.score_date = (SELECT max(score_date) FROM factor_scores)
                WHERE t.status = 'active'
                ORDER BY t.review_date ASC NULLS LAST, t.updated_at DESC
                """
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
