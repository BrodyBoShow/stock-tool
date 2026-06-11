-- 0008_decision_briefs.sql
-- Cached AI "Decision Brief" — the decision layer on each deep-dive page.
-- One brief per security per scoring snapshot: keyed by score_date so a brief
-- regenerates at most once per nightly re-score (and only when viewed),
-- mirroring how ai_summaries is keyed by accession.

CREATE TABLE decision_briefs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id     bigint NOT NULL REFERENCES securities(security_id),
  score_date      date NOT NULL,
  brief           jsonb NOT NULL,       -- {one_liner, bull_case, bear_case, key_catalyst,
                                        --  main_risk, data_confidence, next_questions}
  model           text,
  prompt_version  text NOT NULL,
  schema_version  text NOT NULL,
  input_tokens    int,
  output_tokens   int,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (security_id, score_date, prompt_version, schema_version)
);
CREATE INDEX idx_decision_briefs_sec ON decision_briefs (security_id, score_date DESC);
