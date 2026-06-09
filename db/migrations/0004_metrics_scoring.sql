-- 0004_metrics_scoring.sql
-- Versioned metric definitions, derived metrics, scoring config, factor scores.

-- Versioned definitions of derived metrics (so old scores stay explainable
-- if ROIC/FCF/EBITDA logic changes).
CREATE TABLE metric_config (
  metric_version text PRIMARY KEY,        -- 'v1'
  definitions    jsonb NOT NULL,          -- inputs/formulas per metric
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Derived metrics, point-in-time-correct and version-stamped.
CREATE TABLE fundamental_metrics (
  security_id    bigint NOT NULL REFERENCES securities(security_id),
  as_of_date     date NOT NULL,
  metric         text NOT NULL,           -- ttm_revenue, gross_margin, roic, net_debt_ebitda...
  value          numeric(28,6),
  metric_version text NOT NULL REFERENCES metric_config(metric_version),
  PRIMARY KEY (security_id, as_of_date, metric, metric_version)
);

-- Scoring config: supports linear weights now AND a model reference later.
CREATE TABLE score_config (
  config_version text PRIMARY KEY,        -- 'v1_linear', 'v2_model'
  method         text NOT NULL DEFAULT 'linear',  -- 'linear' | 'model'
  weights        jsonb,                   -- used when method='linear'
  model_ref      text,                    -- artifact path/version when method='model'
  metric_version text REFERENCES metric_config(metric_version),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Factor scores (wide — screener queries this heavily).
CREATE TABLE factor_scores (
  security_id    bigint NOT NULL REFERENCES securities(security_id),
  score_date     date NOT NULL,
  config_version text NOT NULL REFERENCES score_config(config_version),
  growth_pctl    numeric(5,2),            -- cross-sectional percentile within universe
  value_pctl     numeric(5,2),
  quality_pctl   numeric(5,2),
  momentum_pctl  numeric(5,2),
  composite      numeric(7,4),
  details        jsonb,                   -- raw inputs for transparency on the deep-dive page
  PRIMARY KEY (security_id, score_date, config_version)
);
CREATE INDEX idx_scores_screen ON factor_scores (score_date, composite DESC);
