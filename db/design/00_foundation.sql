-- seller-hub data model — 00 foundation
-- Task P2-DATA. PostgreSQL 16. Applies first; every other file depends on it.
-- Frame: ADR-0009 (schemas, partitions, RLS, retention), ADR-0004 (tenancy), conventions.md §1/§2/§10.
-- Slice: L0 (platform).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- pg_trgm: case-insensitive "contains" search on names / SKUs / ids (conventions §4 `q=`).
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Schemas (ADR-0009 decision 1)
-- ---------------------------------------------------------------------------
create schema if not exists identity;   -- global users, sessions, api tokens
create schema if not exists core;       -- tenants, memberships, grants, seller accounts, connections, credentials
create schema if not exists ref;        -- global reference data: marketplaces, currencies, Ads limits
create schema if not exists ingest;     -- sync states, job runs, raw object index, inbox
create schema if not exists ads;        -- Amazon Ads mirror (SP first; SB/SD tables later, trap 16)
create schema if not exists catalog;    -- listings + catalog item enrichment (SP-API)
create schema if not exists inventory;  -- FBA inventory mirror (SP-API)
create schema if not exists orders;     -- orders without PII (D11)
create schema if not exists finance;    -- financial transactions, event groups
create schema if not exists facts;      -- monthly-partitioned time series
create schema if not exists ops;        -- commands, outbox, audit, change history, rules, caps
create schema if not exists pii;        -- EMPTY in MVP (D11 = no). Seam for restricted data later.

comment on schema pii is
  'Restricted data (buyer name/address/phone/email) only, encrypted columns, own repository, purge job. Empty in MVP (D11 = no, ADR-0009 decision 6).';

-- ---------------------------------------------------------------------------
-- Database roles (ADR-0009 consequences): sh_owner runs migrations/maintenance, sh_app serves
-- requests without BYPASSRLS. Created NOLOGIN here; passwords/login are set by deployment (P6).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'sh_owner') then
    create role sh_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'sh_app') then
    create role sh_app nologin nobypassrls;
  end if;
end $$;

-- Privileges: sh_app reads/writes data tables created later by the migration role; ref is read-only.
-- (Default privileges attach to the role that runs the migrations — sh_owner in deployments.)
grant usage on schema identity, core, ref, ingest, ads, catalog, inventory, orders, finance, facts, ops to sh_app;
alter default privileges in schema identity, core, ingest, ads, catalog, inventory, orders, finance, facts, ops
  grant select, insert, update, delete on tables to sh_app;
alter default privileges in schema ref grant select on tables to sh_app;
-- pii: no grants to sh_app in MVP (a dedicated role comes with the PII slice).

-- ---------------------------------------------------------------------------
-- Scope helpers (ADR-0004 decision 5, ADR-0009 decision 7)
-- packages/db `withScope` runs `SET LOCAL app.tenant_id = …` (+ app.seller_account_id, app.user_id).
-- Unset settings read as NULL; a NULL tenant matches no row (fail closed).
-- ---------------------------------------------------------------------------
create or replace function core.current_tenant_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create or replace function core.current_seller_account_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.seller_account_id', true), '')::uuid $$;

create or replace function core.current_user_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Enables RLS on a tenant table and creates the standard policy.
--   with_seller_account = true: the row must also match app.seller_account_id when that is set
--   (a tenant-wide scope — e.g. the seller-account list — leaves it unset).
-- Policies declared on a partitioned parent apply to its partitions (ADR-0009 consequences).
-- RLS is ENABLEd, not FORCEd: sh_owner (table owner) runs migrations and maintenance purges.
create or replace function core.apply_tenant_rls(tbl regclass, with_seller_account boolean default true)
  returns void language plpgsql as $$
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('drop policy if exists tenant_isolation on %s', tbl);
  if with_seller_account then
    execute format($p$
      create policy tenant_isolation on %s
        using (tenant_id = core.current_tenant_id()
               and (core.current_seller_account_id() is null
                    or seller_account_id = core.current_seller_account_id()))
        with check (tenant_id = core.current_tenant_id()
               and (core.current_seller_account_id() is null
                    or seller_account_id = core.current_seller_account_id()))
    $p$, tbl);
  else
    execute format($p$
      create policy tenant_isolation on %s
        using (tenant_id = core.current_tenant_id())
        with check (tenant_id = core.current_tenant_id())
    $p$, tbl);
  end if;
end $$;

-- updated_at maintenance for mutable rows.
create or replace function core.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Partition helper (ADR-0009 decision 3): monthly range partitions on a date/timestamptz key.
-- Partition name: <table>_pYYYYMM. The maintenance job calls this 3 months ahead; backfill jobs
-- call it for their window before inserting. Retention detaches/drops partitions older than the
-- configured horizon (see docs/data-model/README.md §Retention).
-- ---------------------------------------------------------------------------
create or replace function core.ensure_monthly_partitions(parent regclass, from_month date, to_month date)
  returns integer language plpgsql as $$
declare
  m date := date_trunc('month', from_month)::date;
  last_m date := date_trunc('month', to_month)::date;
  created integer := 0;
  rel_schema text;
  rel_name text;
  part_name text;
begin
  select n.nspname, c.relname into rel_schema, rel_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.oid = parent;
  while m <= last_m loop
    part_name := format('%s_p%s', rel_name, to_char(m, 'YYYYMM'));
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = rel_schema and c.relname = part_name) then
      execute format('create table %I.%I partition of %s for values from (%L) to (%L)',
                     rel_schema, part_name, parent, m, (m + interval '1 month')::date);
      created := created + 1;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  return created;
end $$;

comment on function core.ensure_monthly_partitions(regclass, date, date) is
  'Creates missing monthly partitions [from_month, to_month] for a range-partitioned table. Idempotent.';

-- Shared enum: who caused a change (ADR-0011 decision 1, ops.change_history / ops.commands).
create type core.change_source as enum ('user', 'rule', 'assistant', 'amazon');
