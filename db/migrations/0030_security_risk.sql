-- 0030: per-security historical risk measurements (risk-personalization layer).
--
-- CONTEXT ONLY — descriptive, backward-looking measurements (realized volatility,
-- market beta, drawdown over the trailing year). Never feeds factor scores,
-- ranks, or alerts; attached to screener rows AFTER ranking (same contract as
-- the commodity/news context tables). Latest-only: one row per security,
-- upserted nightly by engine/risk_metrics.py (~5.5k rows — MICRO-tier trivial).
--
-- Honesty: risk_band is NULL when the name has under one year of trading
-- history (band_reason says why) — never estimated or defaulted.

CREATE TABLE IF NOT EXISTS security_risk (
    security_id         INTEGER PRIMARY KEY REFERENCES securities(security_id) ON DELETE CASCADE,
    as_of_date          DATE NOT NULL,             -- last price date the window ends on (run date if no prices)
    vol_252d            NUMERIC,                   -- annualized std of daily returns
    downside_vol_252d   NUMERIC,                   -- annualized semi-deviation (negative days)
    beta_vs_spy         NUMERIC,                   -- pairwise beta, >=200 overlapping obs
    max_drawdown_1y     NUMERIC,                   -- peak-to-trough over the window (<= 0)
    size_bucket         TEXT,                      -- mega|large|mid|small|micro; NULL = cap unknown
    balance_sheet_flags JSONB,                     -- descriptive booleans (high_leverage, ...)
    risk_score          NUMERIC,                   -- 0-100 universe-percentile composite (sort only)
    risk_band           SMALLINT,                  -- 1..5; NULL when insufficient history
    band_reason         TEXT NOT NULL DEFAULT 'ok',-- ok|insufficient_history|no_prices
    inputs              JSONB,                     -- provenance: obs count, thresholds_version, modifiers
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
