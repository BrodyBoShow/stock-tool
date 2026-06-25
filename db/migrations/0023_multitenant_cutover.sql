-- 0023_multitenant_cutover.sql
-- MULTI-TENANCY, breaking CUTOVER (the finish that 0022 deferred).
--
-- ⚠️  APPLY THIS AT THE SAME TIME AS DEPLOYING THE PHASE 3/4 CODE — not before,
-- not after. After 0022 the live app still worked because owner_id had a DEFAULT
-- (= the original owner) and the old UNIQUE/ON CONFLICT targets were untouched.
-- This migration removes BOTH crutches:
--   • drops the owner_id DEFAULT  -> the app MUST now supply owner_id, and an
--     insert that forgets to becomes a loud NOT NULL error instead of silently
--     attributing the row to the original owner.
--   • swaps the global UNIQUE(...) constraints for per-(owner_id, ...) ones, so
--     the new ON CONFLICT (owner_id, security_id) / (owner_id, provider,
--     external_id) targets are valid and two users can watch the same ticker /
--     link the same brokerage account.
-- So the OLD (owner_id-unaware) code breaks the instant this runs, and the NEW
-- (owner_id-passing) code breaks if it runs BEFORE this. Ship them together.
--
-- SAFE TO APPLY: every existing row already has a non-null owner_id (0022
-- backfilled them via the DEFAULT). Dropping the default does not touch existing
-- data — it only changes future inserts. No backfill, no rewrite.
--
-- HOW TO APPLY (manual, per CONVENTIONS.md):
--   1. Supabase -> SQL Editor.
--   2. Deploy the Phase 3/4 backend + frontend, then run this whole script
--      (or run this, then flip the deploy — keep the window tiny either way).
--   3. Verify with the SELECTs at the bottom (no DEFAULT remains; per-owner
--      uniqueness present).
--
-- ROLLBACK (if you must revert to the pre-cutover single-user app):
--   Re-add the owner_id DEFAULT on all 5 tables, pointing at the original owner's
--   uuid, then redeploy the pre-Phase-3 code. The per-owner UNIQUE constraints
--   below are a strict superset of the old global ones for a single owner, so
--   they can stay; if you want the exact old shape back, drop the
--   *_owner_* constraints and re-add the original UNIQUE(security_id) /
--   UNIQUE(provider, external_id). Recover the owner uuid with:
--     select id, email from auth.users order by created_at;
--   then:
--     alter table watchlist              alter column owner_id set default '<uuid>'::uuid;
--     alter table theses                 alter column owner_id set default '<uuid>'::uuid;
--     alter table portfolio_transactions alter column owner_id set default '<uuid>'::uuid;
--     alter table linked_accounts        alter column owner_id set default '<uuid>'::uuid;
--     alter table alert_rules            alter column owner_id set default '<uuid>'::uuid;
--
-- Idempotent: safe to re-run (drops use IF EXISTS / "drop default" is a no-op
-- when absent; the add-constraint blocks are guarded by a prior drop-if-exists).

-- ── 1. Drop the owner_id DEFAULT on all 5 user tables ────────────────────────
-- From here on the app MUST pass owner_id. A missing one is now a NOT NULL error
-- (the column stays NOT NULL from 0022), not a silent default to one owner.
-- "drop default" on a column with no default is a no-op, so this is re-runnable.
alter table watchlist              alter column owner_id drop default;
alter table theses                 alter column owner_id drop default;
alter table portfolio_transactions alter column owner_id drop default;
alter table linked_accounts        alter column owner_id drop default;
alter table alert_rules            alter column owner_id drop default;

-- ── 2. watchlist: global UNIQUE(security_id) -> per-owner ────────────────────
-- Lets two users watch the same ticker, and makes the app's new
-- ON CONFLICT (owner_id, security_id) upsert target valid.
alter table watchlist drop constraint if exists watchlist_security_id_key;
alter table watchlist drop constraint if exists watchlist_owner_security_key;
alter table watchlist
  add constraint watchlist_owner_security_key unique (owner_id, security_id);

-- ── 3. linked_accounts: global UNIQUE(provider, external_id) -> per-owner ────
-- Lets two users link the same brokerage account, and makes the app's new
-- ON CONFLICT (owner_id, provider, external_id) upsert target valid.
alter table linked_accounts drop constraint if exists linked_accounts_provider_external_id_key;
alter table linked_accounts drop constraint if exists linked_accounts_owner_provider_external_key;
alter table linked_accounts
  add constraint linked_accounts_owner_provider_external_key unique (owner_id, provider, external_id);

-- ── 4. Drop the pre-owner indexes that 0022's owner-leading ones superseded ──
-- 0014 created (security_id, trade_date) and (trade_date); 0022 created the
-- (owner_id, security_id, trade_date) and (owner_id, trade_date) replacements.
-- The old ones are now redundant for every per-owner query. (The partial unique
-- uq_ptx_linked_external from 0021 is left in place — sync de-dupe still needs it.)
drop index if exists idx_ptx_security_date;
drop index if exists idx_ptx_date;

-- ── VERIFY (run after) ───────────────────────────────────────────────────────
-- No owner_id DEFAULT should remain on any of the 5 tables (expect 0 rows):
-- select table_name, column_default
--   from information_schema.columns
--  where column_name = 'owner_id'
--    and column_default is not null
--    and table_name in ('watchlist','theses','portfolio_transactions','linked_accounts','alert_rules');
--
-- Per-owner uniqueness should be present (expect the two *_owner_* constraints):
-- select conrelid::regclass as table_name, conname
--   from pg_constraint
--  where conname in ('watchlist_owner_security_key','linked_accounts_owner_provider_external_key')
--  order by conname;
--
-- The superseded ptx indexes should be gone (expect 0 rows):
-- select indexname from pg_indexes
--  where indexname in ('idx_ptx_security_date','idx_ptx_date');
