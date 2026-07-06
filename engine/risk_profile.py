"""Per-user risk profile (risk-personalization layer, PR2).

The user's stated risk preference: a 5-question quiz (or a direct manual pick)
maps DETERMINISTICALLY to conservative / balanced / aggressive, a target
band range their holdings are compared against (bands from
engine/risk_metrics.py), an ideas band range for discovery, and the alert
thresholds that will replace the hardcoded action-card constants in
engine/portfolio.py (wired in PR3 — nothing consumes the profile yet).

Honesty contract:
  * This is a PREFERENCE SETTING the user declares — not advice, not an
    assessment we compute about them. The full mapping table below — including
    the ideas band range — is shown in the quiz's result screen ("how we
    mapped your answers"), so nothing about the setting is hidden.
  * "Guardrails" are ALERT THRESHOLDS driving descriptive flags — StockBud
    never enforces or blocks anything; user-facing copy must say "flags", not
    imply enforcement.
  * The Balanced guardrails equal the pre-existing hardcoded constants
    (POSITION_WEIGHT_FLAG=0.15 / SECTOR_WEIGHT_FLAG=0.40), so a user with no
    profile — or a Balanced one — sees byte-identical action-card behavior.
  * Band 5 (Speculative) is inside no profile's target range.

Quiz: 5 questions, each answer scores 1-3 points, sum 5-15:
  q1 horizon      when will you need this money?   <3y=1  3-10y=2  10y+=3
  q2 drawdown     portfolio drops 25% — you...     sell=1 hold=2   add=3
  q3 reliance     how much do you rely on it?      soon=1 partly=2 long time=3
  q4 experience   investing experience             new=1  few yrs=2 seasoned=3
  q5 goal         primary goal                     preserve=1 steady=2 maximize=3

  sum 5-8  -> conservative: fit bands 1-2, ideas 1-2, max_pos 10%, max_sector 30%
  sum 9-12 -> balanced:     fit bands 1-3, ideas 2-3, max_pos 15%, max_sector 40%
  sum 13+  -> aggressive:   fit bands 1-4, ideas 3-4, max_pos 20%, max_sector 50%
"""
from __future__ import annotations

from typing import Any

from engine.db import acquire, release

QUIZ_KEYS = ("q1", "q2", "q3", "q4", "q5")

# profile -> (band_min, band_max, ideas_min, ideas_max, max_position, max_sector)
PROFILES: dict[str, dict[str, Any]] = {
    "conservative": {
        "band_min": 1, "band_max": 2, "ideas_min": 1, "ideas_max": 2,
        "guardrails": {"max_position_pct": 0.10, "max_sector_pct": 0.30},
    },
    "balanced": {
        # Guardrails equal engine/portfolio.py's hardcoded constants — the
        # no-profile fallback stays byte-identical by construction.
        "band_min": 1, "band_max": 3, "ideas_min": 2, "ideas_max": 3,
        "guardrails": {"max_position_pct": 0.15, "max_sector_pct": 0.40},
    },
    "aggressive": {
        "band_min": 1, "band_max": 4, "ideas_min": 3, "ideas_max": 4,
        "guardrails": {"max_position_pct": 0.20, "max_sector_pct": 0.50},
    },
}


def score_answers(answers: dict[str, Any]) -> int:
    """Sum the 5 quiz answers (each 1-3). Raises ValueError on a malformed set
    — the API layer converts that to a 422."""
    if set(answers) != set(QUIZ_KEYS):
        raise ValueError(f"answers must contain exactly {QUIZ_KEYS}")
    total = 0
    for k in QUIZ_KEYS:
        v = answers[k]
        if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 3:
            raise ValueError(f"{k} must be an integer 1-3")
        total += v
    return total


def profile_for_score(total: int) -> str:
    if total <= 8:
        return "conservative"
    if total <= 12:
        return "balanced"
    return "aggressive"


def derive_profile(
    answers: dict[str, Any] | None = None, profile: str | None = None
) -> dict[str, Any]:
    """Deterministic quiz->profile mapping (or validate a manual pick).
    Exactly one of `answers` / `profile` must be provided."""
    if (answers is None) == (profile is None):
        raise ValueError("provide exactly one of answers or profile")
    if answers is not None:
        name = profile_for_score(score_answers(answers))
        source = "quiz"
    else:
        if profile not in PROFILES:
            raise ValueError(f"unknown profile {profile!r}")
        name = profile
        source = "manual"
    p = PROFILES[name]
    return {
        "profile": name,
        "source": source,
        "answers": answers,
        "band_min": p["band_min"],
        "band_max": p["band_max"],
        "ideas_min": p["ideas_min"],
        "ideas_max": p["ideas_max"],
        "guardrails": dict(p["guardrails"]),
    }


def get_profile(owner_id: str) -> dict[str, Any] | None:
    """The stored profile for one user, or None. Never raises on a missing
    ROW or a missing TABLE (pre-migration environment) — callers (incl.
    compute_portfolio in PR3) degrade to the built-in defaults on None."""
    import psycopg.errors

    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT answers, source, profile, band_min, band_max,
                       guardrails, updated_at
                FROM user_risk_profile WHERE owner_id = %s
                """,
                (owner_id,),
            )
            row = cur.fetchone()
    except psycopg.errors.UndefinedTable:
        return None
    finally:
        release(conn)
    if row is None:
        return None
    answers, source, name, band_min, band_max, guardrails, updated_at = row
    p = PROFILES.get(name, PROFILES["balanced"])
    return {
        "profile": name,
        "source": source,
        "answers": answers,
        "band_min": int(band_min),
        "band_max": int(band_max),
        "ideas_min": p["ideas_min"],
        "ideas_max": p["ideas_max"],
        "guardrails": guardrails,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


def upsert_profile(owner_id: str, derived: dict[str, Any]) -> None:
    """Store a derive_profile() result for one user (one row per owner)."""
    import json

    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_risk_profile
                    (owner_id, answers, source, profile, band_min, band_max,
                     guardrails, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (owner_id) DO UPDATE SET
                    answers = EXCLUDED.answers, source = EXCLUDED.source,
                    profile = EXCLUDED.profile, band_min = EXCLUDED.band_min,
                    band_max = EXCLUDED.band_max, guardrails = EXCLUDED.guardrails,
                    updated_at = now()
                """,
                (
                    owner_id,
                    json.dumps(derived["answers"]) if derived["answers"] else None,
                    derived["source"], derived["profile"],
                    derived["band_min"], derived["band_max"],
                    json.dumps(derived["guardrails"]),
                ),
            )
        conn.commit()
    finally:
        release(conn)
