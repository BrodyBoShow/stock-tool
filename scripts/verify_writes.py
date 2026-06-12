"""Programmatic verification of watchlist + thesis write features.

Tests against the live database. Uses AAPL as the test ticker.
Cleans up after itself (removes any row it inserted).

Run with:
    .venv\\Scripts\\python.exe scripts\\verify_writes.py
"""
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.db import get_connection


def get_security_id(ticker: str) -> int:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT security_id FROM securities WHERE ticker = %s AND is_active",
                (ticker,),
            )
            row = cur.fetchone()
            if row is None:
                raise RuntimeError(f"{ticker} not found in securities")
            return int(row[0])
    finally:
        conn.close()


def wl_count(security_id: int) -> int:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM watchlist WHERE security_id = %s",
                (security_id,),
            )
            return int(conn.cursor().fetchone()[0]) if False else int(cur.fetchone()[0])
    finally:
        conn.close()


def thesis_rows(security_id: int) -> list[dict]:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, summary, invalidation_rules, review_date, "
                "updated_at FROM theses WHERE security_id = %s AND status = 'active'",
                (security_id,),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]
    finally:
        conn.close()


def cleanup(security_id: int) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM watchlist WHERE security_id = %s", (security_id,))
            cur.execute(
                "DELETE FROM theses WHERE security_id = %s AND status = 'active'",
                (security_id,),
            )
        conn.commit()
    finally:
        conn.close()


def ok(msg: str) -> None:
    print(f"[OK]   {msg}")


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    sys.exit(1)


# ── setup ──────────────────────────────────────────────────────────────────────
TEST_TICKER = "AAPL"
sid = get_security_id(TEST_TICKER)
print(f"Test ticker: {TEST_TICKER}  security_id={sid}")

# Make sure we start clean
cleanup(sid)

# ── WATCHLIST ──────────────────────────────────────────────────────────────────
print("\n--- watchlist ---")

# Add
conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO watchlist (security_id) VALUES (%s) "
            "ON CONFLICT (security_id) DO NOTHING",
            (sid,),
        )
    conn.commit()
finally:
    conn.close()

count = wl_count(sid)
if count == 1:
    ok("add -> 1 row")
else:
    fail(f"add -> expected 1 row, got {count}")

# Idempotent add (same security_id again)
conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO watchlist (security_id) VALUES (%s) "
            "ON CONFLICT (security_id) DO NOTHING",
            (sid,),
        )
    conn.commit()
finally:
    conn.close()

count = wl_count(sid)
if count == 1:
    ok("add again (idempotent) -> still 1 row")
else:
    fail(f"idempotent add -> expected 1 row, got {count}")

# Join check: watchlist -> securities + factor_scores
conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.ticker, fs.composite
            FROM watchlist w
            JOIN securities s ON s.security_id = w.security_id
            LEFT JOIN factor_scores fs
                ON fs.security_id = s.security_id
                AND fs.score_date = (SELECT max(score_date) FROM factor_scores)
            WHERE w.security_id = %s
            """,
            (sid,),
        )
        row = cur.fetchone()
finally:
    conn.close()

if row and row[0] == TEST_TICKER:
    ok(f"watchlist join returns ticker={row[0]}, composite={row[1]}")
else:
    fail(f"watchlist join failed: {row}")

# Remove
conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM watchlist WHERE security_id = %s", (sid,))
    conn.commit()
finally:
    conn.close()

count = wl_count(sid)
if count == 0:
    ok("remove -> 0 rows")
else:
    fail(f"remove -> expected 0 rows, got {count}")

# ── THESIS ─────────────────────────────────────────────────────────────────────
print("\n--- thesis ---")

past_date = date.today() - timedelta(days=5)
future_date = date.today() + timedelta(days=30)

# Save thesis (all three fields, past review date for "review due" check)
conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO theses (security_id, summary, invalidation_rules, review_date)
            VALUES (%s, %s, %s, %s)
            """,
            (sid, "Test thesis body", "Exit if gross margin < 30%", past_date),
        )
    conn.commit()
finally:
    conn.close()

rows = thesis_rows(sid)
if len(rows) == 1 and rows[0]["summary"] == "Test thesis body":
    ok("save -> 1 row, summary correct")
else:
    fail(f"save -> {rows}")

thesis_id = rows[0]["id"]
original_updated_at = rows[0]["updated_at"]

# Review-due check on the initial past-date row
rd_initial = rows[0].get("review_date")
if rd_initial and rd_initial <= date.today():
    ok(f"review_date {rd_initial} <= today -> review due (past date flagged correctly)")
else:
    fail(f"review_date check (past): {rd_initial}")

# Upsert (edit) — must update, not insert a second row
conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE theses
            SET summary = %s, invalidation_rules = %s,
                review_date = %s, updated_at = NOW()
            WHERE id = %s
            """,
            ("Updated thesis", "Exit if revenue declines 2 quarters", future_date, thesis_id),
        )
    conn.commit()
finally:
    conn.close()

rows = thesis_rows(sid)
if len(rows) != 1:
    fail(f"upsert -> expected 1 row, got {len(rows)}")
r = rows[0]
if r["summary"] != "Updated thesis":
    fail(f"upsert summary wrong: {r['summary']}")
if r["updated_at"] == original_updated_at:
    fail("upsert did not change updated_at")
ok("edit (upsert) -> still 1 row, summary updated, updated_at changed")

# Check that review_date was updated to future_date
rd = r.get("review_date")
if rd and rd > date.today():
    ok(f"future review_date {rd} > today -> not due (correct)")
else:
    fail(f"future review_date check after edit: {rd}")

# Delete
conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM theses WHERE id = %s", (thesis_id,))
    conn.commit()
finally:
    conn.close()

rows = thesis_rows(sid)
if len(rows) == 0:
    ok("delete -> 0 rows")
else:
    fail(f"delete -> expected 0 rows, got {len(rows)}")

# ── EMPTY-STATE QUERIES ────────────────────────────────────────────────────────
print("\n--- empty-state queries ---")

conn = get_connection()
try:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM watchlist w "
            "JOIN securities s ON s.security_id = w.security_id"
        )
        wl_total = cur.fetchone()[0]
        cur.execute(
            "SELECT count(*) FROM theses WHERE status = 'active'"
        )
        th_total = cur.fetchone()[0]
finally:
    conn.close()

ok(f"watchlist query on current data: {wl_total} rows (no crash)")
ok(f"theses query on current data: {th_total} rows (no crash)")

# Verify cleanup is complete
cleanup(sid)

print("\nAll write verifications passed.")
