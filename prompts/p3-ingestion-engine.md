# P3-INGEST — Ingestion engine

Model: Sonnet · checkout: worktree (commit on your branch)
OWNED_PATHS: `apps/worker/**`, `packages/ingestion/**`, migrations for the `raw` schema and
`core.sync_state` / job-run tables, `docs/architecture/ingestion.md`, `docs/reports/P3-INGEST.md`

## Goal

A generic engine that keeps every connected seller's data fresh, so a slice only declares *what*
to sync, not *how*.

## Inputs

Ingestion and storage ADRs; `docs/data-model/*`; `catalog/spapi/{operations,reports,notifications}`;
`catalog/ads/{reports,stream}`; `packages/amazon-*`; `docs/discovery/reference-patterns.md`
(`notifications`, `data-kiosk`).

## Build

- **Sync definition** interface — a slice adds one file: id, schedule, job type, parameters,
  parser, upsert target, natural key. Discovered through the registry (shared-file protocol).
- Job types: paged API pull; SP-API report (create → poll → download → decompress → parse TSV /
  JSON / XML → batch upsert); Data Kiosk query; Ads v1 report (no Reporting v3, D57 a); Ads export snapshot; SP-API
  notification consumer (SQS → handler registry); Marketing Stream consumer (SQS).
- Scheduler per seller account and marketplace, with jitter; per-seller concurrency limit;
  priority for user-triggered refreshes.
- Idempotency, cursors in `sync_state`, retries with backoff, dead-letter, and a job-run table
  (status, rows, duration, throttles, error).
- Raw landing: payload / document pointer in object storage with retention.
- Backfill command (date range, seller account, definition).
- A demo definition: the merchant listings report → a listings table, run against fixtures.
- `docs/architecture/ingestion.md`: how to write a sync definition, how to test it, and the AWS
  setup for notifications (SQS queue policy, subscription calls) for when R7 is available.

## Done when

Gate command green; the demo definition runs end-to-end from fixtures into Postgres; tests cover
retry after 429, resume from cursor after a crash, duplicate notification ignored.
