-- 0020_backtest_perf_indexes.sql
-- Indexes that turn the backtest's full-universe loader queries from seq-scans
-- of multi-million-row tables into index scans. The point-in-time backtest
-- re-scores ~48 months, so each query runs ~48x; without these the run exceeds
-- the statement timeout (and the heavy scans saturate the instance).
--
-- KEY-ONLY (no INCLUDE): a covering INCLUDE makes the index huge and the build
-- brutally expensive — on a constrained instance a CONCURRENTLY + INCLUDE build
-- on xbrl_facts exhausted the database. Key-only still turns the seq-scan into an
-- index scan (a cheap heap fetch for the few matched rows), at a fraction of the
-- build cost.
--
-- APPLY MANUALLY in the Supabase dashboard SQL editor, ONE statement block at a
-- time. CONCURRENTLY (shown here) avoids locking but is heavier to build; if the
-- instance struggles with it, run the SAME index as a PLAIN `CREATE INDEX`
-- (drop the word CONCURRENTLY) while nothing is reading the table — plain is a
-- single, much lighter pass and yields the identical index. Build the smaller
-- tables first (corporate_actions, insider_transactions, fundamental_metrics),
-- then prices_daily, and xbrl_facts last.
--   Raise the build timeout first (own statement for CONCURRENTLY; for a PLAIN
--   build you can prefix `SET statement_timeout='600000';` in the same run):
--     ALTER ROLE postgres SET statement_timeout = '600000';   -- RESET when done
--   Verify: SELECT indexrelid::regclass, indisvalid FROM pg_index
--           WHERE indexrelid::regclass::text LIKE 'idx_%';  (drop+rebuild any invalid)

-- smallest first ----------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_corpactions_split_exdate
    ON corporate_actions (ex_date) WHERE action_type = 'split' AND ratio IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insider_code_txndate
    ON insider_transactions (transaction_code, transaction_date)
    WHERE transaction_code IN ('P', 'S');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_distinct_on
    ON fundamental_metrics (metric_version, security_id, metric, as_of_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prices_date_sid
    ON prices_daily (date, security_id);

-- largest last (the worst seq-scan: _load_score_time_fundamentals filters
-- normalized_concept = ANY(...) AND filed_date <= as_of with no security_id) ----
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_facts_norm_filed
    ON xbrl_facts (normalized_concept, filed_date);
