-- 0035_assistant_answers.sql
-- Cached "Ask StockBud AI" answers — the deep-dive research assistant.
-- One row per (security, question, data snapshot): an identical question on the
-- same score_date is served from cache (no LLM re-spend), and auto-busts when
-- the nightly re-score changes data_version. Mirrors decision_briefs' cache shape.

CREATE TABLE assistant_answers (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id     bigint NOT NULL REFERENCES securities(security_id),
  question_hash   text NOT NULL,          -- sha256 of the normalized question
  question        text NOT NULL,          -- raw question (audit / recent-list)
  answer          jsonb NOT NULL,         -- {answer, confidence, sources}
  model           text,
  provider        text,                   -- 'groq' | 'anthropic'
  data_version    text NOT NULL,          -- score_date string; busts on re-score
  prompt_version  text NOT NULL,
  input_tokens    int,
  output_tokens   int,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (security_id, question_hash, data_version, prompt_version)
);
CREATE INDEX idx_assistant_answers_sec ON assistant_answers (security_id, generated_at DESC);
