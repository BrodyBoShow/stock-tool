-- 0015_market_brief.sql
-- AI market-overview brief cache (Market tab). Same "AI result cache" category
-- as ai_summaries / decision_briefs / backtest_results — NOT a pipeline table.
--
-- Keyed by as_of (the market data date), so there is at most ONE generation per
-- market day no matter how many times the tab is opened. The PRIMARY KEY makes
-- the insert race-safe (ON CONFLICT DO NOTHING) and is the whole cost-control
-- story: ~1 Haiku call/day, only on days the tab is actually viewed.

CREATE TABLE market_brief (
  as_of          date PRIMARY KEY,           -- prices_daily max(date) it summarizes
  brief          jsonb NOT NULL,             -- {headline, narrative[], regime{}, watch[]}
  model          text,
  prompt_version text,
  input_tokens   int,
  output_tokens  int,
  generated_at   timestamptz NOT NULL DEFAULT now()
);
