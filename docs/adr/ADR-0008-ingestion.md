# ADR-0008 — Ingestion engine

Status: Accepted, pending Gate 2 (D20) · Date: 2026-11-10 · Task: P2-ARCH

## Context

PLT-05 (L0) is the main technical risk (SCOPE §5 risks 4, 5): low SP-API rates, Ads report concurrency possibly 1,
async reports, restatements. D3 a fixes BullMQ on Redis. D57 a: Ads **v1 reports only** (no Reporting v3).
D58 a: Marketing Stream v2 in v1 (seller's own S3 + SQS in self-host). D62 a: one freshness mode (mirror +
refresh after write + per-campaign refresh). Legacy trap 10: full re-pulls with no incremental state; trap 14:
DLQ + table + manual replay. Slices must add sync definitions without editing shared files.

Job families needed (sources: `catalog/spapi/operations.json`, `catalog/spapi/reports.json`,
`catalog/spapi/data-kiosk.json`, `catalog/spapi/notifications.json`, `catalog/ads/operations.json`,
`catalog/ads/reports.json`, `catalog/ads/stream.json`):

| Family | MVP users | Shape |
|---|---|---|
| Paged pull | ADS-01 (v1 `SPQuery*`, `nextToken`), INV-01 (`getInventorySummaries`), FIN-01 (`listTransactions`), CAT-01 (`searchListingsItems`), ORD-02 incremental (`searchOrders`), ADS-09 (v0 portfolios), PLT-06 (`getHistory`) | request → page → upsert → cursor |
| SP-API report | CAT-01 (`GET_MERCHANT_LISTINGS_ALL_DATA`), ORD-02 backfill (`GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL`) | createReport → poll getReport → getReportDocument → download (maybe gzip) → parse TSV → upsert |
| Ads v1 report | ADS-02, ADS-07 | AdsApiv1CreateReport → poll RetrieveReport → download (GZIP_JSON) → parse → upsert facts |
| Ads export (EX-EXPORTS) | ADS-01 daily full | create export (202) → poll GetExport → download → reconcile mirror (detect deletions) |
| Sync read | ORD-01 (`getOrderMetrics`), PLT-02 participations | one call per window → upsert |
| Data Kiosk | v1 (ORD-03, FIN-03) | createQuery → poll → getDocument → download → parse |
| SP-API notifications | v1 (PLT-11) | SQS consume → inbox → fetch-after-notify |
| Marketing Stream v2 | v1 (PLT-12) | SQS consume → S3 Parquet → upsert facts by `streamBatch.version` |

## Options

**Queue / workflow engine**
| Option | For | Against |
|---|---|---|
| **BullMQ (OSS) + our own state tables** | D3 a; Redis already needed for limiter/cache; delayed jobs, priorities, retries, flows | no per-group concurrency in OSS (BullMQ Pro has groups); durable step state must be ours |
| BullMQ Pro (groups, group rate limits) | per-seller concurrency built in | paid licence shipped to self-hosters |
| Temporal | durable multi-step workflows, timers | extra cluster per self-host; contradicts D3 a |
| pg-boss (Postgres queue) | one fewer service | weaker throughput / delayed-job ergonomics; D3 a names BullMQ |

**Scheduling**
| Option | For | Against |
|---|---|---|
| BullMQ job schedulers (repeatable) per (seller account, sync) | built in | thousands of repeatables in SaaS; hard to see/edit per tenant; backfill and "due now" logic scattered |
| **DB-driven schedule: `ingest.sync_states` row per (seller account, sync key) with `next_run_at`, cursor, status; one scheduler tick per minute (leader lock) enqueues due runs** | visible, queryable sync health (lag = now − last_success); per-tenant pause; manual "refresh now" = set `next_run_at = now()` | we write the tick (small) |

## Decision

1. **BullMQ OSS** with queues per family and priority: `interactive` (refresh-after-write, per-campaign refresh,
   priority 1), `scheduled` (5), `backfill` (10). Amazon writes use a separate `amazon-write` queue (ADR-0011).
2. **Plug-in registry**: a module declares `SyncDefinition`s in `modules/<m>/src/sync/*.sync.ts`:

