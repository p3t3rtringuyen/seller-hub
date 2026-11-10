# P2-DATA report — data model

Status: DONE (Docker check SKIPPED; substitute check on PostgreSQL 16.4 passed). Main checkout, nothing committed.

## What I did

Designed the seller-hub database from Amazon's models, the legacy entity inventory and the 23 MVP rows of
`docs/SCOPE.md`, inside the frame of ADR-0004/0005/0008/0009/0011 and `conventions.md`.

- 12 schemas per ADR-0009 (`identity, core, ref, ingest, ads, catalog, inventory, orders, finance, facts, ops`,
  `pii` empty). The prompt's older names (`raw`, `fact`, `app`, `core.sync_state`) are mapped to the ADR names
  (README §1).
- **57 tables**: identity 6, core 11, ref 4, ingest 4, ads 6, catalog 3, inventory 1, orders 2, finance 3,
  facts 9, ops 8. 13 are monthly range-partitioned (9 facts + `job_runs`, `raw_objects`, `audit_log`,
  `change_history`).
- L0 first: files `00`–`07` cover PLT-01/03/04/05/06/07, ADS-01/02/03, AUT-01; `08`–`12` the rest of the MVP
  (PLT-02, CAT-01/02, ADS-04..09, INV-01, ORD-01/02, FIN-01). Migration split per slice in README §6.
- Every Amazon-derived table and column cites its model (`catalog/ads/definitions/*`, `catalog/spapi/definitions/*`,
  `catalog/ads/reports.json` v1 fields, `catalog/spapi/reports.json`, `refs/amazon-ads/docs/reference/concepts/limits.md`)
  in SQL comments and in `mapping.md`.
- Tenancy: every seller-data table has `tenant_id` + `seller_account_id`; natural keys unique per seller account;
  composite FKs `(tenant_id, x_id)` so a row cannot reference another tenant's parent; RLS policy on every tenant
  table via `core.apply_tenant_rls` (fail-closed when the scope is unset).
- Decisions applied: D4 (all NA/EU/FE marketplaces seeded, US enabled; currency, zone, limits as data), D5/D60
  (`account_type seller|vendor`, nullable SKU on ads, no vendor tables), D11 (no PII; `pii` schema empty; orders keep
  coarse geography only; seam described in README §5), D53 (v1 entities; v0 exceptions EX-PORTFOLIOS, EX-PROFILES,
  EX-CHANGE-HISTORY named), D57 a (only v1 report fields; unconfirmed coverage nullable; v3-only metrics not
  modelled), D62 a (mirror + refresh after write via `ops.outbox` topic `entity-refresh`), D63 a (rule `mode`
  default `preview_approve`; `auto_within_caps` only when `ops.automation_settings.auto_run_allowed`, which a CHECK
  ties to caps set by a user), D64 a (retention table README §4, env names), D55 (5 fixed roles in
  `core.role_grants`), D59 (SP limits as `ref.ads_limits` rows).
- Legacy coverage: all 17 `amazon-mirror` and 19 `app-owned` entities have a home or a reason (mapping.md §3).
  No legacy code, names or hostnames used (D0).

## Files created

- `db/design/00_foundation.sql` — schemas, pg_trgm, roles `sh_owner`/`sh_app`, default privileges, scope functions,
  `core.apply_tenant_rls`, `core.ensure_monthly_partitions`, `core.touch_updated_at`, enum `core.change_source`
- `db/design/01_ref.sql` — regions, currencies, 23 marketplaces, SP bid/budget limits (69 rows)
- `db/design/02_identity.sql`, `03_core.sql`, `04_ingest.sql`, `05_ads.sql`, `06_facts_ads.sql`, `07_ops.sql` (L0)
- `db/design/08_catalog.sql`, `09_inventory.sql`, `10_orders.sql`, `11_finance.sql`, `12_facts_ops.sql` (MVP)
- `db/design/99_partitions.sql` — initial partitions for the design check (P3 calls the helper per module)
- `docs/data-model/README.md` — layers, conventions, partitioning, retention, PII seam, migrations per slice,
  list-screen indexes, stub list of non-MVP domains with source definitions
