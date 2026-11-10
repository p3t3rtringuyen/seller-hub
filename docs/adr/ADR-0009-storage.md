# ADR-0009 — Storage: PostgreSQL layout, partitioning, raw landing, PII, migrations

Status: Accepted (Gate 2, D20, 2026-11-10) · Date: 2026-11-10 · Task: P2-ARCH

## Context

D3 a: PostgreSQL 16. Multi-tenant shared schema with RLS (ADR-0004). Volumes: Ads daily facts per target per day
for up to 24 months of backfill (v1 date retention, `refs/amazon-ads/docs/guides/reporting/ads-v1/limits.md`),
hourly facts later (Stream v2), orders and financial events. D11: no PII in MVP, but the schema must not block it.
Legacy trap 16: GORM auto-schema, one table for three ad products, Amazon ids as strings without typing, JSON
columns for rules; trap 18: soft-delete everywhere with no retention. P2-DATA designs tables; this ADR fixes the
frame.

## Options

**Schema organisation**
| Option | For | Against |
|---|---|---|
| **Postgres schemas by layer/domain** (`identity`, `core`, `ref`, `ingest`, `ads`, `catalog`, `inventory`, `orders`, `finance`, `facts`, `ops`, `pii`) | grants and RLS per layer; clear ownership per module; easy retention per layer | longer qualified names |
| Single `public` schema with prefixes | simple | no grant boundary; ownership blurs |

**Fact partitioning**
| Option | For | Against |
|---|---|---|
| **Native range partitions by month on the local `date`**, created ahead by a maintenance job | pruning on date ranges (every grid query has one); cheap retention by detach/drop; no extension needed in self-host | many partitions over years (~12/yr/table — fine) |
| Hash by tenant + range by date | spreads big tenants | complexity; pruning needs both keys; premature for self-host |
| TimescaleDB hypertables | compression, continuous aggregates | extension not on every managed Postgres; licence nuances; extra moving part |
| No partitioning | simplest | retention = mass DELETE; index bloat at 24-month backfill |

**Query layer / migrations**
| Option | For | Against |
|---|---|---|
| Prisma | popular, migrations | schema DSL hides partitioning/RLS/partial indexes; heavy engine |
| Drizzle (schema in TS + drizzle-kit) | typed, light | DDL drafts from P2-DATA are SQL; partitions/RLS end up as raw SQL anyway |
| **Kysely (typed SQL builder) + types generated from the live schema (kysely-codegen) + plain SQL migrations run by node-pg-migrate** | SQL-first matches `db/design` DDL; full Postgres feature use (partitions, RLS, `ON CONFLICT`, generated columns); types follow the real DB | two steps (migrate → codegen); no ORM conveniences |

## Decision

1. **Schemas**: `identity` (users, sessions, api_tokens), `core` (tenants, memberships, grants, invitations,
   seller accounts, connections, credentials), `ref` (marketplaces, time zones, currencies, Ads limits — global,
   no tenant), `ingest` (sync_states, job_runs, inbox, raw_objects index), domain mirrors `ads`, `catalog`,
   `inventory`, `orders`, `finance`, `facts` (metric facts), `ops` (commands, command_items, audit_log,
   change_history, rules, rule_runs), `pii` (empty in MVP).
2. **Mirror tables**: one table per Amazon entity and ad product where attributes differ (SP first; SB/SD tables
   later rather than one wide table — trap 16), Amazon ids `text`, Amazon enums as Postgres enums or checked text
   citing the model file, `raw jsonb` column with the last Amazon payload for fields we do not model yet, plus
   `amazon_last_updated_at`, `synced_at`, `deleted_at` (deleted on Amazon / archived).
3. **Facts**: `facts.<grain>` tables, e.g. `facts.ads_sp_target_daily`, partitioned by **month on `date`
   (marketplace local date)**; PK includes `(tenant_id, seller_account_id, date, …)`. A maintenance job creates
   partitions 3 months ahead and detaches beyond retention. Aggregates for grids (campaign/day) are separate
   summary tables refreshed by the ingestion run that touched them.
4. **Raw landing**: S3-compatible object storage (MinIO in self-host, S3 in cloud), keys per ADR-0008, server-side
   encryption on, bucket lifecycle deletes `raw/` after **35 days** by default (`SH_RAW_RETENTION_DAYS`); index rows in
   `ingest.raw_objects`. Exports (later, PLT-09) under `exports/` with signed URLs, 7 days.
5. **Retention defaults** (configurable; D64 asks the user to confirm): raw payloads 35 d; `ingest.job_runs` 90 d;
   `ops.audit_log` and `ops.change_history` 25 months (≥ the 24-month facts horizon); facts kept while the seller
   account exists; sessions 30 d after expiry; invitations 30 d after expiry. A nightly `maintenance.purge` job applies
   them; no soft-delete without a purge rule (trap 18).
6. **PII (later, D11)**: separate `pii` schema, columns encrypted with the vault (ADR-0005) under a distinct key
   kind, access only via a dedicated repository requiring a `PiiAccess` capability, purge per Amazon's Data
   Protection Policy retention (30 days after shipment unless legally required) by a scheduled job; never joined
   into facts or logs. Nothing is created in MVP beyond the empty schema.
7. **Access layer**: Kysely; `packages/db` exposes `withScope(scope, fn)` → transaction with `SET LOCAL
   app.tenant_id` (+ `app.seller_account_id` when present) for RLS. Types generated after migrations by
   `kysely-codegen` into `packages/db/src/generated` (committed).
8. **Migrations**: plain SQL, **forward-only**, `node-pg-migrate` runner with a lock; files live with their
   module (`modules/<m>/migrations/<UTC timestamp>_<m>_<desc>.sql`) and the generated index orders them by
   timestamp (ADR-0001). Platform/shared ones in `packages/db/migrations`. Destructive changes use expand → migrate
   → contract across releases; no `DROP` of data columns in the same release that stops writing them.
9. Postgres settings documented for self-host: `shared_buffers`, `work_mem`, autovacuum on facts; connection
   pooling via the app pool (PgBouncer optional in cloud, transaction mode is compatible with `SET LOCAL`).

## Consequences

- P2-DATA writes DDL in `db/design/` per these schemas and must show the partition key, RLS policy and natural key
  for each table.
- RLS + partitions: policies are declared on the parent table and apply to partitions.
- Two DB roles: `sh_owner` (migrations, maintenance) and `sh_app` (no `BYPASSRLS`).

## Revisit when

A single fact table exceeds ~500 M rows or grids miss latency targets (consider Timescale/columnar or a separate
analytics store), or PII enters scope.
