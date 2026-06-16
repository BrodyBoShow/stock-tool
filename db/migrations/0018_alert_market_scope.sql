-- 0018_alert_market_scope.sql
-- Wave 5 follow-up: alerts scan the WHOLE MARKET, not just the watchlist.
-- The watchlist's "what's changed" digest already covers tracked names, so
-- alerts are repurposed as a market-wide signal scanner (biggest movers,
-- notable insider buys, high-signal 8-Ks across the universe).
--
-- Adds 'market' to the allowed scopes and migrates the existing default
-- watchlist-wide rules to market-wide. 'ticker' (one name) still supported.

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_scope_check;
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_scope_check
  CHECK (scope IN ('market', 'watchlist', 'ticker'));

UPDATE alert_rules SET scope = 'market' WHERE scope = 'watchlist';
