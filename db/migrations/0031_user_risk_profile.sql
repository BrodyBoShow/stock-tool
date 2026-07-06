-- 0031: per-user risk profile (risk-personalization layer, PR2).
--
-- Stores each user's stated risk preference: quiz answers, the derived profile
-- (conservative|balanced|aggressive), the target band range their holdings are
-- compared against, and the alert thresholds that will replace the hardcoded
-- action-card constants (wired in PR3 — descriptive flags only, nothing is
-- enforced). One row per user; owner_id is the Supabase JWT sub (never a
-- request param — IDOR-safe pattern). The profile is a PREFERENCE SETTING the
-- user declares, not advice we compute; all derivation is a disclosed,
-- deterministic mapping (engine/risk_profile.py).

CREATE TABLE IF NOT EXISTS user_risk_profile (
    owner_id    UUID PRIMARY KEY,
    answers     JSONB,                        -- quiz answers {q1..q5: 1|2|3}; NULL on manual pick
    source      TEXT NOT NULL DEFAULT 'quiz'  -- quiz | manual
                CHECK (source IN ('quiz', 'manual')),
    profile     TEXT NOT NULL
                CHECK (profile IN ('conservative', 'balanced', 'aggressive')),
    band_min    SMALLINT NOT NULL,            -- holdings-fit band range (1..5)
    band_max    SMALLINT NOT NULL,
    guardrails  JSONB NOT NULL,               -- {max_position_pct, max_sector_pct}
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
