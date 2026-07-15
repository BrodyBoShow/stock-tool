-- 0037_linked_account_cash.sql
-- Store each linked brokerage account's CURRENT cash balance, so the portfolio
-- engine can reconstruct a cash-aware value series (value = stock + cash) for a
-- broker feed that reports trades but no deposits/withdrawals. Without this
-- anchor, selling to cash collapses the tracked value toward $0 and the
-- time-weighted return / drawdown / Sharpe become meaningless (they get
-- suppressed). See engine.portfolio.compute_portfolio(cash_anchor=...).
--
-- ADDITIVE and safe: two nullable columns. Accounts synced before this migration
-- (or providers that don't report cash) simply have NULL cash_balance, and the
-- engine falls back to its prior behavior for them.

ALTER TABLE linked_accounts
  ADD COLUMN IF NOT EXISTS cash_balance numeric,      -- broker's reported cash (account currency)
  ADD COLUMN IF NOT EXISTS cash_as_of   timestamptz;  -- when that balance was last read
