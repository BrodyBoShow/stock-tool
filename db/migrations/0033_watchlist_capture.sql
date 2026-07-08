-- 0033: watchlist decision-plan capture (watchlist redesign P2b).
--
-- Per-watch-entry fields that turn a passive list into a decision pipeline:
-- a freeform note, an optional entry target price (powers the "% to entry"
-- gauge), and pre-registered entry/kill criteria — the "set your kill criteria
-- at the moment you start watching, when you're least emotionally invested"
-- discipline (Annie Duke). All nullable and owner-scoped via the existing
-- watchlist row (owner_id from the JWT; never a request param — IDOR-safe).
-- These are the user's own PLAN, not advice we compute.
--
-- Additive, metadata-only ALTER on a tiny per-user table — safe on the MICRO
-- tier (no row rewrite, no meaningful lock).

ALTER TABLE watchlist
    ADD COLUMN IF NOT EXISTS note            TEXT,
    ADD COLUMN IF NOT EXISTS target_price    NUMERIC,
    ADD COLUMN IF NOT EXISTS entry_trigger   TEXT,
    ADD COLUMN IF NOT EXISTS kill_criteria   TEXT,
    ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;
