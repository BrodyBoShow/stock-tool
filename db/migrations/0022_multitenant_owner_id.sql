-- 0022_multitenant_owner_id.sql
-- MULTI-TENANCY, Phase 0: give the per-user tables an owner_id, backfill the
-- existing (single-user) rows to you, and make uniqueness/indexes per-user.
--
-- WHY: today portfolio_transactions, watchlist, theses, linked_accounts and
-- alert_rules are global (no owner). The moment a second person logs in they'd
-- see YOUR data. owner_id = the Supabase auth user's id (the JWT `sub`); the app
-- will filter every query by it (WHERE owner_id = <current user>).
--
-- TABLES THAT INTENTIONALLY STAY GLOBAL (do NOT add owner_id — shared caches,
-- keeps AI cost at "generate once, share"):
--   ai_summaries, decision_briefs, filing_answers, market_brief,
--   backtest_results, material_events, insider_transactions, and all
--   market/screener/factor tables.
--
-- HOW TO APPLY (manual, per CONVENTIONS.md — assistant never runs DDL):
--   1. Supabase dashboard -> SQL Editor.
--   2. First, see your accounts + ids:
--          select id, email, created_at from auth.users order by created_at;
--   3. Set owner_email below to the email you will LOG IN to StockBud with
--      (the account whose login should "own" all your current data).
--   4. Run this whole script. You should see a NOTICE confirming the backfill.
--   5. Verify (see the SELECT at the very bottom).
--
-- MUST be applied + verified BEFORE any owner_id-filtering app code is deployed,
-- or every authenticated query errors on a missing column.
--
-- Idempotent: safe to re-run.

-- ── 1. add owner_id to the 5 per-user tables, backfilled to your account ──────
do $$
declare
  owner_email text := '__YOUR_LOGIN_EMAIL__';   -- <<< SET THIS (step 3 above)
  owner uuid;
begin
  select id into owner from auth.users where lower(email) = lower(owner_email);
  if owner is null then
    raise exception
      'No Supabase user found for %. Run: select id, email from auth.users;  then set owner_email.',
      owner_email;
  end if;

  -- ADD with a DEFAULT so existing rows are backfilled to you atomically...
  execute format('alter table watchlist              add column if not exists owner_id uuid not null default %L', owner);
  execute format('alter table theses                 add column if not exists owner_id uuid not null default %L', owner);
  execute format('alter table portfolio_transactions add column if not exists owner_id uuid not null default %L', owner);
  execute format('alter table linked_accounts        add column if not exists owner_id uuid not null default %L', owner);
  execute format('alter table alert_rules            add column if not exists owner_id uuid not null default %L', owner);

  -- ...then DROP the default so every FUTURE insert must supply owner_id
  -- (prevents silently recreating a single global "default owner").
  alter table watchlist              alter column owner_id drop default;
  alter table theses                 alter column owner_id drop default;
  alter table portfolio_transactions alter column owner_id drop default;
  alter table linked_accounts        alter column owner_id drop default;
  alter table alert_rules            alter column owner_id drop default;

  raise notice 'owner_id added + existing rows backfilled to % (%)', owner_email, owner;
end $$;

-- ── 2. per-user uniqueness (drop the old global unique, add a scoped one) ─────
alter table watchlist drop constraint if exists watchlist_security_id_key;
alter table watchlist drop constraint if exists watchlist_owner_security_key;
alter table watchlist add  constraint watchlist_owner_security_key unique (owner_id, security_id);

alter table linked_accounts drop constraint if exists linked_accounts_provider_external_id_key;
alter table linked_accounts drop constraint if exists linked_accounts_owner_provider_external_key;
alter table linked_accounts add  constraint linked_accounts_owner_provider_external_key
  unique (owner_id, provider, external_id);

-- ── 3. owner-leading indexes (queries are now always owner-scoped) ───────────
create index if not exists idx_watchlist_owner         on watchlist (owner_id);
create index if not exists idx_theses_owner_sec        on theses (owner_id, security_id);

drop   index if exists     idx_ptx_security_date;
create index if not exists idx_ptx_owner_security_date on portfolio_transactions (owner_id, security_id, trade_date);
drop   index if exists     idx_ptx_date;
create index if not exists idx_ptx_owner_date          on portfolio_transactions (owner_id, trade_date);

create index if not exists idx_linked_owner            on linked_accounts (owner_id);
create index if not exists idx_alert_rules_owner       on alert_rules (owner_id);

-- ── 4. VERIFY (run this after; all 5 should print one row each) ───────────────
-- select table_name, column_name
--   from information_schema.columns
--  where column_name = 'owner_id'
--    and table_name in ('watchlist','theses','portfolio_transactions','linked_accounts','alert_rules')
--  order by table_name;
