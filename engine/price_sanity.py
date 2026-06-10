"""Nightly price sanity gates.

Three gates checked against the most-recently-loaded prices_daily date:

  1. Freshness: latest_date is within 10 calendar days of today (catches
     a dead price-feed before scores go stale).
  2. Coverage: ≥ 80 % of active securities have a bar on the latest date.
  3. Zero / negative: no close ≤ 0 on the latest date.
  4. Wild moves: no adj_close day-over-day change > ±50 % (split-excluded —
     securities with a corporate_actions split record within ±2 days are skipped).

Returns a summary dict; logs to job_runs as 'price_sanity'.
"""

from __future__ import annotations

import datetime
from pathlib import Path

from dotenv import load_dotenv

from engine.db import get_connection
from engine.jobs import finish_job, start_job

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

JOB_NAME = "price_sanity"
JOB_VERSION = "v1"

FRESHNESS_DAYS = 10   # latest_date must be within N calendar days of today
COVERAGE_THRESHOLD = 0.80   # ≥ 80 % of active universe must have a bar
JUMP_THRESHOLD = 0.50        # adj_close day-over-day change > 50 % → breach


def _check(cur) -> tuple[bool, list[str], dict]:
    """Run the four gates; return (passed, breach_messages, detail_dict)."""
    today = datetime.date.today()

    cur.execute("SELECT max(date) FROM prices_daily")
    latest_date = cur.fetchone()[0]
    if latest_date is None:
        return False, ["prices_daily is empty — no price data loaded"], {}

    detail: dict = {"latest_date": str(latest_date), "today": str(today)}
    breaches: list[str] = []

    # --- gate 1: freshness ---
    age_days = (today - latest_date).days
    detail["age_days"] = age_days
    if age_days > FRESHNESS_DAYS:
        breaches.append(
            f"Stale prices: latest_date {latest_date} is {age_days} days old "
            f"(threshold {FRESHNESS_DAYS})"
        )

    # --- gate 2: coverage ---
    cur.execute("SELECT count(*) FROM securities WHERE is_active")
    universe_count = cur.fetchone()[0]
    cur.execute(
        "SELECT count(DISTINCT security_id) FROM prices_daily WHERE date = %s",
        (latest_date,),
    )
    covered = cur.fetchone()[0]
    coverage_rate = covered / universe_count if universe_count else 0.0
    detail.update({"universe": universe_count, "covered": covered,
                   "coverage_rate": round(coverage_rate, 4)})
    if coverage_rate < COVERAGE_THRESHOLD:
        breaches.append(
            f"Coverage {covered}/{universe_count} = {coverage_rate:.1%} "
            f"< threshold {COVERAGE_THRESHOLD:.0%}"
        )

    # --- gate 3: zero / negative close ---
    cur.execute(
        """
        SELECT s.ticker, p.close
        FROM prices_daily p
        JOIN securities s ON s.security_id = p.security_id
        WHERE p.date = %s AND p.close <= 0
        ORDER BY s.ticker
        """,
        (latest_date,),
    )
    zero_rows = cur.fetchall()
    detail["zero_negative_count"] = len(zero_rows)
    for ticker, close in zero_rows[:20]:
        breaches.append(f"Zero/negative close: {ticker} close={close} on {latest_date}")

    # --- gate 4: wild adj_close moves (split-excluded) ---
    # Securities with a split on or near latest_date are excluded
    cur.execute(
        """
        SELECT security_id FROM corporate_actions
        WHERE action_type = 'split'
          AND ex_date BETWEEN %s AND %s
        """,
        (latest_date - datetime.timedelta(days=2), latest_date + datetime.timedelta(days=1)),
    )
    split_sids = {row[0] for row in cur.fetchall()}
    detail["split_excluded_count"] = len(split_sids)

    # Latest adj_close per security on latest_date
    cur.execute(
        "SELECT security_id, adj_close FROM prices_daily WHERE date = %s",
        (latest_date,),
    )
    today_adj = {sid: float(ac) for sid, ac in cur.fetchall() if ac is not None}

    # Most recent adj_close on the prior trading bar (up to 10 days back)
    cur.execute(
        """
        WITH ranked AS (
            SELECT security_id, adj_close,
                   row_number() OVER (PARTITION BY security_id ORDER BY date DESC) AS rn
            FROM prices_daily
            WHERE date < %s AND date >= %s
        )
        SELECT security_id, adj_close FROM ranked WHERE rn = 1
        """,
        (latest_date, latest_date - datetime.timedelta(days=10)),
    )
    prev_adj = {sid: float(ac) for sid, ac in cur.fetchall() if ac is not None}

    cur.execute("SELECT security_id, ticker FROM securities WHERE is_active")
    ticker_map = {sid: t for sid, t in cur.fetchall()}

    wild_moves: list[tuple[str, float]] = []
    for sid, ac_today in today_adj.items():
        if sid in split_sids:
            continue
        ac_prev = prev_adj.get(sid)
        if not ac_prev or ac_prev <= 0:
            continue
        change = abs(ac_today / ac_prev - 1.0)
        if change > JUMP_THRESHOLD:
            wild_moves.append((ticker_map.get(sid, str(sid)), round(change * 100, 1)))

    detail["wild_move_count"] = len(wild_moves)
    for ticker, pct in wild_moves[:20]:
        breaches.append(
            f"Wild move: {ticker} adj_close changed ±{pct}% on {latest_date} "
            f"(threshold {JUMP_THRESHOLD:.0%})"
        )

    return len(breaches) == 0, breaches, detail


def run() -> dict:
    """Run sanity gates, log to job_runs, return summary dict."""
    conn = get_connection()
    job_id = start_job(conn, JOB_NAME, job_version=JOB_VERSION)
    try:
        with conn.cursor() as cur:
            passed, breaches, detail = _check(cur)

        finish_job(
            conn,
            job_id,
            status="success" if passed else "failed",
            warnings=breaches if breaches else None,
            error="; ".join(breaches) if not passed else None,
        )
        return {"passed": passed, "breaches": breaches, "detail": detail, "job_id": job_id}
    except Exception as exc:
        conn.rollback()
        finish_job(conn, job_id, status="failed", error=str(exc))
        raise
    finally:
        if not conn.closed:
            conn.close()