```ts
defineSync({
  key: 'ads.sp-report-daily',          // unique, also the queue job name
  family: 'ads-report',                 // which runner executes it
  appliesTo: { api: 'ads', accountTypes: ['seller', 'vendor'], adProducts: ['SP'] },
  schedule: { every: '6h', jitter: '30m', localTimeWindow: null },
  window: { lookbackDays: 3, backfillDays: 730, maxRangeDays: 31 }, // v1 date retention 24 months, 120-day max range
  operations: ['AdsApiv1CreateReport', 'AdsApiv1RetrieveReport'],   // checked against catalog at build
  buildRequest, parse, upsert,          // module code
})
```

   `tools/registry` collects these into a generated file the worker imports (ADR-0001); the build fails if a key
   repeats or an operation is not in the client allow-list.
3. **Runners** in `packages/ingestion` implement each family as a **resumable state machine** persisted in
   `ingest.job_runs` (`requested → processing → downloading → parsing → upserting → done | failed`, with the Amazon
   report/export/query id). A crashed or delayed job resumes from its last state — it never re-requests a report it
   already has an id for. Polling uses delayed re-enqueue (no sleeping workers).
4. **Raw landing**: downloaded documents are streamed (gunzip on the fly) to object storage at
   `raw/{tenant}/{sellerAccount}/{syncKey}/{yyyy}/{mm}/{dd}/{runId}/{part}` before parsing; parse reads from there.
5. **Idempotency**: job id = `{syncKey}:{sellerAccountId}:{windowStart}:{windowEnd}`; upserts by natural key;
   facts for a window are replaced (delete+insert inside one transaction per partition-window, or `ON CONFLICT DO
   UPDATE`), so restatements converge. Stream v2 rows keep the highest `streamBatch.version` (`catalog/ads/stream.json`).
6. **Cursors**: per `sync_state` (`cursor jsonb`): `lastUpdatedAfter` with an overlap (e.g. 15 min for orders,
   inventory change date), `nextToken` only within a run. **Never** a full re-pull on schedule; ADS-01 runs a
   daily export reconciliation for deletions plus frequent v1 query of recently changed entities.
7. **Backfill**: on first connect, a backfill plan splits history into windows (Ads daily: 24 months, ≤ 120-day
   ranges → we use 31-day chunks; orders: report windows), enqueued at `backfill` priority, newest first, so
   screens fill from today backwards.
8. **Per-seller concurrency and fairness**: a Redis semaphore per (seller account, family) (default 2) checked at
   job start; if taken, the job is delayed with jitter. Amazon pacing is the limiter's job (ADR-0006); the
   semaphore keeps one tenant from occupying all worker slots. Worker concurrency per queue is config.
9. **Freshness (D62 a)**: after a command succeeds, the executor enqueues `interactive` entity refresh jobs for
   the touched ids; "Refresh" on a campaign enqueues the same for that campaign tree + today's metrics.
10. **Push sources** (v1): an SQS poller per configured destination writes each message to `ingest.inbox`
    (unique by message id) and deletes it from SQS only after the insert; a job processes inbox rows (SP-API:
    fetch the object again before acting — `reference-patterns.md` §1.3; Stream: download Parquet from the seller's
    bucket, upsert facts). Failed rows stay in the inbox with error and attempts; replay = reset status (no DLQ table
    beside it, trap 14).
11. **Failure policy**: Amazon throttling = delay, not failure; `ConnectionNeedsReauth` pauses all syncs of that
    connection; other errors retry with backoff (max attempts per family) then mark `sync_state.status = failing`
    (visible in sync health, alert per ADR-0013).

## Consequences

- P3-INGEST builds runners, scheduler tick, registry generator, inbox, sync health API; modules only write
  definitions + parse/upsert functions.
- Sync health is a table query, which feeds observability (ADR-0013) and the UI freshness badge.
- Report concurrency 1 per app means a large tenant's backfill can delay others' daily reports: the limiter's fair
  round-robin plus `scheduled` > `backfill` priority bound this.

## Revisit when

A workflow needs human/timer steps longer than days (consider Temporal), or SaaS volume needs per-group limits
(BullMQ Pro) beyond the semaphore.
