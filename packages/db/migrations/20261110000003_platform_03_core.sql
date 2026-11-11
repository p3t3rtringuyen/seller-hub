-- Up Migration
-- Source: db/design/03_core.sql (P2-DATA, frozen reference). Verbatim copy; packages/testing/test/platform-db.test.ts keeps them identical.
-- seller-hub data model — 03 core (tenancy, seller accounts, connections, credentials)
-- Slice: L0 (PLT-01, PLT-03, PLT-04; PLT-02 adds rows, no new tables).
-- Frame: ADR-0004 (model, roles, invitations, RLS), ADR-0005 (credential vault), D55 a (fixed roles),
-- D5/D60 (account kind seller|vendor; no vendor tables in MVP).

-- ---------------------------------------------------------------------------
-- Tenants and membership
-- ---------------------------------------------------------------------------
create table core.tenants (
  id                 uuid primary key,
  name               text not null check (length(name) between 1 and 120),
  status             text not null default 'active' check (status in ('active', 'suspended')),
  automation_paused  boolean not null default false,     -- tenant kill switch (ADR-0011 decision 5)
  require_two_factor boolean not null default false,     -- ADR-0004 decision 1
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table core.tenants is
  'App-owned. A customer organisation (D1 c). Deleting a tenant cascades to every tenant row; facts are purged by the maintenance job (no FK on partitioned facts).';
create trigger tenants_touch before update on core.tenants for each row execute function core.touch_updated_at();

create table core.memberships (
  id           uuid primary key,
  tenant_id    uuid not null references core.tenants (id) on delete cascade,
  user_id      uuid not null references identity.users (id) on delete cascade,
  status       text not null default 'active' check (status in ('active', 'suspended')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (tenant_id, id)
);
comment on table core.memberships is 'App-owned. User x tenant (ADR-0004 decision 2).';
create index memberships_user_idx on core.memberships (user_id);
create trigger memberships_touch before update on core.memberships for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Seller accounts: one Amazon selling partner in one region (ADR-0004 decision 2)
-- ---------------------------------------------------------------------------
create table core.seller_accounts (
  id                  uuid primary key,
  tenant_id           uuid not null references core.tenants (id) on delete cascade,
  name                text not null check (length(name) between 1 and 120),
  region_code         text not null references ref.regions (code),
  account_type        text not null default 'seller' check (account_type in ('seller', 'vendor')),
  selling_partner_id  text,                               -- SP-API sellerId / merchant token, once known
  status              text not null default 'active' check (status in ('active', 'disconnected', 'deleting')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id)
);
comment on table core.seller_accounts is
  'App-owned grouping of one selling partner per region; the tenancy unit for all seller data. account_type seller|vendor is the vendor seam (D5, D60: vendor tables come in v1). selling_partner_id: SellingPartnerMetadata.sellingPartnerId (catalog/spapi/definitions/finances@2024-06-19.json).';
create unique index seller_accounts_partner_uq
  on core.seller_accounts (tenant_id, region_code, selling_partner_id) where selling_partner_id is not null;
create trigger seller_accounts_touch before update on core.seller_accounts for each row execute function core.touch_updated_at();

-- Role grants (D55 a fixed roles; permission matrix lives in code, ADR-0004 decision 3)
create table core.role_grants (
  id                 uuid primary key,
  tenant_id          uuid not null references core.tenants (id) on delete cascade,
  membership_id      uuid not null,
  role               text not null check (role in ('owner', 'admin', 'manager', 'analyst', 'viewer')),
  seller_account_id  uuid,                                -- NULL = every seller account of the tenant
  marketplace_id     text references ref.marketplaces (id), -- schema seam, not exposed in MVP UI
  granted_by         uuid references identity.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  foreign key (tenant_id, membership_id) references core.memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table core.role_grants is 'App-owned. Membership x role x scope (ADR-0004 decision 3). Effective permission = union of grants.';
create unique index role_grants_uq on core.role_grants
  (membership_id, role, coalesce(seller_account_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(marketplace_id, ''));
create index role_grants_tenant_idx on core.role_grants (tenant_id, membership_id);

create table core.invitations (
  id                 uuid primary key,
  tenant_id          uuid not null references core.tenants (id) on delete cascade,
  email              text not null,
  email_normalized   text generated always as (lower(email)) stored,
  role               text not null check (role in ('admin', 'manager', 'analyst', 'viewer')),
  seller_account_id  uuid,
  token_hash         bytea not null unique,               -- 32 random bytes, hashed
  invited_by         uuid references identity.users (id) on delete set null,
  expires_at         timestamptz not null,                -- 7 days
  accepted_at        timestamptz,
  accepted_user_id   uuid references identity.users (id) on delete set null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table core.invitations is
  'App-owned (ADR-0004 decision 4). Owner is never invited (setup token / transfer). Retention: purged 30 days after expiry.';
create index invitations_tenant_idx on core.invitations (tenant_id, created_at desc);
create unique index invitations_open_uq on core.invitations (tenant_id, email_normalized)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Connections and credentials (PLT-02, PLT-03; ADR-0005)
-- ---------------------------------------------------------------------------
create table core.connections (
  id                    uuid primary key,
  tenant_id             uuid not null,
  seller_account_id     uuid not null,
  api                   text not null check (api in ('spapi', 'ads')),
  region_code           text not null references ref.regions (code),
  status                text not null default 'pending'
                        check (status in ('pending', 'active', 'needs_reauth', 'revoked', 'error')),
  auth_method           text not null check (auth_method in ('self_authorization', 'oauth_code')),
  scopes                text[] not null default '{}',    -- e.g. advertising::campaign_management
  connected_by          uuid references identity.users (id) on delete set null,
  connected_at          timestamptz,
  last_token_refresh_at timestamptz,
  last_error_code       text,
  last_error_at         timestamptz,
  revoked_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (seller_account_id, api),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table core.connections is
  'App-owned. One LWA authorisation per seller account x API (SP-API self-authorisation for a private app, D1 c; Ads auth-code). Status drives the scheduler: needs_reauth/revoked pause all syncs (ADR-0008 decision 11, ADR-0005 decision 6).';
create trigger connections_touch before update on core.connections for each row execute function core.touch_updated_at();

create table core.credentials (
  id                 uuid primary key,
  tenant_id          uuid not null,
  seller_account_id  uuid not null,
  connection_id      uuid not null,
  kind               text not null check (kind in ('spapi_refresh', 'ads_refresh', 'aws_stream')),
  region_code        text not null references ref.regions (code),
  -- Envelope encryption, AES-256-GCM, AAD = tenant_id|seller_account_id|kind|region (ADR-0005 decisions 1-2)
  kek_id             text not null,
  wrapped_dek        bytea not null,
  iv                 bytea not null,
  ciphertext         bytea not null,
  auth_tag           bytea not null,
  created_at         timestamptz not null default now(),
  rotated_at         timestamptz,
  revoked_at         timestamptz,
  foreign key (tenant_id, connection_id) references core.connections (tenant_id, id) on delete cascade
);
comment on table core.credentials is
  'App-owned secret store (ADR-0005). Disconnect deletes the row (crypto-shred). Never selected outside modules/platform-connections.';
create unique index credentials_active_uq on core.credentials (connection_id, kind) where revoked_at is null;
create index credentials_kek_idx on core.credentials (kek_id);   -- vault.rewrap job

-- OAuth / connect flow state, verified server-side (ADR-0005 decision 7).
create table core.connect_states (
  id                 uuid primary key,
  tenant_id          uuid not null references core.tenants (id) on delete cascade,
  seller_account_id  uuid,                                -- NULL when the flow creates the seller account
  user_id            uuid not null references identity.users (id) on delete cascade,
  api                text not null check (api in ('spapi', 'ads')),
  region_code        text not null references ref.regions (code),
  state_hash         bytea not null unique,
  expires_at         timestamptz not null,                -- ~10 minutes
  consumed_at        timestamptz,
  created_at         timestamptz not null default now()
);
comment on table core.connect_states is 'App-owned. CSRF state of connect flows; purged daily after expiry.';

-- Ads profiles / advertiser accounts seen through an Ads connection (PLT-03).
create table core.ads_profiles (
  id                           uuid primary key,
  tenant_id                    uuid not null,
  seller_account_id            uuid not null,
  connection_id                uuid not null,
  amazon_profile_id            text not null,          -- Profile.profileId (int64 → text, conventions §1)
  amazon_advertiser_account_id text,                   -- v1 AdvertiserAccount.advertiserAccountId
  account_type                 text not null check (account_type in ('seller', 'vendor', 'agency')),
  account_sub_type             text,                   -- AccountInfo.subType (KDP_AUTHOR | AMAZON_ATTRIBUTION)
  amazon_account_info_id       text,                   -- AccountInfo.id (seller/vendor entity id)
  account_name                 text,
  ads_country_code             text not null,          -- Profile.countryCode (UK for GB)
  marketplace_id               text references ref.marketplaces (id), -- AccountInfo.marketplaceStringId
  currency                     char(3) references ref.currencies (code),
  time_zone                    text not null,          -- Profile.timezone; authoritative for business dates
  valid_payment_method         boolean,
  status                       text not null default 'available'
                               check (status in ('available', 'linked', 'unavailable')),
  raw                          jsonb not null default '{}',
  synced_at                    timestamptz not null default now(),
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique (seller_account_id, amazon_profile_id),
  unique (tenant_id, id),
  foreign key (tenant_id, connection_id) references core.connections (tenant_id, id) on delete cascade,
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table core.ads_profiles is
  'Amazon mirror. v0 listProfiles (EX-PROFILES): Profile/AccountInfo in catalog/ads/definitions/profiles-3-0.json; v1 QueryAdvertiserAccount: AdvertiserAccount.alternateIds[].profileId in catalog/ads/definitions/AmazonAdsAPIALLAdvertiserAccountsContract.json. An empty list after connect is the "connected but empty" state (PLT-03), shown from zero rows. Legacy "Profile" entity (amazon-mirror) lands here.';
create trigger ads_profiles_touch before update on core.ads_profiles for each row execute function core.touch_updated_at();

-- Marketplaces of a seller account and the Ads profile linked to each (ADR-0004 decision 2).
create table core.seller_account_marketplaces (
  tenant_id               uuid not null,
  seller_account_id       uuid not null,
  marketplace_id          text not null references ref.marketplaces (id),
  ads_profile_id          uuid,
  is_enabled              boolean not null default true,  -- user may hide a marketplace
  is_participating        boolean,                        -- Participation.isParticipating
  has_suspended_listings  boolean,                        -- Participation.hasSuspendedListings
  participation_synced_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  primary key (seller_account_id, marketplace_id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, ads_profile_id) references core.ads_profiles (tenant_id, id) on delete set null (ads_profile_id)
);
comment on table core.seller_account_marketplaces is
  'Amazon mirror + app link. sellers.getMarketplaceParticipations (catalog/spapi/definitions/sellers@v1.json: MarketplaceParticipation.marketplace/participation), refreshed daily (PLT-02). One Ads profile per marketplace.';
create unique index seller_account_marketplaces_profile_uq
  on core.seller_account_marketplaces (ads_profile_id) where ads_profile_id is not null;
create trigger sam_touch before update on core.seller_account_marketplaces for each row execute function core.touch_updated_at();

-- Per-user UI preferences (ADS-03: chosen/hidden/pinned columns, saved filters per grid).
create table core.user_preferences (
  tenant_id          uuid not null references core.tenants (id) on delete cascade,
  user_id            uuid not null references identity.users (id) on delete cascade,
  pref_key           text not null,                      -- e.g. 'ads.campaigns.grid'
  value              jsonb not null,
  updated_at         timestamptz not null default now(),
  primary key (tenant_id, user_id, pref_key)
);
comment on table core.user_preferences is 'App-owned. Grid column/filter preferences per user per tenant (ADS-03, UX-07/UX-09).';

-- Machine tokens: schema seam for D50 b / AI-04 (ADR-0004 decision 6); not exposed in MVP UI.
create table identity.api_tokens (
  id               uuid primary key,
  tenant_id        uuid not null references core.tenants (id) on delete cascade,
  name             text not null,
  token_hash       bytea not null unique,
  permissions      text[] not null,                      -- subset of the creator's permissions
  seller_account_id uuid,
  created_by       uuid references identity.users (id) on delete set null,
  expires_at       timestamptz not null,
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table identity.api_tokens is 'App-owned. Hashed tenant-scoped machine tokens (ADR-0004 decision 6).';

-- ---------------------------------------------------------------------------
-- Row-level security (ADR-0004 decision 5)
-- ---------------------------------------------------------------------------
-- tenants: visible when it is the current tenant or the current user is a member (tenant switcher).
alter table core.tenants enable row level security;
create policy tenant_isolation on core.tenants
  using (id = core.current_tenant_id()
         or exists (select 1 from core.memberships m
                     where m.tenant_id = tenants.id and m.user_id = core.current_user_id() and m.status = 'active'))
  with check (id = core.current_tenant_id());

-- memberships: current tenant, or the user's own rows across tenants (/v1/me, switcher).
alter table core.memberships enable row level security;
create policy tenant_isolation on core.memberships
  using (tenant_id = core.current_tenant_id() or user_id = core.current_user_id())
  with check (tenant_id = core.current_tenant_id());

-- seller_accounts: its own id is the seller-account scope.
alter table core.seller_accounts enable row level security;
create policy tenant_isolation on core.seller_accounts
  using (tenant_id = core.current_tenant_id()
         and (core.current_seller_account_id() is null or id = core.current_seller_account_id()))
  with check (tenant_id = core.current_tenant_id());

-- grants may be tenant-wide (seller_account_id NULL): tenant-only policy.
select core.apply_tenant_rls('core.role_grants', false);
select core.apply_tenant_rls('core.invitations', false);
select core.apply_tenant_rls('core.connect_states', false);
select core.apply_tenant_rls('core.user_preferences', false);
select core.apply_tenant_rls('identity.api_tokens', false);
select core.apply_tenant_rls('core.connections');
select core.apply_tenant_rls('core.credentials');
select core.apply_tenant_rls('core.ads_profiles');
select core.apply_tenant_rls('core.seller_account_marketplaces');

-- Invitation acceptance happens before a tenant scope exists: one narrow SECURITY DEFINER lookup.
create or replace function core.find_open_invitation(p_token_hash bytea)
  returns table (id uuid, tenant_id uuid, email_normalized text, role text, seller_account_id uuid, expires_at timestamptz)
  language sql stable security definer set search_path = pg_catalog, core as $$
  select i.id, i.tenant_id, i.email_normalized, i.role, i.seller_account_id, i.expires_at
    from core.invitations i
   where i.token_hash = p_token_hash and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;
revoke all on function core.find_open_invitation(bytea) from public;
grant execute on function core.find_open_invitation(bytea) to sh_app;
