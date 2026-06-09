-- 0002_market_data.sql
-- Daily prices and corporate actions (splits/dividends).

-- Daily OHLCV. Keep raw close and adjusted close clearly separate.
CREATE TABLE prices_daily (
  security_id  bigint NOT NULL REFERENCES securities(security_id),
  date         date NOT NULL,
  open         numeric(18,4),
  high         numeric(18,4),
  low          numeric(18,4),
  close        numeric(18,4),            -- raw
  adj_close    numeric(18,4),            -- split/div adjusted
  volume       bigint,
  PRIMARY KEY (security_id, date)
);

-- Splits/dividends. Engine applies split ratios BACKWARD to historical
-- per-share fundamentals (EPS, share count) so valuation ratios stay aligned.
CREATE TABLE corporate_actions (
  security_id  bigint NOT NULL REFERENCES securities(security_id),
  ex_date      date NOT NULL,
  action_type  text NOT NULL,            -- 'split' | 'dividend'
  ratio        numeric(12,6),            -- 4.0 for a 4-for-1 split
  amount       numeric(18,6),            -- cash dividend per share
  source       text,
  PRIMARY KEY (security_id, ex_date, action_type)
);
