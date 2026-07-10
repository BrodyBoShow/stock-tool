-- 0036_doc_chunks.sql
-- Semantic filing-text store for Ask StockBud AI (retrieval provider: pgvector).
-- Lazy + per-ticker: a company's filing sections are chunked + embedded only when
-- someone asks a semantic question about it (kept tiny on the MICRO tier). Every
-- search is scoped to ONE security_id, so its ~50-150 chunks are sorted exactly
-- by distance — no HNSW index needed (just the security_id btree filter).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE doc_chunks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id   bigint NOT NULL REFERENCES securities(security_id),
  accession     text   NOT NULL,        -- the filing this chunk came from
  form          text,
  filed_date    date,
  url           text,
  chunk_index   int    NOT NULL,
  content       text   NOT NULL,        -- the passage text (returned to the AI)
  embedding     vector(768) NOT NULL,   -- Gemini text-embedding-004, 768 dims
  embed_model   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (security_id, accession, chunk_index)
);

-- Search filters by security_id first (tiny per-ticker set), then exact distance.
CREATE INDEX idx_doc_chunks_sec ON doc_chunks (security_id);
