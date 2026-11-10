-- seller-hub data model — 07 ops (writes to Amazon, audit, change history, rules)
-- Slice: L0 (PLT-07 safe write layer, PLT-06 audit/history, AUT-01 rule engine + one bid rule).
-- Frame: ADR-0011 (command pattern, outbox, confirmation, rule safety), D62 a (refresh after write),
-- D63 a (preview+approve default; auto only within Owner/Admin caps), D64 a (audit/history 25 months).
-- All tables app-owned. No secrets, no PII in any column (conventions §7).

-- ---------------------------------------------------------------------------
-- Commands: persisted intent, one write path for users, rules and (later) the assistant
-- ---------------------------------------------------------------------------
create table ops.commands (
  id                  uuid primary key,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  kind                text not null,                     -- e.g. 'ads.update-targets', 'ads.create-campaign-tree', 'ads.update-portfolios'
  source              core.change_source not null check (source <> 'amazon'),
  actor_user_id       uuid references identity.users (id) on delete set null,
  rule_id             uuid,                              -- when source = rule
  rule_run_id         uuid,
  status              text not null check (status in
                        ('proposed', 'approved', 'queued', 'running', 'succeeded', 'partially_succeeded',
                         'failed', 'cancelled', 'expired')),
  dry_run             boolean not null default false,
  idempotency_key     text,                              -- Idempotency-Key header (409 on reuse with another payload)
  request_hash        bytea,                             -- hash of the normalised payload
  confirmation_hash   bytea,                             -- HMAC matched against confirmationToken (428 flow)
  parent_command_id   uuid references ops.commands (id) on delete set null,
  parent_relation     text check (parent_relation in ('undo', 'retry_failed')),
  item_count          integer not null default 0,
  succeeded_count     integer not null default 0,
  failed_count        integer not null default 0,
  skipped_count       integer not null default 0,
  approved_by         uuid references identity.users (id) on delete set null,
  approved_at         timestamptz,
  expires_at          timestamptz,                       -- proposals expire (status → expired)
  queued_at           timestamptz,
  started_at          timestamptz,
  finished_at         timestamptz,
  trace_id            text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade,
  check (source <> 'rule' or rule_id is not null),
  check (source <> 'user' or actor_user_id is not null or status in ('expired', 'cancelled'))
);
comment on table ops.commands is
  'App-owned (ADR-0011 decision 1). Status flow proposed → approved → queued → running → succeeded | partially_succeeded | failed | cancelled | expired. Retention 25 months (audit horizon). Legacy LogRequestActions (bulk request header) maps here.';
create unique index commands_idempotency_uq on ops.commands (tenant_id, idempotency_key) where idempotency_key is not null;
create index commands_list_idx on ops.commands (seller_account_id, created_at desc);
create index commands_proposed_idx on ops.commands (seller_account_id, created_at desc) where status = 'proposed';
create index commands_active_idx on ops.commands (status, updated_at) where status in ('approved', 'queued', 'running');
create index commands_rule_run_idx on ops.commands (rule_run_id) where rule_run_id is not null;
create trigger commands_touch before update on ops.commands for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ops.commands');

create table ops.command_items (
  id                  uuid primary key,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  command_id          uuid not null,
  item_index          integer not null,                  -- position in the request; 207 results map back by index
  step                smallint not null default 0,       -- tree commands: 0 campaign, 1 ad group, 2 ads, 3 targets …
  entity_type         text not null check (entity_type in
                        ('sp_campaign', 'sp_ad_group', 'sp_ad', 'sp_target', 'portfolio')),
  entity_id           uuid,                              -- our mirror id; NULL for creates until known
  amazon_entity_id    text,                              -- set after create
  operation           text not null check (operation in ('create', 'update', 'archive')),
  before              jsonb,                             -- snapshot from mirror at intent time
  desired             jsonb not null,                    -- patch requested
  sent                jsonb,                             -- payload actually sent (full record for replace APIs, UX-14)
  after               jsonb,                             -- Amazon's returned / re-read state
  evidence            jsonb,                             -- rule metrics per item (ACOS, clicks, window) for review
  status              text not null default 'pending' check (status in
                        ('pending', 'skipped', 'queued', 'sent', 'succeeded', 'failed', 'cancelled')),
  skip_reason         text check (skip_reason in ('cooldown', 'outside_caps', 'clipped', 'unchanged', 'kill_switch', 'stale')),
  error_code          text,                              -- our closed code list (conventions §3)
  error_message       text,                              -- sanitised Amazon message (meta.amazon)
  retryable           boolean,
  attempts            integer not null default 0,
  finished_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (command_id, item_index),
  foreign key (tenant_id, command_id) references ops.commands (tenant_id, id) on delete cascade
);
comment on table ops.command_items is
  'App-owned (ADR-0011 decisions 1, 3). Per-row result for the UI drawer and "retry failed". Legacy LogRequestActivity (per-item bulk result) maps here.';
