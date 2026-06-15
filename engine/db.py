"""Database connectivity for the Stock-Tool engine.

Loads DATABASE_URL from .env and provides psycopg connections to the Supabase
Postgres database, plus a simple healthcheck.

Two connection sources, by caller:
- `get_connection()` — a fresh, fully-hardened connection. Used by the
  long-running engine batch jobs (metrics/scoring/fundamentals/prices/…), which
  hold a connection for many minutes and refresh it with `reopen()`. Unchanged.
- `acquire()` / `release()` — a pooled connection for the API read path. The API
  serves many short-lived reads; opening a fresh Supabase connection per request
  costs ~0.75 s (TLS handshake + the timeout-verify round-trips). The pool reuses
  warm connections so each read pays only its query time. The pool is opened once
  at API startup via `init_pool()`; when it is not open (engine jobs, scripts),
  `acquire()`/`release()` transparently fall back to fresh connect/close, so this
  module behaves exactly as before outside the API process.
"""

from __future__ import annotations

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg_pool import ConnectionPool

# Load .env from the project root (one level above this file's directory).
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# Connection hardening, shared by get_connection() and the pool:
# - prepare_threshold=None  : disables psycopg3 auto-prepared statements,
#                             required for Supabase's transaction-mode pooler.
# - TCP keepalives           : detect half-open connections within ~60 s
#                             (idle=30, interval=10, count=5) rather than hanging.
# - connect_timeout=10       : fail fast if the server is unreachable.
# - statement_timeout 120 s + idle_in_transaction 60 s via startup options.
_CONNECT_KWARGS: dict = {
    "prepare_threshold": None,
    "keepalives": 1,
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 5,
    "connect_timeout": 10,
    "options": "-c statement_timeout=120000 -c idle_in_transaction_session_timeout=60000",
}


def _database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy .env.example to .env and fill in "
            "your Supabase connection string."
        )
    return url


def _apply_session_timeouts(conn: psycopg.Connection, *, announce: bool) -> None:
    """Verify the statement/idle timeouts took; Supabase's transaction-mode
    pooler (PgBouncer) may strip startup `options`, so fall back to explicit
    SET. With the pool this runs once per physical connection (announce=False);
    get_connection() runs it per call and announces the source for CI logs."""
    with conn.cursor() as cur:
        cur.execute("SHOW statement_timeout")
        st = cur.fetchone()[0]
        cur.execute("SHOW idle_in_transaction_session_timeout")
        itt = cur.fetchone()[0]
        st_src = "options"
        if st in ("0", "0ms"):  # options did not propagate — SET fallback
            cur.execute("SET statement_timeout = 120000")
            st_src = "SET fallback"
        itt_src = "options"
        if itt in ("0", "0ms"):
            cur.execute("SET idle_in_transaction_session_timeout = 60000")
            itt_src = "SET fallback"
    conn.commit()
    if announce:
        print(
            f"[db] statement_timeout={st} ({st_src})  "
            f"idle_in_transaction_session_timeout={itt} ({itt_src})",
            flush=True,
        )


def get_connection() -> psycopg.Connection:
    """Return a new, fully-hardened psycopg connection (see module docstring).

    Reads DATABASE_URL from the environment. Raises RuntimeError if it is unset.
    Used by the long-running engine jobs; behavior is unchanged from before the
    pool was added.
    """
    conn = psycopg.connect(_database_url(), **_CONNECT_KWARGS)
    _apply_session_timeouts(conn, announce=True)
    return conn


# --- API read-path connection pool -------------------------------------------
# Lazily opened by the API at startup; None in engine-job / script processes.
_pool: ConnectionPool | None = None


def init_pool(min_size: int = 1, max_size: int = 8) -> None:
    """Open the API read pool (idempotent). Called once at FastAPI startup.

    Each pooled connection is configured with the same session timeouts as
    get_connection(), applied once at creation (not per request)."""
    global _pool
    if _pool is not None:
        return
    pool = ConnectionPool(
        _database_url(),
        min_size=min_size,
        max_size=max_size,
        kwargs=_CONNECT_KWARGS,
        configure=lambda conn: _apply_session_timeouts(conn, announce=False),
        open=False,
        name="stockbud-api-read",
    )
    pool.open(wait=True, timeout=15)
    _pool = pool
    print(f"[db] read pool open (min={min_size}, max={max_size})", flush=True)


def close_pool() -> None:
    """Close the read pool (called at FastAPI shutdown)."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def acquire() -> psycopg.Connection:
    """Borrow a connection: from the pool if open, else a fresh hardened one.

    Callers MUST pair this with release() in a finally block. Returning a
    connection mid-transaction is safe — the pool rolls back on release."""
    if _pool is not None:
        return _pool.getconn()
    return get_connection()


def release(conn: psycopg.Connection | None) -> None:
    """Return a connection borrowed via acquire() (best-effort)."""
    if conn is None:
        return
    if _pool is not None:
        try:
            _pool.putconn(conn)
            return
        except Exception:  # noqa: BLE001 — fall through to a plain close
            pass
    try:
        conn.close()
    except Exception:  # noqa: BLE001
        pass


def reopen(conn: psycopg.Connection | None) -> psycopg.Connection:
    """Close a possibly-stale connection best-effort and return a fresh one.

    On Windows, libpq ignores fine-grained TCP keepalives and tcp_user_timeout
    is Linux-only, so when the Supabase pooler (or a network blip) drops a
    connection the next use can block inside a socket read with no timeout.
    Long-running jobs therefore never trust a long-lived or recently-idle
    connection — they call this instead of hanging.
    """
    try:
        if conn is not None and not conn.closed:
            conn.close()
    except Exception:  # noqa: BLE001
        pass
    return get_connection()


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
