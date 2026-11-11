-- Up Migration
-- Source: db/design/02_identity.sql (P2-DATA, frozen reference). Verbatim copy; packages/testing/test/platform-db.test.ts keeps them identical.
-- seller-hub data model — 02 identity (global users and sessions; no tenant, no RLS)
-- Slice: L0 (PLT-01). Frame: ADR-0004 decision 1 (Better Auth core behind IdentityService).
-- Column names are ours; P3-IDENTITY maps Better Auth's model onto them with its field mapping.
-- Access only through modules/platform-auth (sh_app has the grants; no tenant scoping applies).
-- identity.api_tokens is tenant-scoped and lives in 03_core.sql (needs core.tenants).

create table identity.users (
  id                  uuid primary key,                 -- UUIDv7 from packages/core
  email               text not null,
  email_normalized    text generated always as (lower(email)) stored,
  email_verified_at   timestamptz,
  display_name        text,
  locale              text not null default 'en',
  two_factor_enabled  boolean not null default false,
  disabled_at         timestamptz,                      -- set by an Owner/operator; blocks sign-in
  last_sign_in_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (email_normalized)
);
comment on table identity.users is
  'App-owned. Global user (one person, many tenants via core.memberships). Legacy "User" entity (catalog/legacy/entities.json) carried internal org fields; none kept (D0).';
create trigger users_touch before update on identity.users
  for each row execute function core.touch_updated_at();

-- Sign-in methods per user. MVP: provider 'credential' (email + argon2id hash). OIDC later.
create table identity.auth_accounts (
  id                 uuid primary key,
  user_id            uuid not null references identity.users (id) on delete cascade,
  provider           text not null check (provider in ('credential', 'oidc')),
  provider_account_id text not null,                    -- email for 'credential', subject for OIDC
  password_hash      text,                              -- argon2id; never logged
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (provider, provider_account_id),
  check (provider <> 'credential' or password_hash is not null)
);
comment on table identity.auth_accounts is 'App-owned. Login methods per user (ADR-0004 decision 1).';
create trigger auth_accounts_touch before update on identity.auth_accounts
  for each row execute function core.touch_updated_at();

create table identity.sessions (
  id                 uuid primary key,
  user_id            uuid not null references identity.users (id) on delete cascade,
  token_hash         bytea not null unique,             -- SHA-256 of the opaque cookie value
  active_tenant_id   uuid,                              -- tenant switcher; FK not enforced (tenant may be deleted)
  ip_address         inet,
  user_agent         text,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  idle_expires_at    timestamptz not null,              -- 12 h idle
  absolute_expires_at timestamptz not null,             -- 7 d absolute
  revoked_at         timestamptz
);
comment on table identity.sessions is
  'App-owned. Opaque server sessions, hashed at rest (ADR-0004 decision 1). Retention: purge 30 days after expiry/revocation (ADR-0009 decision 5).';
create index sessions_user_idx on identity.sessions (user_id);
create index sessions_expiry_idx on identity.sessions (absolute_expires_at);

-- Email verification, password reset, setup tokens (one-time, hashed).
create table identity.verifications (
  id            uuid primary key,
  purpose       text not null check (purpose in ('email_verification', 'password_reset', 'setup')),
  identifier    text not null,                          -- normalized email, or 'setup'
  token_hash    bytea not null unique,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);
comment on table identity.verifications is
  'App-owned. One-time tokens (verification, reset, first-Owner setup token — ADR-0004 decision 1). Purged 30 days after expiry.';
create index verifications_identifier_idx on identity.verifications (purpose, identifier);

create table identity.two_factor_secrets (
  user_id          uuid primary key references identity.users (id) on delete cascade,
  -- TOTP secret encrypted with the vault (ADR-0005 envelope format), never plaintext.
  kek_id           text not null,
  wrapped_dek      bytea not null,
  iv               bytea not null,
  ciphertext       bytea not null,
  auth_tag         bytea not null,
  backup_codes_hash bytea[] not null default '{}',
  created_at       timestamptz not null default now()
);
comment on table identity.two_factor_secrets is 'App-owned. Optional TOTP per user (ADR-0004 decision 1).';

