"""Database connectivity for the Stock-Tool engine.

Loads DATABASE_URL from .env and provides a psycopg connection to the
Supabase Postgres database, plus a simple healthcheck.
"""

from __future__ import annotations

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

# Load .env from the project root (one level above this file's directory).
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")


def get_connection() -> psycopg.Connection:
    """Return a new psycopg connection to the Supabase Postgres database.

    Reads DATABASE_URL from the environment (populated from .env).
    Raises RuntimeError if DATABASE_URL is missing or empty.

    Connection hardening applied on every call:
    - prepare_threshold=None  : disables psycopg3 auto-prepared statements,
                                required for Supabase's transaction-mode pooler.
    - TCP keepalives           : detect half-open connections within ~60 s
                                (idle=30, interval=10, count=5) rather than
                                hanging indefinitely when the link goes silent.
    - connect_timeout=10       : fail fast if the server is unreachable.
    - statement_timeout        : 120 s ceiling on any single query.
    - idle_in_transaction_session_timeout : 60 s — Postgres itself terminates
                                transactions left idle (the direct cause of the
                                2026-06-10 metrics hang).
    """
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy .env.example to .env and fill in "
            "your Supabase connection string."
        )
    conn = psycopg.connect(
        database_url,
        prepare_threshold=None,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
        connect_timeout=10,
        options="-c statement_timeout=120000 -c idle_in_transaction_session_timeout=60000",
    )

    # Verify the session timeouts took; Supabase's transaction-mode pooler
    # (PgBouncer) may strip options startup parameters, in which case fall back
    # to explicit SET statements.  Print the source so it's visible in CI logs.
    with conn.cursor() as cur:
        cur.execute("SHOW statement_timeout")
        st = cur.fetchone()[0]
        cur.execute("SHOW idle_in_transaction_session_timeout")
        itt = cur.fetchone()[0]
        # "0" / "0ms" means no limit — options did not propagate; use SET fallback.
        st_src = "options"
        if st in ("0", "0ms"):
            cur.execute("SET statement_timeout = 120000")
            st_src = "SET fallback"
        itt_src = "options"
        if itt in ("0", "0ms"):
            cur.execute("SET idle_in_transaction_session_timeout = 60000")
            itt_src = "SET fallback"
    conn.commit()

    print(
        f"[db] statement_timeout={st} ({st_src})  "
        f"idle_in_transaction_session_timeout={itt} ({itt_src})",
        flush=True,
    )
    return conn


def healthcheck() -> bool:
    """Run `SELECT 1` against the database and return True on success.

    Returns False if the connection or query fails for any reason.
    """
    try:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            row = cur.fetchone()
            return row is not None and row[0] == 1
    except Exception:
        return False
