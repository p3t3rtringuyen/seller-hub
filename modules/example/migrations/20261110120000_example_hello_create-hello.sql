-- Up Migration
-- EXAMPLE migration (delete with modules/example; forward-only, ADR-0009).
-- File name: <UTC yyyymmddhhmmss>_<module>_<key>_<desc>.sql. References only P3 tables.
create table ops.example_hello (
  id                uuid primary key,
  tenant_id         uuid not null,
  seller_account_id uuid not null,
  greeting          text not null check (length(greeting) between 1 and 80),
  created_at        timestamptz not null default now(),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table ops.example_hello is 'EXAMPLE table of modules/example; proves the repository + RLS pattern. Safe to drop with the module.';
select core.apply_tenant_rls('ops.example_hello');
