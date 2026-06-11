-- 0011_material_events.sql
-- 8-K material events (Phase 13). CONTEXT ONLY — surfaces a "recent events"
-- timeline on the deep-dive and grounds the Decision Brief; never feeds factor
-- scores. The event items come straight from EDGAR's submissions JSON `items`
-- field (e.g. "2.02,9.01"), so ingestion needs no document fetch.
--
-- One row per 8-K / 8-K/A filing. (security_id, accession_no) makes re-ingest
-- idempotent. Dual-class issuers share a CIK -> a row per share-class
-- security_id (same convention as xbrl_facts / insider_transactions).

CREATE TABLE material_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id      bigint NOT NULL REFERENCES securities(security_id),
  accession_no     text NOT NULL,
  form             text NOT NULL,        -- '8-K' | '8-K/A'
  filed_date       date NOT NULL,
  event_date       date,                 -- reportDate (date the event occurred)
  items            text[] NOT NULL DEFAULT '{}',  -- e.g. {'2.02','9.01'}
  primary_doc_url  text,
  UNIQUE (security_id, accession_no)
);
CREATE INDEX idx_material_events_sec_date
  ON material_events (security_id, event_date DESC, filed_date DESC);
