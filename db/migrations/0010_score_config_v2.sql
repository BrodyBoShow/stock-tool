-- 0010_score_config_v2.sql
-- Scoring v2 (v2_linear): same four factors and weights as v1, but the Quality
-- factor gains three documented sub-signals and Momentum switches to the
-- 12-minus-1 construction. Weights unchanged so the change is attributable to
-- the richer factor composition, not a re-weighting. v1_linear stays for
-- side-by-side comparison.

INSERT INTO score_config (config_version, method, weights, metric_version, notes) VALUES
  ('v2_linear', 'linear',
   '{"growth": 0.30, "quality": 0.25, "value": 0.20, "momentum": 0.25}'::jsonb,
   'v1',
   'v2 linear. Same weights as v1_linear; Quality adds accruals (Sloan, '
   'lower=better), share_count_trend (net issuance, lower=better) and '
   'insider_net_buy (discretionary Form 4 net buys / mktcap, higher=better, '
   'sparse). Momentum uses 12-minus-1 (skip last month) in place of raw r12m.')
ON CONFLICT (config_version) DO UPDATE
  SET method         = EXCLUDED.method,
      weights        = EXCLUDED.weights,
      metric_version = EXCLUDED.metric_version,
      notes          = EXCLUDED.notes;
