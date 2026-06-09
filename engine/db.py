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
    """
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy .env.example to .env and fill in "
            "your Supabase connection string."
        )
    # Supabase's transaction-mode pooler (port 6543) multiplexes server-side
    # backends, so psycopg3's automatic prepared statements collide across
    # runs (DuplicatePreparedStatement). Disabling them keeps the pooler happy.
    return psycopg.connect(database_url, prepare_threshold=None)


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
