-- 0029_news_signals.sql
-- Per-security news coverage-VOLUME signal from GDELT, refreshed nightly for
-- watchlisted names. CONTEXT ONLY — never feeds factor scores. Powers a "news
-- spike" flag in the watchlist "what's changed" digest: which watched names had
-- an unusual jump in news coverage versus their OWN recent baseline — a prompt
-- to look, NON-directional (volume only, not good/bad, never a buy/sell signal).
-- Volume only — we do NOT store or assert a sentiment/tone score (free
-- per-company tone is a noisy, weak signal).
CREATE TABLE IF NOT EXISTS news_signals (
  security_id     INTEGER PRIMARY KEY REFERENCES securities(security_id) ON DELETE CASCADE,
  as_of_date      DATE        NOT NULL,   -- the day the series ends on
  latest_count    INTEGER     NOT NULL,   -- recent article count (max of the last ~2 days)
  baseline_median NUMERIC,                -- trailing baseline (median of the prior days)
  ratio           NUMERIC,                -- latest / baseline — the spike magnitude
  is_spike        BOOLEAN     NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
