-- 0009_insider_transactions.sql
-- Form 4 insider transactions (Phase 12). CONTEXT ONLY — surfaces on the
-- deep-dive and grounds the Decision Brief; never feeds factor scores.
--
-- One row per non-derivative transaction line in a Form 4. (security_id,
-- accession_no, txn_index) makes re-parses idempotent: txn_index is the
-- line's position within the filing, which is stable for a given accession.
-- Dual-class issuers (GOOG/GOOGL, ...) get rows per share-class security_id,
-- mirroring how xbrl_facts handles shared CIKs.

CREATE TABLE insider_transactions (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id        bigint NOT NULL REFERENCES securities(security_id),
  accession_no       text NOT NULL,
  txn_index          int NOT NULL,        -- position within the filing
  owner_name         text NOT NULL,
  owner_title        text,                -- officer title when given
  is_director        boolean NOT NULL DEFAULT false,
  is_officer         boolean NOT NULL DEFAULT false,
  is_ten_pct         boolean NOT NULL DEFAULT false,
  transaction_date   date,
  transaction_code   text NOT NULL,       -- P, S, A, M, F, G, ... (SEC codes)
  acquired_disposed  text,                -- 'A' acquired | 'D' disposed
  shares             numeric,
  price              numeric,             -- per-share; 0/null for awards
  value              numeric,             -- shares * price when both known
  shares_owned_after numeric,
  plan_10b5_1        boolean,             -- filing-level Rule 10b5-1(c) checkbox
  filed_date         date NOT NULL,
  form               text NOT NULL,       -- '4' | '4/A'
  UNIQUE (security_id, accession_no, txn_index)
);
CREATE INDEX idx_insider_sec_txndate
  ON insider_transactions (security_id, transaction_date DESC);