- `docs/data-model/mapping.md` — per table source / refresh / retention / PII; column → field mappings; legacy coverage
- `docs/data-model/erd-{identity,core,ref,ingest,ads,catalog,inventory,orders,finance,facts,ops}.md` — mermaid ERDs
- `docs/reports/P2-DATA.md` — this report

## Commands run and results

| Command | Result |
|---|---|
| `docker info` (start of task and again before the report) | failed — Docker Desktop not running. **Docker apply check SKIPPED** (not started or reconfigured, per brief) |
| `npm install --ignore-scripts @electric-sql/pglite@0.2.17` in the session scratchpad (outside the repo) | ok — PGlite = PostgreSQL **16.4** compiled to WASM, with the `pg_trgm` contrib extension |
| `node check.mjs db/design` (scratchpad script: applies every `db/design/*.sql` in name order with the real Postgres parser/executor, then checks) | **all 14 files applied: OK**. Catalog checks: 0 tenant tables without RLS; 0 seller-data tables missing `tenant_id`/`seller_account_id` |
| same script, RLS smoke test as role `sh_app` with 2 tenants | tenant 1 sees only its campaign, tenant 2 only its own; no scope → 0 rows; tenant 1 + other tenant's seller account → 0 rows; facts filtered per tenant across partitions; audit filtered; `ref` readable (23 marketplaces, US SP limits 0.02–1000 bid, 1–1 000 000 budget); **cross-tenant INSERT rejected** ("new row violates row-level security policy"); **DELETE on `ops.audit_log` rejected** ("permission denied"); re-running `99_partitions.sql` idempotent |

The orchestrator can still run the brief's Docker check when Docker is up (unique name, non-default port):

```bash
docker run --rm -d --name sh-ddl-check-p2data -e POSTGRES_PASSWORD=check -p 55432:5432 postgres:16
for f in db/design/*.sql; do PGPASSWORD=check psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 -q -f "$f" || break; done
docker stop sh-ddl-check-p2data
```

## Checks skipped

- **Docker / native Postgres 16 apply — SKIPPED**: Docker Desktop not running. Substituted by PGlite (same
  PostgreSQL 16 parser/planner/executor in WASM, single-user). Differences that matter: PGlite runs as a
  superuser, so role login/`CREATE ROLE` behaviour of a managed Postgres is not exercised; extension availability
  on the target host (`pg_trgm`) must be confirmed in P3-SCAFFOLD.
- No performance/EXPLAIN checks on realistic volumes (no data yet).

## Open questions / items to verify

1. **Ads v1 report coverage (D57)**: whether SP search-term rows carry sales/purchases/units, placement rows carry
   conversions, and target rows carry top-of-search impression share — columns are nullable until a live report
   is pulled (P3/P4 with a real account).
2. **Marketplace time zones**: only US is confirmed by refs (`profiles.md`); the others are defaults in
   `ref.marketplaces` and are overridden by each linked Ads profile's `timezone`. Confirm when non-US launches.
3. **`limits.md` EG SP max bid 5.50** looks like a doc typo next to SD 7400; copied verbatim and flagged.
4. **Placement adjustment range 0–900 %** is a console/legacy rule, not in the v1 model; kept as CHECK, revisit if
   Amazon changes it (D59 console detail still pending).
5. **Better Auth table mapping** onto `identity.*` column names is P3-IDENTITY's call; tables may gain columns
   the library needs.

## Follow-ups

- P3-SCAFFOLD/P3-INGEST: move `00_foundation` helpers into `packages/db` migrations; implement
  `maintenance.partitions` and `maintenance.purge` with the retention envs of README §4.
- P2-BACKLOG: use README §6 (migrations per slice) and §8 (stubs) when cutting tasks.
- Each repository test must prove cross-tenant invisibility with RLS on (CLAUDE.md); the smoke test in this report
  is the pattern (set `app.tenant_id` / `app.seller_account_id`, `SET LOCAL ROLE sh_app`).
