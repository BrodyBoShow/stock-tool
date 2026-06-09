-- 0005_user_features.sql
-- Single-user research features: watchlist, thesis tracker, cached AI summaries.

-- Watchlist (single-user MVP).
CREATE TABLE watchlist (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id  bigint NOT NULL REFERENCES securities(security_id),
  added_at     timestamptz NOT NULL DEFAULT now(),
  notes        text,
  UNIQUE (security_id)
);

-- Thesis tracker — the discipline feature.
CREATE TABLE theses (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id        bigint NOT NULL REFERENCES securities(security_id),
  summary            text NOT NULL,
  target_metrics     jsonb,
  invalidation_rules text,
  conviction         int,                 -- 1-5
  status             text NOT NULL DEFAULT 'active',  -- active/closed/invalidated
  review_date        date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_theses_sec ON theses (security_id);

-- Cached AI filing summaries — structured-output-first, validated, versioned.
CREATE TABLE ai_summaries (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id       bigint NOT NULL REFERENCES securities(security_id),
  accession_no      text NOT NULL REFERENCES filings(accession_no),
  form              text,
  summary           jsonb NOT NULL,       -- {what_changed, risk_factors, key_metrics}, schema-validated
  citations         jsonb,                -- section spans back into the filing
  model             text,
  prompt_version    text,
  schema_version    text,
  input_tokens      int,
  output_tokens     int,
  validation_status text,                 -- 'valid' | 'failed_schema' | 'flagged'
  generated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (accession_no, prompt_version, schema_version)
);
