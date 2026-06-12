-- 0014_portfolio.sql
-- Portfolio tracker ledger (single-user, like watchlist/theses).
--
-- This is the ONLY stored state for the Portfolio tab. Holdings, cost basis,
-- returns (TWR/MWR), factor tilt, dividends, and allocation are all DERIVED at
-- read time from this ledger + prices_daily + corporate_actions + factor_scores
-- — never written back, so the pipeline write-scope rule is preserved.
--
-- Transaction semantics (shares/price/amount are always positive; the type
-- carries the sign):
--   buy / sell  : security_id + shares + price required. amount is the optional
--                 actual total cash moved (overrides shares*price when the
--                 broker total includes commissions).
--   dividend    : security_id + amount (cash received). Logging dividends for a
--                 security switches that security from auto-accrual (computed
--                 from corporate_actions ex-dates) to the logged rows.
--   deposit / withdrawal / fee : amount only (cash, no security).

CREATE TABLE portfolio_transactions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id  bigint REFERENCES securities(security_id),  -- NULL for cash rows
  txn_type     text NOT NULL CHECK (txn_type IN
                 ('buy','sell','dividend','deposit','withdrawal','fee')),
  trade_date   date NOT NULL,
  shares       numeric(18,6) CHECK (shares > 0),
  price        numeric(18,4) CHECK (price >= 0),
  amount       numeric(18,2) CHECK (amount >= 0),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (txn_type IN ('buy','sell')
       AND security_id IS NOT NULL AND shares IS NOT NULL AND price IS NOT NULL)
    OR (txn_type = 'dividend'
       AND security_id IS NOT NULL AND amount IS NOT NULL)
    OR (txn_type IN ('deposit','withdrawal','fee')
       AND security_id IS NULL AND amount IS NOT NULL)
  )
);

CREATE INDEX idx_ptx_security_date ON portfolio_transactions (security_id, trade_date);
CREATE INDEX idx_ptx_date ON portfolio_transactions (trade_date);
