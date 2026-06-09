-- 0003_filings_xbrl.sql
-- EDGAR filing index, concept-normalization map, and raw XBRL facts.

-- Filing index (from EDGAR submissions).
CREATE TABLE filings (
  accession_no     text PRIMARY KEY,
  security_id      bigint NOT NULL REFERENCES securities(security_id),
  form             text NOT NULL,
  filed_date       date NOT NULL,
  period_of_report date,
  primary_doc_url  text,
  fetched_at       timestamptz
);
CREATE INDEX idx_filings_sec_form ON filings (security_id, form, filed_date DESC);

-- Versioned mapping from messy raw XBRL tags to standard names.
-- (Revenue alone is tagged Revenues / SalesRevenueNet / RevenueFromContract... etc.)
CREATE TABLE concept_map (
  map_version        text NOT NULL,      -- 'v1'
  raw_concept        text NOT NULL,      -- 'SalesRevenueNet'
  normalized_concept text NOT NULL,      -- 'revenue'
  PRIMARY KEY (map_version, raw_concept)
);

-- Raw XBRL facts (tidy/long). v1 ingests UNDIMENSIONED company-level facts only;
-- add dimension columns later if you ever pull segment/geographic facts.
-- Restatements appear naturally as rows with different filed_date.
CREATE TABLE xbrl_facts (
  fact_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id        bigint NOT NULL REFERENCES securities(security_id),
  concept            text NOT NULL,       -- raw tag as filed
  normalized_concept text,                -- resolved via concept_map
  unit               text NOT NULL,
  value              numeric(28,4) NOT NULL,
  period_start       date,
  period_end         date NOT NULL,
  fiscal_year        int,
  fiscal_period      text,                -- FY, Q1..Q4
  form               text,
  filed_date         date NOT NULL,       -- point-in-time key
  accession_no       text,
  UNIQUE (security_id, concept, unit, period_end, fiscal_period, filed_date, accession_no)
);
CREATE INDEX idx_facts_norm  ON xbrl_facts (security_id, normalized_concept, period_end);
CREATE INDEX idx_facts_filed ON xbrl_facts (security_id, filed_date);
