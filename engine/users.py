"""Per-user provisioning for multi-tenancy.

When a new user first authenticates, they get the same sensible default
watchlist alert rules that the single-user build seeded globally in migration
0017. That global seed is being retired; this provisions them per-user instead.

Called lazily (e.g. on the first authenticated alerts read) once routers carry
the user id — Phase 3. Idempotent: a no-op for users who already have rules.
"""
from __future__ import annotations

from engine.db import acquire, release

# Mirrors the original global seed (migration 0017), now applied per-user.
_DEFAULT_ALERT_RULES: tuple[tuple[str, str, float | None], ...] = (
    ("watchlist", "rank_drop", 10.0),
    ("watchlist", "composite_drop", 5.0),
    ("watchlist", "insider_buy", None),
    ("watchlist", "new_8k", None),
    ("watchlist", "review_due", None),
)


def provision_user(owner_id: str) -> bool:
    """Seed a new user's default watchlist alert rules. Idempotent.

    Returns True if defaults were created, False if the user already had rules.
    Safe to call on every authenticated request.
    """
    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM alert_rules WHERE owner_id = %s LIMIT 1", (owner_id,)
            )
            if cur.fetchone() is not None:
                return False
            cur.executemany(
                "INSERT INTO alert_rules (owner_id, scope, rule_type, threshold) "
                "VALUES (%s, %s, %s, %s)",
                [(owner_id, scope, rtype, thr) for (scope, rtype, thr) in _DEFAULT_ALERT_RULES],
            )
        conn.commit()
        return True
    finally:
        release(conn)
