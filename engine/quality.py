"""Phase 5b — Data quality gates: golden fixtures + universe sanity checks.

Loads config/fixtures.json (expected values transcribed from officially
filed 10-K figures — independent of this pipeline) and asserts:

1. Computed fundamental_metrics match expected values within tolerance.
2. Structural behaviors hold (proxies, deliberate nulls, dual-class
   duplication, universe exclusions) — asserted from data, so a regression
   that silently "fixes" them wrongly fails the suite.
3. Point-in-time integrity: ADM's restated value must NOT leak backward —
   the as-known value at an early date stays the originally-filed figure.
4. Universe-wide sanity gates: margin bounds, no negative share counts or
   revenue, TTM-vs-annual reconciliation (recomputed fresh, not read from
   truncated job_runs warnings), full concept normalization, EPS bounds.

The suite exits non-zero on any failure: this is the gate that stops bad
data from reaching scoring. The run is logged to job_runs.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

from dotenv import load_dotenv

from engine.db import get_connection
from engine.jobs import finish_job, start_job
from engine.metrics import Fact, _ttm_from, series_by_tag, snapshot

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

FIXTURES_PATH = _PROJECT_ROOT / "config" / "fixtures.json"
JOB_NAME = "data_quality_gates"
JOB_VERSION = "v1"


def load_fixtures() -> dict:
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


def _tenk_as_of(cur, ticker: str, fy_end: str) -> date | None:
    """filed_date of the 10-K for a fiscal year end, resolved via shared CIK."""
    cur.execute(
        """
        SELECT fl.filed_date
        FROM filings fl
        WHERE fl.form = '10-K'
          AND fl.period_of_report = %s
          AND fl.security_id IN (
              SELECT security_id FROM securities
              WHERE cik = (SELECT cik FROM securities WHERE ticker = %s AND is_active)
          )
        ORDER BY fl.filed_date LIMIT 1
        """,
        (fy_end, ticker),
    )
    row = cur.fetchone()
    return row[0] if row else None


def _metric_at(cur, ticker: str, metric: str, as_of: date) -> float | None:
    cur.execute(
        """
        SELECT m.value FROM fundamental_metrics m
        JOIN securities s USING (security_id)
        WHERE s.ticker = %s AND s.is_active AND m.metric = %s
          AND m.as_of_date = %s AND m.metric_version = 'v1'
        """,
        (ticker, metric, as_of),
    )
    row = cur.fetchone()
    return float(row[0]) if row else None


def _latest_as_of(cur, ticker: str) -> date | None:
    cur.execute(
        """
        SELECT max(m.as_of_date) FROM fundamental_metrics m
        JOIN securities s USING (security_id)
        WHERE s.ticker = %s AND s.is_active
        """,
        (ticker,),
    )
    row = cur.fetchone()
    return row[0] if row else None


def _metrics_at_latest(cur, ticker: str) -> set[str]:
    cur.execute(
        """
        SELECT m.metric FROM fundamental_metrics m
        JOIN securities s USING (security_id)
        WHERE s.ticker = %s AND s.is_active
          AND m.as_of_date = (
            SELECT max(m2.as_of_date) FROM fundamental_metrics m2
            JOIN securities s2 USING (security_id)
            WHERE s2.ticker = %s AND s2.is_active)
        """,
        (ticker, ticker),
    )
    return {r[0] for r in cur.fetchall()}


def _fact_count(cur, ticker: str, normalized: tuple[str, ...]) -> int:
    cur.execute(
        """
        SELECT count(*) FROM xbrl_facts f JOIN securities s USING (security_id)
        WHERE s.ticker = %s AND s.is_active AND f.normalized_concept = ANY(%s)
        """,
        (ticker, list(normalized)),
    )
    return cur.fetchone()[0]


# --------------------------------------------------------------------------
# Section evaluators — each returns (rows, n_failures)
# --------------------------------------------------------------------------

def eval_value_fixtures(cur, fixtures: dict) -> tuple[list[dict], int]:
    rows, failures = [], 0
    for fx in fixtures["value_fixtures"]:
        ticker, fy_end = fx["ticker"], fx["fiscal_year_end"]
        as_of = _tenk_as_of(cur, ticker, fy_end)
        for metric, spec in fx["metrics"].items():
            expected = spec["expected"]
            actual = _metric_at(cur, ticker, metric, as_of) if as_of else None
            if actual is None:
                ok = False
                detail = "no computed value at 10-K as_of" + ("" if as_of else " (10-K not found)")
            elif "tol_abs" in spec:
                ok = abs(actual - expected) <= spec["tol_abs"]
                detail = f"diff {actual - expected:+.5f} (tol_abs {spec['tol_abs']})"
            else:
                ok = abs(actual - expected) <= spec["tol_rel"] * abs(expected)
                detail = f"diff {(actual - expected) / expected:+.4%} (tol {spec['tol_rel']:.0%})"
            failures += 0 if ok else 1
            rows.append(
                {
                    "ticker": ticker,
                    "fy_end": fy_end,
                    "as_of": str(as_of),
                    "metric": metric,
                    "expected": expected,
                    "actual": actual,
                    "ok": ok,
                    "detail": detail,
                    "source": spec["source"],
                }
            )
    return rows, failures


def eval_behavior_fixtures(cur, fixtures: dict) -> tuple[list[tuple[str, str, bool, str]], int]:
    bf = fixtures["behavior_fixtures"]
    rows: list[tuple[str, str, bool, str]] = []

    # Dual-class share classes must carry identical metrics.
    a, b = bf["dual_class_identical"]["tickers"]
    for metric in bf["dual_class_identical"]["metrics"]:
        la, lb = _latest_as_of(cur, a), _latest_as_of(cur, b)
        va = _metric_at(cur, a, metric, la) if la else None
        vb = _metric_at(cur, b, metric, lb) if lb else None
        ok = va is not None and vb is not None and la == lb and abs(va - vb) < 1e-9 * max(
            1.0, abs(va)
        )
        rows.append(
            ("dual_class_identical", f"{a}/{b}:{metric}", ok, f"{a}={va} {b}={vb} as_of {la}/{lb}")
        )

    for t in bf["eps_proxy_at_latest"]["tickers"]:
        n_eps = _fact_count(cur, t, ("eps_basic", "eps_diluted"))
        has = "ttm_eps" in _metrics_at_latest(cur, t)
        ok = n_eps == 0 and has
        rows.append(("eps_proxy_at_latest", t, ok, f"eps_facts={n_eps}, ttm_eps_present={has}"))

    for t in bf["eps_null_no_proxy_possible"]["tickers"]:
        n_eps = _fact_count(cur, t, ("eps_basic", "eps_diluted"))
        has = "ttm_eps" in _metrics_at_latest(cur, t)
        ok = n_eps == 0 and not has
        rows.append(
            ("eps_null_no_proxy_possible", t, ok, f"eps_facts={n_eps}, ttm_eps_present={has}")
        )

    for t in bf["roic_roa_proxy"]["tickers"]:
        n_oi = _fact_count(cur, t, ("operating_income",))
        has = "roic" in _metrics_at_latest(cur, t)
        ok = n_oi == 0 and has
        rows.append(("roic_roa_proxy", t, ok, f"operating_income_facts={n_oi}, roic_present={has}"))

    for t in bf["revenue_null_flagged"]["tickers"]:
        has = "ttm_revenue" in _metrics_at_latest(cur, t)
        rows.append(("revenue_null_flagged", t, not has, f"ttm_revenue_present={has}"))

    for t in bf["recent_ipo_no_data"]["tickers"]:
        cur.execute(
            "SELECT count(*) FROM xbrl_facts f JOIN securities s USING(security_id) "
            "WHERE s.ticker=%s",
            (t,),
        )
        n_facts = cur.fetchone()[0]
        cur.execute(
            "SELECT count(*) FROM fundamental_metrics m JOIN securities s USING(security_id) "
            "WHERE s.ticker=%s",
            (t,),
        )
        n_metrics = cur.fetchone()[0]
        cur.execute(
            """SELECT warnings FROM job_runs WHERE job_name='fundamentals_ingestion'
               AND status='success' ORDER BY id DESC LIMIT 1"""
        )
        w = cur.fetchone()
        flagged = bool(w and w[0] and any(str(x).startswith(t) for x in w[0]))
        ok = n_facts == 0 and n_metrics == 0 and flagged
        rows.append(
            ("recent_ipo_no_data", t, ok,
             f"facts={n_facts}, metrics={n_metrics}, flagged_in_job_runs={flagged}")
        )

    for t in bf["recent_ipo_short_history"]["tickers"]:
        ms = _metrics_at_latest(cur, t)
        ok = len(ms) > 0 and "revenue_cagr" not in ms
        rows.append(
            ("recent_ipo_short_history", t, ok,
             f"metrics_at_latest={len(ms)}, revenue_cagr_present={'revenue_cagr' in ms}")
        )

    for t in bf["universe_excludes"]["tickers"]:
        cur.execute("SELECT count(*) FROM securities WHERE ticker=%s", (t,))
        n = cur.fetchone()[0]
        rows.append(("universe_excludes", t, n == 0, f"securities_rows={n}"))

    failures = sum(1 for _, _, ok, _ in rows if not ok)
    return rows, failures


def eval_point_in_time(cur, fixtures: dict) -> tuple[list[tuple[str, bool, str]], int]:
    pit = fixtures["point_in_time"]
    rows: list[tuple[str, bool, str]] = []

    def as_known(at: str) -> float | None:
        cur.execute(
            """
            SELECT f.value FROM xbrl_facts f JOIN securities s USING (security_id)
            WHERE s.ticker = %s AND s.is_active AND f.concept = %s AND f.unit = %s
              AND f.period_end = %s AND f.fiscal_period = %s AND f.filed_date <= %s
            ORDER BY f.filed_date DESC LIMIT 1
            """,
            (pit["ticker"], pit["concept"], pit["unit"], pit["period_end"],
             pit["fiscal_period"], at),
        )
        row = cur.fetchone()
        return float(row[0]) if row else None

    early = as_known(pit["as_known_early"]["date"])
    late = as_known(pit["as_known_late"]["date"])
    e_exp, l_exp = pit["as_known_early"]["expected"], pit["as_known_late"]["expected"]

    ok_early = early is not None and abs(early - e_exp) <= 0.001 * abs(e_exp)
    ok_late = late is not None and abs(late - l_exp) <= 0.001 * abs(l_exp)
    ok_differs = early is not None and late is not None and early != late

    rows.append((f"as-known {pit['as_known_early']['date']} == originally filed", ok_early,
                 f"got {early:,.0f}, expected {e_exp:,.0f} (no backward leak)"))
    rows.append((f"as-known {pit['as_known_late']['date']} == restated", ok_late,
                 f"got {late:,.0f}, expected {l_exp:,.0f}"))
    rows.append(("pre/post restatement values differ", ok_differs, f"{early:,.0f} -> {late:,.0f}"))
    failures = sum(1 for _, ok, _ in rows if not ok)
    return rows, failures


def eval_sanity_gates(cur, fixtures: dict) -> tuple[list[tuple[str, bool, str, list]], int]:
    cfg = fixtures["sanity_gates"]
    lo, hi = cfg["margin_bounds"]
    eps_bound = cfg["eps_abs_bound"]
    gates: list[tuple[str, bool, str, list]] = []

    cur.execute(
        """
        SELECT s.ticker, m.metric, m.as_of_date, m.value
        FROM fundamental_metrics m JOIN securities s USING (security_id)
        WHERE m.metric IN ('gross_margin','operating_margin') AND (m.value < %s OR m.value > %s)
        ORDER BY m.value LIMIT 20
        """,
        (lo, hi),
    )
    breaches = [f"{t} {m} {d} = {float(v):.3f}" for t, m, d, v in cur.fetchall()]
    gates.append((f"margins within [{lo}, {hi}]", not breaches,
                  f"{len(breaches)} breach(es)", breaches))

    cur.execute(
        "SELECT count(*) FROM xbrl_facts WHERE normalized_concept='shares_outstanding' "
        "AND value < 0"
    )
    n = cur.fetchone()[0]
    gates.append(("no negative share counts", n == 0, f"{n} negative fact(s)", []))

    cur.execute(
        """
        SELECT s.ticker, m.as_of_date, m.value
        FROM fundamental_metrics m JOIN securities s USING (security_id)
        WHERE m.metric = 'ttm_revenue' AND m.value < 0 LIMIT 20
        """
    )
    breaches = [f"{t} {d} = {float(v):,.0f}" for t, d, v in cur.fetchall()]
    gates.append(("no negative ttm_revenue", not breaches, f"{len(breaches)} breach(es)",
                  breaches))

    cur.execute(
        """
        SELECT s.ticker, f.period_end, f.value
        FROM xbrl_facts f JOIN securities s USING (security_id)
        WHERE f.normalized_concept = 'revenue' AND f.value < 0
          AND f.period_start IS NOT NULL AND (f.period_end - f.period_start) > 300
        LIMIT 20
        """
    )
    breaches = [f"{t} annual ending {d} = {float(v):,.0f}" for t, d, v in cur.fetchall()]
    gates.append(("no negative annual revenue facts", not breaches,
                  f"{len(breaches)} breach(es)", breaches))

    cur.execute("SELECT count(*) FROM xbrl_facts WHERE normalized_concept IS NULL")
    n = cur.fetchone()[0]
    gates.append(("every xbrl_fact normalized", n == 0, f"{n} unnormalized fact(s)", []))

    cur.execute(
        """
        SELECT s.ticker, m.as_of_date, m.value
        FROM fundamental_metrics m JOIN securities s USING (security_id)
        WHERE m.metric = 'ttm_eps' AND abs(m.value) > %s LIMIT 20
        """,
        (eps_bound,),
    )
    breaches = [f"{t} {d} = {float(v):,.2f}" for t, d, v in cur.fetchall()]
    gates.append((f"|ttm_eps| <= {eps_bound}", not breaches, f"{len(breaches)} breach(es)",
                  breaches))

    # TTM-vs-annual reconciliation, recomputed fresh at each company's
    # latest snapshot (independent of truncated job_runs warnings).
    cur.execute(
        """
        SELECT s.security_id, s.ticker FROM securities s
        WHERE s.is_active AND EXISTS (
            SELECT 1 FROM xbrl_facts f WHERE f.security_id = s.security_id
              AND f.normalized_concept = 'revenue')
        ORDER BY s.ticker
        """
    )
    universe = cur.fetchall()
    recon_breaches = []
    for sid, ticker in universe:
        cur.execute(
            """
            SELECT concept, normalized_concept, unit, value, period_start, period_end,
                   fiscal_period, filed_date
            FROM xbrl_facts WHERE security_id = %s AND normalized_concept = 'revenue'
            """,
            (sid,),
        )
        facts = [Fact(*r) for r in cur.fetchall()]
        if not facts:
            continue
        snap = snapshot(facts, max(f.filed for f in facts))
        for _tag, quarters, annuals in series_by_tag(snap, "revenue"):
            value, _end, issue = _ttm_from(quarters, annuals, "revenue")
            if value is not None:
                if issue:
                    recon_breaches.append(f"{ticker}: {issue}")
                break
    gates.append(("TTM reconciles to annual (latest snapshot, all companies)",
                  not recon_breaches, f"{len(recon_breaches)} breach(es)", recon_breaches[:20]))

    failures = sum(1 for _, ok, _, _ in gates if not ok)
    return gates, failures


def run() -> dict:
    fixtures = load_fixtures()
    today = datetime.now(UTC).date()
    conn = get_connection()
    job_id = start_job(conn, JOB_NAME, job_version=JOB_VERSION, data_date=today)

    try:
        with conn.cursor() as cur:
            value_rows, f1 = eval_value_fixtures(cur, fixtures)
            behavior_rows, f2 = eval_behavior_fixtures(cur, fixtures)
            pit_rows, f3 = eval_point_in_time(cur, fixtures)
            gate_rows, f4 = eval_sanity_gates(cur, fixtures)
        total_failures = f1 + f2 + f3 + f4
        n_checks = len(value_rows) + len(behavior_rows) + len(pit_rows) + len(gate_rows)

        failure_lines = (
            [f"value: {r['ticker']} {r['fy_end']} {r['metric']} ({r['detail']})"
             for r in value_rows if not r["ok"]]
            + [f"behavior: {n} {t} ({d})" for n, t, ok, d in behavior_rows if not ok]
            + [f"point-in-time: {n} ({d})" for n, ok, d in pit_rows if not ok]
            + [f"gate: {n} ({d})" for n, ok, d, _ in gate_rows if not ok]
        )
        finish_job(
            conn,
            job_id,
            status="success" if total_failures == 0 else "failed",
            rows_affected=n_checks,
            warnings=failure_lines or None,
            error=None if total_failures == 0 else f"{total_failures} quality check(s) failed",
        )
    finally:
        if not conn.closed:
            conn.close()

    return {
        "value_rows": value_rows,
        "behavior_rows": behavior_rows,
        "pit_rows": pit_rows,
        "gate_rows": gate_rows,
        "failures": total_failures,
        "checks": n_checks,
        "job_id": job_id,
    }
