# P2-DATA — Data model

Model: Opus · checkout: main · do not commit
OWNED_PATHS: `docs/data-model/**`, `db/design/**`, `docs/reports/P2-DATA.md`

## Goal

The database seller-hub owns, designed from Amazon's models (the truth about Amazon objects), the
legacy inventory (which fields and app-owned concepts the business actually uses), and the MVP
scope. Your DDL becomes the first migrations in P3.

## Inputs

`docs/adr/*` (storage, tenancy, ingestion, writes), `docs/architecture/conventions.md`,
`docs/SCOPE.md` (MVP ticks), `catalog/spapi/{definitions,reports,notifications}`,
`catalog/ads/{definitions,reports,stream}`, `catalog/legacy/entities.json`,
`docs/discovery/legacy-api-domain.md`.

## Design rules

- Schemas by layer: `core` (tenants, users, memberships, roles, seller_accounts, marketplaces,
  ads_profiles, credentials, sync_state), `raw` (landing metadata: payload / report-document
  pointers), one schema per domain for normalised Amazon objects (catalog, orders, inventory,
  inbound, finance, pricing, ads), `fact` (time series), `app` (rules, rule_runs, alerts, tasks,
  notes, audit_log, change_history, user settings, user-provided costs).
- Every seller-data row: `tenant_id`, `seller_account_id`; Amazon natural key (marketplace id +
  Amazon id) unique within the seller account; surrogate key per the conventions ADR.
- Money: `numeric(18,4)` + currency code. Timestamps: `timestamptz`. Facts also carry the
  marketplace-local date they belong to.
- Facts partitioned by month: ads metrics daily (per campaign / ad group / target / keyword /
  search term / ad), ads metrics hourly (Marketing Stream), sales & traffic daily (per ASIN),
  inventory snapshot daily, fees and settlements.
- History tables for bid, budget, state and placement changes, with source = user | rule | amazon.
- PII only in dedicated tables, encrypted columns, with a purge job's retention noted. Skip
  entirely if D11 = no, but leave the place for it in the README.
- Indexes for every list screen's default sort and filters (take them from
  `catalog/legacy/web-features.json`).
- Model only MVP domains in full. Others: a stub list in the README with their source definitions.

## Outputs

- `docs/data-model/README.md` — layers, conventions, naming, partition and retention policy, how
  migrations will be split per slice.
- `docs/data-model/erd-<schema>.md` — mermaid ER diagram per schema.
- `docs/data-model/mapping.md` — for each table: its source (Amazon definition path / report type /
  stream dataset / legacy entity / app-owned), column → source field mapping, refresh mode
  (report, pull, notification, stream, user), retention, PII flag.
- `db/design/NN_<schema>.sql` — PostgreSQL 16 DDL, in dependency order.

## Validate

Apply the DDL to a throwaway Postgres 16: `docker run --rm -d --name sh-ddl-check -e
POSTGRES_PASSWORD=check -p 55432:5432 postgres:16`, apply every file in order with `psql`, then
`docker stop sh-ddl-check`. Report the exact result. If Docker is unavailable, say the check was
skipped.

## Done when

DDL applies cleanly; every MVP feature's data has a table; every table has a mapping row; every
legacy `amazon-mirror` and `app-owned` entity in MVP scope has a home or a reason it has none.
