-- 0024_score_config_v3_pruned.sql
-- Seed the v3_pruned scoring config. Same FACTOR weights as v2_linear, but the
-- Quality factor drops two sub-signals the Phase-0 per-sub-metric IC backtest
-- (v2_linear, 47 months 2022-26) disqualified:
--   * accruals       — PREDICTIVE BUT WRONG-SIGNED (IC t=-4.1, negative in BOTH
--                       split-halves): the Sloan low-accruals premium is inverted
--                       in this survivor universe, so it was dragging Quality.
--   * insider_net_buy — INSUFFICIENT DATA (median 0 valid names/month, too sparse).
-- The factor weights are unchanged, so they're cloned from v2_linear. The actual
-- sub-metric LIST lives in code (engine.scoring.FACTOR_DEFS_V3_PRUNED); this row
-- exists only because factor_scores.config_version has a FK to score_config.
-- Dormant until engine.queries.ACTIVE_CONFIG_VERSION flips to 'v3_pruned'.

INSERT INTO score_config (config_version, method, weights, metric_version, notes)
SELECT 'v3_pruned', method, weights, metric_version,
       'v3 pruned. Same weights as v2_linear; Quality drops accruals '
       '(wrong-signed in the Phase-0 backtest, IC t=-4.1) and insider_net_buy '
       '(insufficient data, median 0 valid names/mo). Sub-metric list in '
       'engine.scoring.FACTOR_DEFS_V3_PRUNED.'
FROM score_config
WHERE config_version = 'v2_linear'
ON CONFLICT (config_version) DO NOTHING;
