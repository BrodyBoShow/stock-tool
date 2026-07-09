-- 0034: cache for the watchlist "what changed" AI narrative (redesign P4).
--
-- On-demand only (a user clicks "What changed?" on a name) and Haiku-cheap, but
-- we still cache so it bills AT MOST once per name per change in the underlying
-- signals: the row is keyed by security_id and carries a `fingerprint` (a hash
-- of the salient signals the narrative was written from). A request recomputes
-- the fingerprint; a match returns the cached text (no API call), a mismatch
-- regenerates. Global (not per-user) — the signals are public, so one call
-- serves everyone watching the name. Per [[ai-cost-posture]]: never bulk.
--
-- Additive, tiny table — safe on the MICRO tier.

CREATE TABLE IF NOT EXISTS watchlist_whats_changed (
    security_id   BIGINT PRIMARY KEY REFERENCES securities(security_id),
    fingerprint   TEXT NOT NULL,
    narrative     TEXT NOT NULL,
    model         TEXT,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
