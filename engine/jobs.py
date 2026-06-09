"""Job-run logging helpers.

Per CONVENTIONS.md, every scheduled job logs to the job_runs table.
start_job() inserts a 'running' row and returns its id; finish_job()
stamps the outcome. Reused by every ingestion/scoring job.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

import psycopg


def start_job(
    conn: psycopg.Connection,
    job_name: str,
    *,
    job_version: str | None = None,
    params: dict[str, Any] | None = None,
    data_date: date | None = None,
) -> int:
    """Insert a 'running' job_runs row and return its id."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO job_runs (job_name, job_version, params, data_date, status)
            VALUES (%s, %s, %s, %s, 'running')
            RETURNING id
            """,
            (
                job_name,
                job_version,
                json.dumps(params) if params is not None else None,
                data_date,
            ),
        )
        job_id = cur.fetchone()[0]
    conn.commit()
    return job_id


def finish_job(
    conn: psycopg.Connection,
    job_id: int,
    *,
    status: str,
    rows_affected: int | None = None,
    warnings: list[Any] | dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """Stamp a job_runs row with its final status and counters."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE job_runs
            SET finished_at   = now(),
                status        = %s,
                rows_affected = %s,
                warnings      = %s,
                error         = %s
            WHERE id = %s
            """,
            (
                status,
                rows_affected,
                json.dumps(warnings) if warnings is not None else None,
                error,
                job_id,
            ),
        )
    conn.commit()
