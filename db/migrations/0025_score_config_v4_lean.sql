-- 0025_score_config_v4_lean.sql
-- Seed the v4_lean scoring config (a v3_pruned variant). Same factor weights as
-- v2/v3, but additionally drops the two sub-metrics the Phase-0 IC backtest scored
-- as PURE NOISE: `pe` (IC t=+0.1, sign flips across split-halves) from Value and
-- `r3m` (IC t=+0.1) from Momentum. Sub-metric list is in code
-- (engine.scoring.FACTOR_DEFS_V4_LEAN); this row exists for factor_scores' FK and
-- so a dormant A/B backtest (v3_pruned vs v4_lean) can score it. Dormant until
-- ACTIVE_CONFIG_VERSION flips — only if it clears the §6 gate vs v3_pruned.

INSERT INTO score_config (config_version, method, weights, metric_version, notes)
SELECT 'v4_lean', method, weights, metric_version,
       'v4 lean. v3_pruned plus drop pe (Value) and r3m (Momentum) — both IC '
       't~=+0.1 (pure noise) in the Phase-0 backtest. Sub-metric list in '
       'engine.scoring.FACTOR_DEFS_V4_LEAN.'
FROM score_config
WHERE config_version = 'v2_linear'
ON CONFLICT (config_version) DO NOTHING;
