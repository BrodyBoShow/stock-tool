"""News coverage-volume signals (forward-context layer, Slice 3.1).

Nightly, for every WATCHLISTED security (across all owners, de-duplicated),
pull the trailing daily news-volume series from GDELT and detect a coverage
SPIKE — recent article count well above the name's own recent baseline. The
result upserts into news_signals and powers a "news spike" flag in the watchlist
"what's changed" digest ("which of my watched names is suddenly in the news").

CONTEXT ONLY — never feeds factor scores. Volume only: no tone/sentiment (free
per-company tone is a noisy, weak signal, deliberately not scored). GDELT is
free (no key) and rate-limited to ~1 req/5s, so calls go through
engine.news_narrative's global throttle; a GDELT outage is non-fatal.

    python scripts/ingest_news_signals.py
"""
from __future__ import annotations

import statistics
import sys
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import news_narrative  # noqa: E402
from engine.db import get_connection  # noqa: E402
from engine.jobs import finish_job, start_job  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

JOB_NAME = "news_signals"
JOB_VERSION = "v1"

# A name counts as spiking when its recent coverage is both meaningfully large
# (floor, so low-coverage names don't flag on noise) AND well above its own
# trailing baseline.
_SPIKE_RATIO = 3.0
_NEWS_FLOOR = 5
_MIN_BASELINE_DAYS = 7   # need enough history for a meaningful baseline


def _watchlisted(cur) -> list[tuple[int, str, str | None]]:
    """Distinct (security_id, ticker, name) for every watchlisted security across
    all owners — each fetched once regardless of how many users watch it."""
    cur.execute(
        """
        SELECT DISTINCT s.security_id, s.ticker, s.name
        FROM watchlist w
        JOIN securities s ON s.security_id = w.security_id
        ORDER BY s.ticker
        """
    )
    return [(sid, tk, nm) for sid, tk, nm in cur.fetchall()]


def _signal(series: list[tuple]) -> dict | None:
    """Compute the spike signal from an oldest-first (date, count) series.
    None when the series is too short for a baseline."""
    if len(series) < _MIN_BASELINE_DAYS + 2:
        return None
    values = [v for _, v in series]
    as_of = series[-1][0]
    latest = max(values[-2:])                    # recent burst (last ~2 days)
    prior = values[:-2]
    baseline = statistics.median(prior) if prior else None
    ratio = (latest / baseline) if baseline and baseline > 0 else None
    is_spike = bool(
        baseline is not None
        and latest >= _NEWS_FLOOR
        and ratio is not None
        and ratio >= _SPIKE_RATIO
    )
    return {
        "as_of": as_of, "latest": latest,
        "baseline": round(baseline, 2) if baseline is not None else None,
        "ratio": round(ratio, 2) if ratio is not None else None,
        "is_spike": is_spike,
    }


def _upsert(cur, security_id: int, sig: dict) -> None:
    cur.execute(
        """
        INSERT INTO news_signals
            (security_id, as_of_date, latest_count, baseline_median, ratio, is_spike, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (security_id) DO UPDATE SET
            as_of_date = EXCLUDED.as_of_date, latest_count = EXCLUDED.latest_count,
            baseline_median = EXCLUDED.baseline_median, ratio = EXCLUDED.ratio,
            is_spike = EXCLUDED.is_spike, updated_at = now()
        """,
        (security_id, sig["as_of"], sig["latest"], sig["baseline"], sig["ratio"], sig["is_spike"]),
    )


def run() -> dict:
    today = datetime.now(UTC).date()
    conn = get_connection()
    job_id = start_job(conn, JOB_NAME, job_version=JOB_VERSION, data_date=today)

    checked = spikes = fetch_failed = too_short = 0
    warnings: list[str] = []
    try:
        with conn.cursor() as cur:
            names = _watchlisted(cur)

        for security_id, _ticker, name in names:
            series = news_narrative.daily_volume(name)
            if series is None:
                fetch_failed += 1
                continue
            sig = _signal(series)
            if sig is None:
                too_short += 1
                continue
            with conn.cursor() as cur:
                _upsert(cur, security_id, sig)
            conn.commit()
            checked += 1
            if sig["is_spike"]:
                spikes += 1

        finish_job(conn, job_id, status="success", rows_affected=checked,
                   warnings=warnings or None)
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        finish_job(conn, job_id, status="failed", error=str(exc), warnings=warnings or None)
        conn.close()
        raise
    finally:
        if not conn.closed:
            conn.close()

    return {
        "watchlisted": len(names), "checked": checked, "spikes": spikes,
        "fetch_failed": fetch_failed, "too_short": too_short, "job_id": job_id,
    }


def main() -> int:
    s = run()
    print("\n=== News signals summary ===")
    print(f"  Watchlisted names : {s['watchlisted']}")
    print(f"  Checked/stored    : {s['checked']}")
    print(f"  Spikes flagged    : {s['spikes']}")
    print(f"  GDELT fetch-failed: {s['fetch_failed']}")
    print(f"  Too-short series  : {s['too_short']}")
    print(f"  job_runs id       : {s['job_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
