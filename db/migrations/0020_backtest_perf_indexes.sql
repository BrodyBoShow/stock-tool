-- 0020_backtest_perf_indexes.sql
-- Indexes that turn the backtest's full-universe loader queries from seq-scans
-- of multi-million-row tables into index scans. The point-in-time backtest
-- re-scores ~48 months, so each of these queries runs ~48x; without these the
-- run exceeds the statement timeout at depth.
--
-- APPLY MANUALLY in the Supabase dashboard SQL editor (a DIRECT/session
-- connection — NOT the transaction-mode pooler), ONE statement at a time:
--   * CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and the
--     transaction pooler does not handle it. The dashboard editor is the safe place.
--   * Before #1 and #2 (largest tables) raise the editor's timeout for the build:
--       SET statement_timeout = '600000';
--   * Verify each built valid afterwards:
--       SELECT indexrelid::regclass AS index, indisvalid FROM pg_index
--       WHERE indexrelid::regclass::text LIKE 'idx_%';
--     A false indisvalid means a failed concurrent build — DROP INDEX CONCURRENTLY
--     that one and re-run.
-- If you can only apply one, apply #1 (largest table, worst query).

-- 1. xbrl_facts (LARGEST table). _load_score_time_fundamentals filters
--    normalized_concept = ANY(...) AND filed_date <= as_of with NO security_id;
--    both existing indexes lead with security_id, so this is a full seq-scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_facts_norm_filed
    ON xbrl_facts (normalized_concept, filed_date)
    INCLUDE (security_id, concept, unit, value, period_start, period_end, fiscal_period);

-- 2. prices_daily. PK is (security_id, date) with no date-leading index;
--    _prices_at does DISTINCT ON (security_id) ... WHERE date BETWEEN on-7 AND on.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prices_date_sid
    ON prices_daily (date, security_id)
    INCLUDE (adj_close, close);

-- 3. fundamental_metrics. PK orders as_of_date before metric, so it can't feed
--    _load_latest_metrics' DISTINCT ON (security_id, metric) ORDER BY ..., as_of_date DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_distinct_on
    ON fundamental_metrics (metric_version, security_id, metric, as_of_date DESC)
    INCLUDE (value);

-- 4. insider_transactions. _load_insider_signal filters transaction_code IN ('P','S')
--    over a date window; the existing index leads with security_id (not filtered here).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insider_code_txndate
    ON insider_transactions (transaction_code, transaction_date)
    INCLUDE (security_id, value, filed_date, plan_10b5_1)
    WHERE transaction_code IN ('P', 'S');

-- 5. corporate_actions (smallest; lowest impact). _load_score_time_fundamentals
--    filters action_type='split' AND ratio IS NOT NULL AND ex_date <= as_of.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_corpactions_split_exdate
    ON corporate_actions (ex_date)
    WHERE action_type = 'split' AND ratio IS NOT NULL;
