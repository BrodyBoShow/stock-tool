-- Phase 11b: stored backtest runs for the Lab page.
-- The backtest takes ~45 min (47 as-of re-scores of the full universe), so the
-- UI never computes it: the monthly workflow runs it with --store and the Lab
-- page renders the latest row. Results (curves, bucket stats, benchmarks) are
-- one self-contained jsonb document per run.

CREATE TABLE IF NOT EXISTS backtest_results (
    backtest_id    bigserial PRIMARY KEY,
    config_version text        NOT NULL,
    generated_at   timestamptz NOT NULL DEFAULT now(),
    start_date     date        NOT NULL,
    end_date       date        NOT NULL,
    params         jsonb       NOT NULL,
    results        jsonb       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backtest_latest
    ON backtest_results (config_version, generated_at DESC);
