-- 0026_score_config_v5_qmean.sql
-- Seed the v5_qmean scoring config (a v4_lean variant). Same factor weights as
-- v2/v3/v4, but carries the Phase-0 pruning INTO the Quality factor mean: drops the
-- three measured-noise members v4_lean still averages into Quality —
-- `gross_margin` (IC t=-0.5), `debt_to_equity` (t=-1.7), `net_debt_ebitda` (t=0.6)
-- — leaving the three that actually predict (operating_margin t=3.8, roic t=5.3,
-- share_count_trend t=6.5). Sub-metric list lives in code
-- (engine.scoring.FACTOR_DEFS_V5_QMEAN); this row exists for factor_scores' FK and
-- so a dormant A/B backtest (v4_lean vs v5_qmean) can score it. The dropped metrics
-- stay computed in fundamental_metrics and shown on the deep-dive — only removed
-- from the ranked Quality mean. Dormant until ACTIVE_CONFIG_VERSION flips — only if
-- it clears the §6 gate vs v4_lean (parity-or-better; subtraction tie-break).

INSERT INTO score_config (config_version, method, weights, metric_version, notes)
SELECT 'v5_qmean', method, weights, metric_version,
       'v5 quality-mean. v4_lean plus drop gross_margin / debt_to_equity / '
       'net_debt_ebitda from the Quality MEAN — all measured-noise (IC |t|<1.7) and '
       'survivorship-suspect leverage/distress metrics. Quality = operating_margin '
       '+ roic + share_count_trend. Sub-metric list in '
       'engine.scoring.FACTOR_DEFS_V5_QMEAN.'
FROM score_config
WHERE config_version = 'v4_lean'
ON CONFLICT (config_version) DO NOTHING;
