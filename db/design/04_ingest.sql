-- seller-hub data model — 04 ingest (sync engine state)
-- Slice: L0 (PLT-05). Frame: ADR-0008 (DB-driven schedule, resumable runs, raw landing, inbox),
-- ADR-0009 decision 4/5 (raw 35 d, job runs 90 d), D64 a.

-- One row per (seller account, sync key[, scope]) — the scheduler tick enqueues rows that are due.
create table ingest.sync_states (
  id                  uuid primary key,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  sync_key            text not null,                    -- SyncDefinition.key, e.g. 'ads.sp-report-daily'
  scope_key           text not null default '',         -- marketplace id / ads profile id when a sync is per scope
  status              text not null default 'idle'
                      check (status in ('idle', 'scheduled', 'running', 'failing', 'paused', 'disabled')),
  paused_reason       text,                             -- 'needs_reauth', 'user', 'tenant_suspended'
  next_run_at         timestamptz,                      -- "refresh now" = set to now()
  last_started_at     timestamptz,
  last_success_at     timestamptz,                      -- lag = now() - last_success_at (sync health)
  last_failure_at     timestamptz,
  consecutive_failures integer not null default 0,
  last_error_code     text,
  cursor              jsonb not null default '{}',      -- e.g. {"lastUpdatedAfter": "...", "overlapMinutes": 15}
  backfill            jsonb,                            -- backfill plan progress (ADR-0008 decision 7)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (seller_account_id, sync_key, scope_key),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table ingest.sync_states is
  'App-owned. DB-driven schedule and cursor per seller account x sync (ADR-0008 decisions 2, 6, 11). Replaces legacy full re-pulls (trap 10).';
create index sync_states_due_idx on ingest.sync_states (next_run_at) where status in ('idle', 'scheduled', 'failing');
create trigger sync_states_touch before update on ingest.sync_states for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ingest.sync_states');

-- Resumable state machine per run (ADR-0008 decision 3). Partitioned by month; 90-day retention (D64).
create table ingest.job_runs (
  id                  uuid not null,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  sync_state_id       uuid,
  sync_key            text not null,
  family              text not null check (family in
                        ('paged-pull', 'spapi-report', 'ads-report', 'ads-export', 'sync-read',
                         'data-kiosk', 'spapi-notification', 'stream', 'entity-refresh')),
  priority_class      text not null check (priority_class in ('interactive', 'scheduled', 'backfill')),
  job_key             text not null,                    -- {syncKey}:{sellerAccountId}:{windowStart}:{windowEnd}
  window_start        timestamptz,
  window_end          timestamptz,
  state               text not null default 'requested'
                      check (state in ('requested', 'processing', 'downloading', 'parsing', 'upserting', 'done', 'failed', 'cancelled')),
  amazon_request_id   text,                             -- reportId / exportId / queryId once known (never re-requested)
  amazon_document_id  text,
  attempts            integer not null default 0,
  rows_upserted       integer,
  error_code          text,
  error_detail        text,                             -- sanitised: no tokens, no PII (conventions §7)
  trace_id            text,
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  updated_at          timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
comment on table ingest.job_runs is
  'App-owned. One row per ingestion run; resumable from state + amazon_request_id. Monthly partitions on created_at, dropped after SH_JOB_RUN_RETENTION_DAYS (default 90).';
create index job_runs_seller_idx on ingest.job_runs (seller_account_id, created_at desc);
create index job_runs_key_idx on ingest.job_runs (job_key, created_at);
create index job_runs_open_idx on ingest.job_runs (state, updated_at) where state not in ('done', 'failed', 'cancelled');
create trigger job_runs_touch before update on ingest.job_runs for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ingest.job_runs');

-- Index of raw documents landed in object storage (ADR-0008 decision 4, ADR-0009 decision 4).
create table ingest.raw_objects (
  id                  uuid not null,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  job_run_id          uuid,
  sync_key            text not null,
  object_key          text not null,                    -- raw/{tenant}/{sellerAccount}/{syncKey}/{yyyy}/{mm}/{dd}/{runId}/{part}
  part                integer not null default 0,
  content_type        text,                             -- e.g. application/json, text/tab-separated-values
  compression         text check (compression in ('none', 'gzip')),
  byte_size           bigint,
  sha256              bytea,
  source_ref          text,                             -- Amazon report type / ads report config / export type
  landed_at           timestamptz not null default now(),
  expires_at          timestamptz not null,             -- landed_at + SH_RAW_RETENTION_DAYS (35)
  primary key (id, landed_at)
) partition by range (landed_at);
comment on table ingest.raw_objects is
  'App-owned index of raw payloads in S3/MinIO. The bucket lifecycle deletes objects after 35 days; partitions are dropped on the same horizon (D64).';
create index raw_objects_run_idx on ingest.raw_objects (job_run_id);
create index raw_objects_seller_idx on ingest.raw_objects (seller_account_id, landed_at desc);
select core.apply_tenant_rls('ingest.raw_objects');

-- Push sources (SP-API notifications, Marketing Stream) — used from v1 (PLT-11, PLT-12); created now
-- because P3-INGEST builds the inbox with the engine (ADR-0008 decision 10). Replay = reset status.
create table ingest.inbox (
  id                  uuid primary key,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  source              text not null check (source in ('spapi-notification', 'marketing-stream')),
  message_id          text not null,                    -- SQS / notification id; dedupe key
  message_type        text not null,                    -- e.g. ORDER_CHANGE, ads-performance-v1
  payload             jsonb not null,                   -- notification body (no PII: ORDER_CHANGE carries none)
  status              text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts            integer not null default 0,
  error_code          text,
  received_at         timestamptz not null default now(),
  processed_at        timestamptz,
  unique (source, message_id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table ingest.inbox is
  'App-owned. Push messages persisted before ack (ADR-0008 decision 10; trap 14: no separate DLQ table). Notification types: catalog/spapi/notifications.json; stream datasets: catalog/ads/stream.json. Retention: done rows 35 days (raw horizon), failed rows until replayed or 90 days.';
create index inbox_pending_idx on ingest.inbox (status, received_at) where status in ('pending', 'failed');
select core.apply_tenant_rls('ingest.inbox');
