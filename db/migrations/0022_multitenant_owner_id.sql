-- 0022_multitenant_owner_id.sql
-- MULTI-TENANCY, Phase 0 (ADDITIVE — safe to apply to the live DB right now).
--
-- Gives the 5 per-user tables an owner_id and backfills existing rows to you.
-- This migration is DELIBERATELY non-breaking: owner_id has a DEFAULT (your id),
-- so your CURRENT app keeps working unchanged (inserts that omit owner_id just
-- default to you), and the old uniqueness/ON CONFLICT targets are left in place.
--
-- The BREAKING changes (drop the default so the app must pass owner_id; swap
-- UNIQUE(security_id) -> UNIQUE(owner_id, security_id); etc.) live in 0023 and
-- get applied LATER, in lockstep with the per-user backend code — so there is
-- never a window where the live app is broken.
--
-- owner_id = the Supabase auth user's id (the JWT `sub`). No FK to auth.users
-- (Supabase recommends against public->auth FKs; the app enforces it).
--
-- STAYS GLOBAL (shared caches — do NOT add owner_id): ai_summaries,
-- decision_briefs, filing_answers, market_brief, backtest_results,
-- material_events, insider_transactions, and all market/screener/factor tables.
--
-- HOW TO APPLY (manual, per CONVENTIONS.md):
--   1. Supabase -> SQL Editor.
--   2. See your accounts:  select id, email, created_at from auth.users order by created_at;
--   3. Set owner_email below to the email you LOG IN to StockBud with
--      (the account that should own all your existing data).
--   4. Run the whole script (expect a NOTICE confirming the backfill).
--   5. Verify with the SELECT at the bottom (5 rows).
--
-- Idempotent: safe to re-run.

do $$
declare
  owner_email text := '__YOUR_LOGIN_EMAIL__';   -- <<< SET THIS (step 3)
  owner uuid;
begin
  select id into owner from auth.users where lower(email) = lower(owner_email);
  if owner is null then
    raise exception
      'No Supabase user found for %. Run: select id, email from auth.users;  then set owner_email.',
      owner_email;
  end if;

  -- Add owner_id with a DEFAULT = you. Existing rows backfill atomically, and the
  -- default keeps the current (owner_id-unaware) app working until 0023 + code land.
  execute format('alter table watchlist              add column if not exists owner_id uuid not null default %L', owner);
  execute format('alter table theses                 add column if not exists owner_id uuid not null default %L', owner);
  execute format('alter table portfolio_transactions add column if not exists owner_id uuid not null default %L', owner);
  execute format('alter table linked_accounts        add column if not exists owner_id uuid not null default %L', owner);
  execute format('alter table alert_rules            add column if not exists owner_id uuid not null default %L', owner);

  raise notice 'owner_id added + existing rows backfilled to % (%)', owner_email, owner;
end $$;

-- Owner-leading indexes (additive — old indexes are left in place; 0023 prunes
-- the now-redundant ones). create-if-not-exists keeps this re-runnable.
create index if not exists idx_watchlist_owner          on watchlist (owner_id);
create index if not exists idx_theses_owner_sec         on theses (owner_id, security_id);
create index if not exists idx_ptx_owner_security_date  on portfolio_transactions (owner_id, security_id, trade_date);
create index if not exists idx_ptx_owner_date           on portfolio_transactions (owner_id, trade_date);
create index if not exists idx_linked_owner             on linked_accounts (owner_id);
create index if not exists idx_alert_rules_owner        on alert_rules (owner_id);

-- ── VERIFY (run after; expect one row per table) ─────────────────────────────
-- select table_name, column_name
--   from information_schema.columns
--  where column_name = 'owner_id'
--    and table_name in ('watchlist','theses','portfolio_transactions','linked_accounts','alert_rules')
--  order by table_name;
