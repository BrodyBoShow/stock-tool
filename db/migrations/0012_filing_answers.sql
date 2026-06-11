-- 0012_filing_answers.sql
-- Deep filing-grounded diligence answers (Phase 14). CONTEXT ONLY — an
-- analyst-grade Q&A over the company's latest 10-K (Items 1/1A/7/7A) and
-- latest 10-Q, answering a fixed diligence framework strictly from the filing
-- text with citations. Never feeds factor scores.
--
-- The most expensive AI artifact in the app (Opus over a large filing
-- context), so it is cached hard by the 10-K accession + prompt/schema
-- version: generated at most once per annual filing, on demand.

CREATE TABLE filing_answers (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id       bigint NOT NULL REFERENCES securities(security_id),
  accession_no      text NOT NULL REFERENCES filings(accession_no),
  form              text,
  answers           jsonb NOT NULL,       -- {executive_read, topics[], notable_disclosures[], unanswered[]}
  model             text,
  prompt_version    text NOT NULL,
  schema_version    text NOT NULL,
  input_tokens      int,
  output_tokens     int,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (accession_no, prompt_version, schema_version)
);
CREATE INDEX idx_filing_answers_sec ON filing_answers (security_id);
