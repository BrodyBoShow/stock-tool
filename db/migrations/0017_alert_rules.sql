-- 0017_alert_rules.sql
-- Wave 5 — Alerts. User-configured rules that flag material changes on the
-- watchlist. Single-user stored state, like watchlist/theses/portfolio.
--
-- Rules are EVALUATED at read time against existing data (factor_scores history,
-- material_events, insider_transactions, theses) — nothing is written back to
-- pipeline tables, and there is no fired-alert log to keep in sync. An alert is
-- simply "this rule currently matches this watchlist name."
--
-- scope:
--   'watchlist' -> the rule applies to every watchlist name (security_id NULL)
--   'ticker'    -> the rule applies to one security (security_id required)
-- rule_type / threshold:
--   rank_drop      : universe rank worsened by > threshold places vs ~1mo ago
--   composite_drop : composite fell by > threshold points vs ~1mo ago
--   composite_rise : composite rose by > threshold points vs ~1mo ago
--   insider_buy    : any open-market insider buy in the last 3 months (no thresh)
--   new_8k         : a high-signal 8-K filed in the last 30 days (no thresh)
--   review_due     : a thesis review date is on/before today (no thresh)

CREATE TABLE IF NOT EXISTS alert_rules (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope        text NOT NULL CHECK (scope IN ('watchlist','ticker')),
  security_id  bigint REFERENCES securities(security_id),
  rule_type    text NOT NULL CHECK (rule_type IN
                 ('rank_drop','composite_drop','composite_rise',
                  'insider_buy','new_8k','review_due')),
  threshold    numeric(12,4),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'ticker') = (security_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules (enabled);

-- Sensible default watchlist-wide rules so the feature is useful immediately.
-- Idempotent: only seed when the table is empty (re-running won't duplicate).
INSERT INTO alert_rules (scope, rule_type, threshold)
SELECT * FROM (VALUES
  ('watchlist','rank_drop',      10::numeric),
  ('watchlist','composite_drop',  5::numeric),
  ('watchlist','insider_buy',     NULL::numeric),
  ('watchlist','new_8k',          NULL::numeric),
  ('watchlist','review_due',      NULL::numeric)
) AS v(scope, rule_type, threshold)
WHERE NOT EXISTS (SELECT 1 FROM alert_rules);