create index command_items_entity_idx on ops.command_items (seller_account_id, entity_type, entity_id, created_at desc);
create index command_items_status_idx on ops.command_items (command_id, status);
create trigger command_items_touch before update on ops.command_items for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ops.command_items');

-- Transactional outbox: inserted with the command; a relay enqueues `amazon-write` jobs (ADR-0011 decision 2).
create table ops.outbox (
  id                  uuid primary key,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  topic               text not null,                     -- 'amazon-write', 'entity-refresh'
  command_id          uuid,
  payload             jsonb not null,                    -- ids only (tenantId, sellerAccountId, commandId, traceId)
  available_at        timestamptz not null default now(),
  dispatched_at       timestamptz,
  attempts            integer not null default 0,
  last_error          text,
  created_at          timestamptz not null default now(),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table ops.outbox is 'App-owned. At-least-once relay to BullMQ; dispatched rows purged after 7 days.';
create index outbox_pending_idx on ops.outbox (available_at) where dispatched_at is null;
select core.apply_tenant_rls('ops.outbox');

-- ---------------------------------------------------------------------------
-- Audit log: one row per user-visible action (append-only, 25 months)
-- ---------------------------------------------------------------------------
create table ops.audit_log (
  id                  uuid not null,
  tenant_id           uuid not null,
  seller_account_id   uuid,                              -- NULL for tenant-level actions (members, tenant settings)
  occurred_at         timestamptz not null default now(),
  actor_type          text not null check (actor_type in ('user', 'rule', 'assistant', 'system', 'api_token')),
  actor_user_id       uuid,                              -- no FK: audit outlives users
  actor_label         text,                              -- e-mail or rule name at the time (tenant member data, not buyer PII)
  action              text not null,                     -- 'auth.login', 'member.invited', 'connection.connected', 'command.approved', 'rule.updated', 'caps.updated' …
  target_type         text,
  target_id           text,
  command_id          uuid,
  outcome             text not null default 'success' check (outcome in ('success', 'failure', 'partial')),
  details             jsonb not null default '{}',       -- before/after for settings changes; never secrets or PII
  ip_address          inet,
  trace_id            text,
  primary key (id, occurred_at)
) partition by range (occurred_at);
comment on table ops.audit_log is
  'App-owned (ADR-0011 decision 1, PLT-06). Append-only: sh_app gets INSERT/SELECT only. Monthly partitions dropped after SH_AUDIT_RETENTION_MONTHS (25). Legacy OperationLog, OperationActivityLogs, UserActivityLogs, Log map here.';
create index audit_log_tenant_idx on ops.audit_log (tenant_id, occurred_at desc);
create index audit_log_seller_idx on ops.audit_log (seller_account_id, occurred_at desc) where seller_account_id is not null;
create index audit_log_target_idx on ops.audit_log (tenant_id, target_type, target_id, occurred_at desc);
select core.apply_tenant_rls('ops.audit_log', false);
revoke update, delete on ops.audit_log from sh_app;

-- ---------------------------------------------------------------------------
-- Change history: one row per entity field change (History screen, cooldown checks)
-- ---------------------------------------------------------------------------
create table ops.change_history (
  id                  uuid not null,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  changed_at          timestamptz not null,              -- when the change happened (Amazon event time for source=amazon)
  marketplace_id      text,
  entity_type         text not null check (entity_type in ('sp_campaign', 'sp_ad_group', 'sp_ad', 'sp_target', 'portfolio')),
  entity_id           uuid,
  amazon_entity_id    text not null,
  amazon_campaign_id  text,                              -- for campaign-scoped History tabs
  amazon_ad_group_id  text,
  field               text not null check (field in
                        ('state', 'bid', 'default_bid', 'daily_budget', 'bid_strategy', 'placement_adjustment',
                         'name', 'start_date', 'end_date', 'portfolio', 'budget_cap', 'created', 'archived', 'other')),
  field_detail        text,                              -- e.g. placement TOP_OF_SEARCH
  old_value           jsonb,
  new_value           jsonb,
  source              core.change_source not null,       -- user | rule | assistant | amazon
  observed_via        text not null check (observed_via in ('command', 'sync_diff', 'amazon_history')),
  command_id          uuid,                              -- no FK: independent retention
  command_item_id     uuid,
  rule_id             uuid,
  actor_user_id       uuid,
  amazon_event_key    text,                              -- dedupe key for EX-CHANGE-HISTORY events
  recorded_at         timestamptz not null default now(),
  primary key (id, changed_at)
) partition by range (changed_at);
comment on table ops.change_history is
  'App-owned + Amazon history (ADR-0011 decision 1). source=amazon rows come from sync diffs or v0 getHistory (EX-CHANGE-HISTORY; event types/filters in catalog/ads/definitions/Changehistory.json: BID_AMOUNT, BUDGET_AMOUNT, STATUS, PLACEMENT_GROUP, SMART_BIDDING_STRATEGY, NAME, START_DATE, END_DATE, IN_BUDGET). Monthly partitions, 25 months (D64). Legacy CreativeHistories (SB/SD, later) and budget history tables map here.';
create index change_history_entity_idx on ops.change_history (seller_account_id, entity_type, amazon_entity_id, changed_at desc);
create index change_history_campaign_idx on ops.change_history (seller_account_id, amazon_campaign_id, changed_at desc);
create index change_history_seller_idx on ops.change_history (seller_account_id, changed_at desc);
create unique index change_history_amazon_event_uq on ops.change_history (seller_account_id, amazon_event_key, changed_at)
  where amazon_event_key is not null;
select core.apply_tenant_rls('ops.change_history');
revoke update, delete on ops.change_history from sh_app;

-- ---------------------------------------------------------------------------
-- Automation: caps / kill switch per seller account, rules, runs (AUT-01, D63 a)
-- ---------------------------------------------------------------------------
create table ops.automation_settings (
  tenant_id                    uuid not null,
  seller_account_id            uuid primary key,
  automation_paused            boolean not null default false,  -- seller-account kill switch
  auto_run_allowed             boolean not null default false,  -- true only once caps are set by Owner/Admin
  max_change_pct_per_day       numeric(7,2) check (max_change_pct_per_day > 0 and max_change_pct_per_day <= 100),
  bid_floor                    numeric(18,4) check (bid_floor >= 0),
  bid_ceiling                  numeric(18,4),
  currency                     char(3) references ref.currencies (code),
  max_items_per_run            integer check (max_items_per_run > 0),
  max_runs_per_day             integer check (max_runs_per_day > 0),
  cooldown_hours               integer not null default 24 check (cooldown_hours >= 0),
  caps_set_by                  uuid references identity.users (id) on delete set null,
  caps_set_at                  timestamptz,
  updated_at                   timestamptz not null default now(),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade,
  check (bid_ceiling is null or bid_floor is null or bid_floor <= bid_ceiling),
  check (not auto_run_allowed or (max_change_pct_per_day is not null and bid_floor is not null
                                  and bid_ceiling is not null and caps_set_by is not null))
);
comment on table ops.automation_settings is
  'App-owned. Caps (permission automation.caps, Owner/Admin) and kill switch per seller account (ADR-0011 decision 5, D63 a). Global kill switch is env SH_AUTOMATION_DISABLED; tenant switch is core.tenants.automation_paused.';
create trigger automation_settings_touch before update on ops.automation_settings for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ops.automation_settings');

create table ops.rules (
  id                  uuid primary key,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  name                text not null check (length(name) between 1 and 120),
  rule_type           text not null check (rule_type in ('sp_target_bid_by_acos')),  -- AUT-01; AUT-02..08 add values
  version             integer not null default 1,        -- bumped on every change; runs record the version
  is_enabled          boolean not null default false,
  mode                text not null default 'preview_approve' check (mode in ('preview_approve', 'auto_within_caps')),
  -- Scope: all SP targets of the seller account, or listed campaigns / ad groups (our ids).
  scope_kind          text not null default 'all' check (scope_kind in ('all', 'campaigns', 'ad_groups')),
  scope_ids           uuid[] not null default '{}',
  marketplace_id      text references ref.marketplaces (id),
  -- Parameters, validated by the rule type's contract schema; CHECK guards the L0 type's required keys.
  params              jsonb not null,
  schedule_cron       text not null default '0 6 * * *', -- evaluated in schedule_time_zone
  schedule_time_zone  text not null,                     -- marketplace zone when the user picked a local time (conventions §6)
  next_run_at         timestamptz,
  last_run_at         timestamptz,
  created_by          uuid references identity.users (id) on delete set null,
  updated_by          uuid references identity.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade,
  check (scope_kind = 'all' or cardinality(scope_ids) > 0),
  check (rule_type <> 'sp_target_bid_by_acos' or params ?& array['acosAbovePct', 'lookbackDays', 'minClicks', 'decreasePct', 'minBid'])
);
comment on table ops.rules is
  'App-owned. seller-hub rule definitions (AUT-01: "ACOS > X% over N days with clicks >= M → decrease bid Y%, floor Z"). Typed columns for scope/mode/schedule; only type-specific thresholds are in params (legacy trap 16 kept whole rules in JSON). Legacy BiddingRules / OptimizationRuleCPC / Auto* tables are not copied: no legacy logic to port (SCOPE AUT-01).';
create index rules_list_idx on ops.rules (seller_account_id, is_enabled, name);
create index rules_due_idx on ops.rules (next_run_at) where is_enabled;
create trigger rules_touch before update on ops.rules for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ops.rules');

alter table ops.commands
  add constraint commands_rule_fk foreign key (tenant_id, rule_id) references ops.rules (tenant_id, id) on delete set null (rule_id);

create table ops.rule_runs (
  id                       uuid primary key,
  tenant_id                uuid not null,
  seller_account_id        uuid not null,
  rule_id                  uuid not null,
  rule_version             integer not null,
  params_snapshot          jsonb not null,               -- params + mode + caps in force at run time
  trigger                  text not null check (trigger in ('schedule', 'manual', 'dry_run')),
  dry_run                  boolean not null default false,
  status                   text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  skip_reason              text,                          -- 'kill_switch', 'data_not_ready', 'max_runs_per_day'
  data_through_date        date,                          -- last complete marketplace-local day evaluated
  evaluated_count          integer not null default 0,
  matched_count            integer not null default 0,
  proposed_count           integer not null default 0,
  auto_approved_count      integer not null default 0,
  clipped_count            integer not null default 0,
  skipped_cooldown_count   integer not null default 0,
  command_id               uuid,
  error_code               text,
  started_at               timestamptz not null default now(),
  finished_at              timestamptz,
  foreign key (tenant_id, rule_id) references ops.rules (tenant_id, id) on delete cascade,
  foreign key (tenant_id, command_id) references ops.commands (tenant_id, id) on delete set null (command_id)
);
comment on table ops.rule_runs is 'App-owned. One evaluation of a rule; produces at most one command (source=rule). Retention 25 months.';
create index rule_runs_rule_idx on ops.rule_runs (rule_id, started_at desc);
create index rule_runs_seller_idx on ops.rule_runs (seller_account_id, started_at desc);
select core.apply_tenant_rls('ops.rule_runs');

alter table ops.commands
  add constraint commands_rule_run_fk foreign key (rule_run_id) references ops.rule_runs (id) on delete set null;
