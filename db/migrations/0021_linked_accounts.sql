-- 0021_linked_accounts.sql
-- Brokerage account linking — scaffold for syncing a user's broker activity
-- (Charles Schwab Trader API, or an aggregator like SnapTrade) into the SAME
-- portfolio_transactions ledger that manual entry / CSV import already feed.
-- Provider-agnostic on purpose: the table holds whatever one linked account
-- needs regardless of which provider it is.
--
-- This migration is ADDITIVE and safe: a new table plus three nullable columns
-- on portfolio_transactions. Existing manual rows are unaffected — they default
-- to source='manual', external_id/linked_account_id NULL.
--
-- SECURITY: secret_enc holds the encrypted OAuth token bundle (Fernet, key from
-- PORTFOLIO_TOKEN_KEY in the app env — never in this DB, never in git). It is
-- never selected into any API response. Schwab has no read-only scope, so this
-- token is technically trade-capable; the app must never call any order endpoint.

CREATE TABLE IF NOT EXISTS linked_accounts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider        text NOT NULL CHECK (provider IN ('schwab', 'snaptrade')),
  external_id     text,                 -- provider account id / hash (NULL until linked)
  display_name    text,                 -- e.g. "Schwab Brokerage ••• 123"
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'needs_reauth', 'error', 'revoked')),
  secret_enc      bytea,                -- encrypted OAuth token bundle (NULL until linked)
  cursor          text,                 -- provider sync cursor / last-seen transaction id
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

-- Provenance + de-dupe on the existing ledger.
--   source           : where the row came from ('manual' default keeps the
--                      hand-entry / CSV path identical to before).
--   external_id      : the provider's transaction id, used to make re-syncs
--                      idempotent (NULL for manual rows).
--   linked_account_id: which linked account produced it (ON DELETE SET NULL so
--                      unlinking keeps the imported history, just orphans it).
ALTER TABLE portfolio_transactions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'csv', 'schwab', 'snaptrade')),
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS linked_account_id bigint
    REFERENCES linked_accounts(id) ON DELETE SET NULL;

-- The heart of duplicate-free sync: a given provider transaction can land at
-- most once per linked account. Partial so manual rows (external_id NULL) are
-- exempt. INSERT ... ON CONFLICT on this index makes a repeated sync a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ptx_linked_external
  ON portfolio_transactions (linked_account_id, external_id)
  WHERE external_id IS NOT NULL;
