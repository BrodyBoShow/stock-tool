-- 0032_score_config_v6.sql
-- Seed the v6 momentum-candidate configs (both variants of a v5_qmean reshape).
-- Same factor weights as v2-v5; Growth/Value/Quality identical to v5_qmean. Only
-- the MOMENTUM factor's ranked sub-metric list changes, to reward "still trending,
-- good entry" over "already spiked": raw r6m includes the most recent month, so a
-- name that just ran up hard scores high even when 6-12mo forward upside is spent.
-- A multi-horizon rank-IC study (2022-26 monthly rebalances) found prox_52w
-- (nearness to the 52-week high) and pos_days (up-day fraction) rank forward returns
-- better than raw returns at 6-12mo, and that WITHIN the top momentum quintile,
-- near-52wk-high names beat far-below ones by ~9pp/yr.
--   v6_trend: Momentum = r12_1m + prox_52w + pos_days  (DROPS raw r6m)
--   v6_wide : Momentum = r6m + r12_1m + prox_52w + pos_days  (A/B foil, keeps r6m)
-- Sub-metric lists live in code (engine.scoring.FACTOR_DEFS_V6_TREND / _V6_WIDE);
-- these rows exist for factor_scores' FK and so a dormant A/B backtest can score
-- them. Dormant until ACTIVE_CONFIG_VERSION flips — only if a variant clears the
-- §6 gate vs v5_qmean (and, given the horizon mismatch, the 6-12mo evidence holds).

INSERT INTO score_config (config_version, method, weights, metric_version, notes)
SELECT 'v6_trend', method, weights, metric_version,
       'v6 trend momentum. v5_qmean but Momentum = r12_1m + prox_52w (52-week high '
       'proximity) + pos_days (up-day fraction); DROPS raw r6m (spike-prone: it '
       'includes the reversal-prone last month). Reward still-trending near-high '
       'names over already-spiked ones. Sub-metric list in '
       'engine.scoring.FACTOR_DEFS_V6_TREND.'
FROM score_config
WHERE config_version = 'v5_qmean'
ON CONFLICT (config_version) DO NOTHING;

INSERT INTO score_config (config_version, method, weights, metric_version, notes)
SELECT 'v6_wide', method, weights, metric_version,
       'v6 wide momentum. v5_qmean plus ADD prox_52w + pos_days to Momentum while '
       'keeping raw r6m (4 members). A/B foil for v6_trend to isolate whether '
       'dropping r6m helps. Sub-metric list in engine.scoring.FACTOR_DEFS_V6_WIDE.'
FROM score_config
WHERE config_version = 'v5_qmean'
ON CONFLICT (config_version) DO NOTHING;
