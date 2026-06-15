-- 0016_factor_scores_config_idx.sql
-- Index factor_scores for the config_version-leading reads on the hot paths.
--
-- Every screener and deep-dive request runs, per request:
--   SELECT max(score_date) FROM factor_scores WHERE config_version = %s
-- and the screener join also filters `score_date = %s AND config_version = %s`.
-- The existing indexes don't serve a config_version predicate:
--   - PK (security_id, score_date, config_version) leads with security_id.
--   - idx_scores_screen (score_date, composite DESC) has no config_version.
-- With two config versions coexisting per score_date (v1_linear + v2_linear),
-- those filters fell back to the (score_date, composite) index or a scan.
--
-- This index leads with config_version, then score_date DESC, so it serves both
-- the max(score_date) probe and the screener's date+version filter directly.
-- (Audit finding DB-1, reports/cleanup_audit.md.)
--
-- Apply manually in the Supabase SQL editor (per CONVENTIONS.md — the assistant
-- never runs DDL). CONCURRENTLY avoids locking the table during the build.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_config_date
    ON factor_scores (config_version, score_date DESC);
