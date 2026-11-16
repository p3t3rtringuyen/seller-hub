# P5-REVIEW — P3-INGEST

Reviewer: Opus (P5-REVIEW-P3-INGEST) · Branch `refs/heads/claude/p3-ingest-5d7cbd` @ `ffe37b7` (5 commits, 38 files,
+5.9k) · Base `main` @ `ecf992d` · Static review in the main checkout (read-only) + no-DB unit tests in the task worktree.

## Verdict

**MERGE-AFTER-FIXES** (= `CHANGES_REQUIRED`) — **1 blocker, 6 major must-fix**, 2 major may-fix-later, 10 minor.

The engine is well structured: tenancy is enforced by `withScope` + explicit `tenant_id`/`seller_account_id` predicates
on every scoped query and the cross-tenant test is real (repository reads, `processRun` under the wrong scope, raw SQL
on all four `ingest` tables, RLS `WITH CHECK`, missing scope). Job payloads carry ids only; logs carry ids only; S3
keys are `raw/{tenant}/{sellerAccount}/…`; Ads uses v1 only (asserted by a test); tests use mock/replay transports
only (D30). Ownership is clean (all files in the PLAN row; `pnpm-lock.yaml` only as a shared regen). The branch
merges cleanly with `main` and with `claude/p3-identity-8a0f9d` (`git merge-tree`, no conflicts).

What fails is run **concurrency control**: nothing stops two step chains from processing the same run, and the
scheduler creates such chains routinely. The other must-fixes are idempotency of raw landing, dates, error states
and the integration seams.

## Must fix before merge

### B1 (blocker) — Duplicate step chains per run: no per-run exclusion, and stale detection fires on healthy runs

- `packages/ingestion/src/scheduler.ts:135-138` (stale re-enqueue), `:131` (tick "resumed"), `:212` (refresh on an
  open run), `:256` (backfill of an open window); `apps/worker/src/ingest.ts:227-231`;
  `packages/ingestion/src/repository.ts:678-688`; `packages/ingestion/src/engine.ts:400-405`, `:245-246`, `:651-653`.
- Each of these paths enqueues the run again with `jobId = ${runId}-${epochSeconds}`; the worker then continues
  *that* chain with `step + 1`. The original chain (`${runId}-1, -2, …`) keeps going too, so the job ids never
  collide and BullMQ's dedup never applies. `processRun` has no per-run lock — only the per-seller × family gate
  (default 2), so two chains of the same run execute **concurrently**.
- `findStaleRuns` treats "`updated_at` older than 10 min" as "worker died". But a poll that is not ready writes
  nothing (`engine.ts:400-405`), a gate-busy delay writes nothing, and a throttle writes once and then waits
  `Retry-After` (the 429 test uses ≥ 600 s). So every healthy run that waits more than 10 minutes looks dead.
- Failure scenario: a `GET_MERCHANT_LISTINGS_ALL_DATA` report for a large catalogue takes 30 min. At minute 11 the
  tick adds chain #2, at minute 12 chain #3 … by minute 30, ~20 chains each call `getReport` every 30 s through
  the seller's token bucket (throttling the seller's other syncs). When the report is DONE, two chains enter
  `downloading` together, both download and land → `raw_objects` holds part 0 twice → `readLanded` returns the
  document twice → `texts.join("")` glues a second header line onto the data, which the demo parser upserts as a
  listing with SKU `seller-sku`. An Ads v1 report gets its parts twice (facts doubled, or an
  `ON CONFLICT DO UPDATE command cannot affect row a second time` error from a multi-row upsert, which fails the run).
  Two chains in `requested` both call `createReport` / `AdsApiv1CreateReport` (two Amazon reports, one orphaned).
  The same happens without a tick: the user presses "Refresh now" twice on an entity refresh (same job key) →
  `requestRefresh` finds the open run and deliberately starts a second chain (comment at `scheduler.ts:211`).
- Fix (both parts):
  1. **Exclusion**: in `processRun`, take a per-run lease (`gate.tryAcquire("ingest:run:" + runId, 1, ttl)`); if it
     is held, *drop* this chain (`done: true`), don't delay it. Better still, make the chain unique: persist the
     current step (or a chain token) on `job_runs`, put it in the payload, and have `processRun` drop any payload
     whose step ≠ the stored one (compare-and-set when advancing).
  2. **Heartbeat**: write `job_runs` (e.g. `next_step_at = now + delayMs`, or at least touch `updated_at`) every
     time a step returns `done: false`. Then stale = "overdue past its own scheduled step + grace", not "unchanged
     for 10 min". The resumed/refresh/backfill paths must not start a chain while one is live. They can bump
     priority by re-adding with the live chain's next job id, or simply rely on the live chain.
  - Tests: two concurrent `processRun` on one run → one `createReport`; a 25-min poll with ticks every minute → one
    chain; refresh twice on an open run → one chain.

### M1 (major) — Raw landing is not idempotent on retry

- `packages/ingestion/src/engine.ts:414-421` and `:463-495`; `packages/ingestion/src/repository.ts:383-407`;
  `engine.ts:457` (`texts.join("")`).
- `land()` puts each part and inserts its index row in a separate transaction. `markState("parsing")` comes only
  after all parts. `raw_objects` has no unique key on `(job_run_id, part)` (partitioned on `landed_at`). A retry in
  `downloading` lands every part again: S3 PUT of part 1 fails after part 0 is indexed, or the worker dies before
  `parsing`, or B1 runs it twice.
- Failure scenario: an Ads report with 2 parts. The part 1 PUT returns 503, which is retryable, so the step runs
  again → index rows `[0, 0, 1]` → `parse` sees part 0 twice → duplicate facts or a failed upsert. Across UTC
  midnight the object key changes too (it embeds the landing date), so S3 keeps two copies.
- Fix: land all parts and then, in **one** transaction, `delete from ingest.raw_objects where job_run_id = $run`
  followed by the inserts. Also use a run-stable key (the run's `created_at` date, not `now()`). Join SP texts
  with a newline guard, or parse per part.

### M2 (major) — Ads export: pre-signed download URL stored as `amazon_document_id` and reused after it expires

- `packages/ingestion/src/families/async-jobs.ts:160`, `:166-167`; `engine.ts:406-416`.
- `poll` returns the export's pre-signed `url` as the document id. The engine persists it in `ingest.job_runs`
  (90-day retention) and `download` fetches that stored URL.
- Failure scenario: the export completes and the run moves to `downloading`. The download is throttled or the
  worker restarts, and the run resumes after the URL's expiry → 403 on every retry → the run fails, every time,
  for that window. It also stores a bearer link to seller data in a plain DB column (conventions §7: no tokens
  outside the vault).
- Fix: keep `documentId = exportId`. In `download`, call `GetExport` again for a fresh URL, as `adsReportAdapter`
  already does with `retrieve`.

### M3 (major) — Windows are UTC, not marketplace-local dates (conventions §6)

- `packages/ingestion/src/engine.ts:125-140` (`computeWindow` uses `Date.UTC` day starts);
  `packages/ingestion/src/types.ts:46-66` (`SyncTarget` / `SyncTargetProfile` carry no time zone);
  `packages/ingestion/src/directory.ts:60-73` (does not read `core.ads_profiles.time_zone` or
  `ref.marketplaces.time_zone`); `apps/worker/src/cli.ts:60-61` (backfill `--from/--to` parsed as UTC instants).
- Ads v1 reports and every `facts.*.date` are keyed by the profile/marketplace local date. The engine only hands a
  definition two UTC instants and no zone, so each slice must re-derive the zone itself, and the engine can't give
  it one.
- Failure scenario: a US profile, run at 17:30 PDT (00:30 UTC next day), `lookbackDays: 3`. `window.end` is
  tomorrow's date in UTC. A definition doing `toISOString().slice(0, 10)` asks Ads for a future local end date
  (rejected or empty). A "delete + insert the window" upsert (the pattern `docs/architecture/ingestion.md`
  recommends) deletes local days it only partly re-pulled. Backfill chunk edges fall mid-day, local time.
- Fix: add `timeZone` to `SyncTarget` (per marketplace; profile zone wins, per `01_ref.sql` comment) and to
  `RunContext`. Compute windows as inclusive local dates and expose `ctx.dates = { from, to }` (`YYYY-MM-DD`).
  Parse backfill dates as local dates. Fix it now, before S01 (ADS-02) builds on `ctx.window`.

### M4 (major) — Syncs are scheduled for APIs the account has not connected (connection status not honoured)

- `packages/ingestion/src/directory.ts:33-37` (`pausedOf` only maps `needs_reauth|revoked|error`);
  `packages/ingestion/src/scheduler.ts:13-25` (`scopesFor` returns `[""]` for any SP definition).
- A missing connection row (`sp_status = null`) or `pending` is treated as healthy.
- Failure scenario: an Ads-only account (common for agencies/advertisers) gets `sync_states` rows for every SP
  definition. Each run fails on credentials, is retried 4×, and the sync is `failing` forever: red rows on the
  status screen and wasted worker slots. The same happens to every account during the D66 staging window until
  SP is connected.
- Fix: an API's syncs apply only when its connection exists and is `active`. `needs_reauth|revoked|error` → paused.
  `pending` / missing → not scheduled (no state row, or paused with reason `not_connected`). P3-IDENTITY's report
  (follow-up 3) asks for exactly this.

### M5 (major) — "No data" is reported as a failure (SP report `CANCELLED`, Data Kiosk `DONE` without a document)

- `packages/ingestion/src/families/async-jobs.ts:91`, `:188-189`.
- The Reports API model (`reports_2021-06-30.json`, `processingStatus` CANCELLED) says a report is cancelled
  automatically "if there is no data to return". Data Kiosk returns `DONE` without `dataDocumentId` when the query
  has no data (Data Kiosk guide; the catalogue only types the field — verify in P3-SMOKE).
- Failure scenario: a small seller's windowed orders report for a quiet window, or a backfill window before the
  first sale → `ReportFailedError` → 4 retries (creating 4 more reports) → the run fails and the sync turns
  `failing`. Backfill windows with no data fail for good.
- Fix: `CANCELLED` (that we did not request) and Kiosk `DONE`/no document → a successful run with zero rows (no
  landing). Keep `FATAL` as failure. Add a test next to "an empty report is a successful run".

### M6 (major) — Integration seam: refresh/enqueue is only reachable through a full Engine inside the worker

- `packages/ingestion/src/scheduler.ts:36-41`, `:184-214`; `apps/worker/src/ingest.ts:50-73` (`BullRunEnqueuer`,
  queue names live in the worker app).
- `requestRefresh` needs `createScheduler(engine)`, and the engine needs the Amazon runtime and clients, the gate,
  the object store and the enqueuer. Three callers need it outside the worker: the API route
  `POST …/sync/{syncKey}/refresh`, the S02 command executor (D62 a refresh after write) and the sync-health route.
  None should build Amazon clients just to insert a run row and add a BullMQ job.
- Fix (owned paths): export from `packages/ingestion` an enqueue-only `createRunRequester({ db, system, directory,
  definitions, enqueuer })` with `requestRefresh` / `backfill`. Move `BullRunEnqueuer` + `RUN_QUEUES` there (or
  to an `@seller-hub/ingestion/queue` entry) so the API and S02 enqueue onto the same queues. The scheduler keeps
  using it internally. Combine with B1: the requester must not start a second chain.

## May fix later (become BACKLOG follow-ups)

### Major

- **M7 — Ads v1 report slot not held** — `families/async-jobs.ts:105-111`. P3-CLIENTS'
  `adsReports.create` says "the caller owns slot management" (`ads:v1-reports`, limit 1). The engine creates
  without a slot, so N profiles due together create N reports. If Amazon enforces 1 concurrent report per app,
  N−1 of them get 429 → delayed (works, but every 429 also feeds the app-wide AIMD backoff). The task report already
  flags this. Decide after P3-SMOKE: hold the gate lease keyed by run id from `create` to the terminal state.
- **M8 — Inbox rows stuck in `processing` forever** — `repository.ts:610-623` (claim only picks `pending|failed`),
  `:660` (replay only resets `failed`). If the worker dies inside a handler, the notification is neither processed
  nor visible as failed, and replay can't reach it. Fix: claim, handle and finish in one transaction per row
  (`FOR UPDATE SKIP LOCKED`; a crash rolls back to `pending`), or reclaim `processing` rows past a visibility
  timeout. Needed before PLT-11 (v1), since SQS is stubbed in MVP.

### Minor

1. **Scratch leaks** — `engine.ts:600-604` (`cancelRun`), `:615-627` (reauth: `failRun(…, null, …)`) never remove
   `cursor.runs[runId]`. `getSyncHealth.runningRuns` (`health.ts:186`) counts them forever, and the cursor grows.
   Call `finishAuxRun` on cancel/reauth.
2. **Retention gaps (D64 a)** — `ingest.inbox` is never purged (DDL comment: done 35 d, failed 90 d). Nothing
   configures the bucket lifecycle, although the worker creates the bucket (`object-store.ts:94-98`; it could set
   the 35-day rule there). `jobRunRetentionDays` is not read from env (`apps/worker/src/ingest.ts:178`; D64 says
   "changeable by env"; no `SH_JOB_RUN_RETENTION_DAYS` in `.env.example`/config).
3. **Paged resume after the last page restarts at page 1** — `engine.ts:310`, `:350-353`. `nextToken: null` means
   both "finished" and "not started". A crash between the last page's commit and `finish` re-pulls everything. Store
   `complete: true`.
4. **`attempts` never resets** — `engine.ts:657`. A long run with sporadic transient errors in different steps
   fails after 4 in total. Count per state, or reset after a step that made progress.
5. **API split by key prefix** — `repository.ts:264`, `:524` pause/resume `sync_key like 'ads.%'`, while the
   engine decides by `isAdsDefinition` (family/`appliesTo`). An Ads report defined in another module
   (`vendor.*`, `automation.*`) is not paused on Ads reauth; an SP sync in module `ads` is. Pass the definition keys
   per API.
6. **Per-seller gate TTL 15 min** — `engine.ts:240-244`. A download → parse → upsert of a large report can outlive
   it, which lets a third run in. Size the TTL to the step, or renew it.
7. **Failed inbox rows retried without backoff** — `repository.ts:619`, `:668-675`. 5 attempts within ~2.5 min
   (30 s tick), then manual replay only.
8. **UI not from `packages/ui` primitives** — `SyncStatusView.tsx:2-12` uses raw MUI `Table` (not `DataGrid` /
   cells), a text loading state (`:104`) instead of `SkeletonMark`, and English copy in `copy.ts` (incl. inline
   strings like "in under a minute") instead of `apps/web/messages/<locale>/…`. Acceptable while the route is
   unreachable. Fix with the API follow-up.
9. **Demo upsert is row-by-row** — `demo/merchant-listings.sync.ts:52`. It is documented as "what a slice looks
   like", so slices will copy an N+1 insert (100k SKUs = 100k round trips in one transaction). Show a multi-row
   insert.
10. **Shutdown** — `main.ts` closes workers, which wait for active jobs. A report step (download + parse + upsert)
    can exceed a container's stop grace; it is then recovered by the stale path (which B1 must keep correct). Note
    it in `dev-setup`/deploy docs (`stop_grace_period`).

## Boundary judgement: sync-health API, vault credential source, Data Kiosk

- **Vault `CredentialSource` — correct boundary.** P3-IDENTITY owns the vault (ADR-0005), and its branch now
  exports `vaultCredentialSource` / `composeAmazon` from `@seller-hub/mod-platform-connections`, with
  `markNeedsReauth` updating `core.connections.status` on `invalid_grant`. The seam is
  `startIngest({ credentials })` in `apps/worker/src/main.ts` (a P3-INGEST path). Until it is wired,
  production mode fails every live run with a plain `Error`. That is safe for D30 but noisy, and M4 makes it worse.
  **Integration:** whichever branch merges second wires it. If P3-IDENTITY merges first (likely), the P3-INGEST
  fix round rebases on `main` and passes the vault source in `main.ts`, plus M4 (directory honours connection
  status). It must land before D66 staging connects a real account.
- **Sync-health / refresh API — correct to leave out, but a planning gap, not a P3-INGEST defect.** ADR-0008
  "Consequences" lists "sync health API" under P3-INGEST, but the PLAN row's OWNED_PATHS exclude `apps/api/**`,
  `contracts/**` and `modules/**`. The orchestrator must assign it, e.g. a small task owning
  `modules/platform-ingestion/src/{routes,permissions}/sync/**`, `contracts/modules/platform-ingestion/sync.yaml`
  (`sync.read`, `sync.refresh`), `apps/web/features/platform-ingestion/sync/sync.nav.ts` and the message file.
  The engine-side seam it needs is **M6** (enqueue-only requester + shared queue binding) plus `getSyncHealth`.
  `getSyncHealth` also needs definition metadata (description, schedule); expose it from the requester, so the API
  doesn't import the worker registry.
- **Data Kiosk client — correct boundary.** It is v1 (ORD-03, FIN-03), not MVP. The family works behind
  `DataKioskPort` and fails clearly with `kiosk_unavailable` (tested). Follow-up for P3-CLIENTS: add the Data Kiosk
  operations to the SP allow-list and an adapter implementing the port. Fold M5 (Kiosk "no data") into that work if
  it is not fixed now.

## Checks against the brief's focus list

| Focus | Result |
|---|---|
| Idempotency / retries (job ids, at-least-once, inbox dedup) | **Fails**: B1, M1. Inbox dedup on `(source, message_id)` + delete-after-insert is correct; M8. |
| Rate limiting through the shared limiter | OK: every Amazon call goes through the P3-CLIENTS runtime (Redis buckets + gate); 429 → delay, not failure. M7 (report slot) open. B1 multiplies calls. |
| Pagination to the end | OK (`pagedLoop` loops until no `nextToken`, yields after 45 s with the token committed). Minor 3. |
| Ads v1 adapter, no Reporting v3 | OK (`AdsApiv1CreateReport`/`RetrieveReport`, fresh part URLs on download; test asserts no v3 URL). |
| Marketplace-local dates | **Fails**: M3. |
| Tenant isolation of jobs and data | OK: scoped repository, RLS, cross-tenant test real; payloads carry ids only; system queries (claim, stale, maintenance, directory) read ids/schedule only. |
| Checkpoint/cursor correctness | Mostly OK (page token committed with rows; cursor from run start − overlap; catch-up chunks). Minors 1, 3. |
| Retention | Partitions OK; minor 2 (inbox, bucket lifecycle, env). |
| S3 keys scoped by tenant | OK (`raw/{tenant}/{sellerAccount}/…`), but see M1 (key embeds landing date). |
| Error states surfaced | Mostly OK (`failing`, `paused`, error code/detail sanitised, health screen). **M5**, M4 produce false "failing". |
| No secrets in payloads/logs | OK for payloads, logs, S3 signing (secret never on the wire; tested). **M2** stores a pre-signed URL in the DB. |
| D30 | OK: mock/replay transports only; production mode has no credentials until the vault is wired. |
| Worker shutdown | OK in order (workers → queues → DB); minor 10. |
| Ownership | OK (PLAN row; `pnpm-lock.yaml` regenerated only). |
| ADR-0008 Gate 2 amendment (`*.sync.ts`, `*.job.ts`, `*.command.ts`) | OK: the P3-SCAFFOLD generator already globs all three; the branch adds boot-time validation + a test that the generated registry passes it. |

## Commands run

| Command | Result |
|---|---|
| `git diff --stat main...refs/heads/claude/p3-ingest-5d7cbd`, `git log main..<branch>` | 38 files, +5860/−2, 5 commits; all paths inside OWNED_PATHS (+ lockfile) |
| `git merge-tree --write-tree main <branch>` | clean |
| `git merge-tree --write-tree refs/heads/claude/p3-identity-8a0f9d <branch>` | clean |
| `npx vitest run test/units.test.ts test/families.test.ts test/engine.test.ts` (in `packages/ingestion` of the task worktree, no env file) | units **16 passed**; families (5) and engine (15) **skipped — no database** |

**Skipped:** `pnpm gate` and every DB/Redis/MinIO test. The brief forbids starting a stack (other stacks are running).
The task report states `pnpm gate` exit 0 with the stack up (ingestion 37, worker 10, web 22 passed); I did not
reproduce it. None of B1/M1–M6 is caught by the existing tests, so a green gate does not contradict them.

## Re-review checklist (for the fix round)

B1 tests (concurrent `processRun`, long poll + ticks, double refresh) · M1 re-land test (fail PUT of part 1, retry,
assert one index row per part) · M2 export download after URL expiry (mock 403 on the old URL) · M3 window in
`America/Los_Angeles` at 00:30 UTC · M4 Ads-only account gets no SP states · M5 `CANCELLED` → done, 0 rows · M6
requester used by the worker scheduler and importable without Amazon clients · `pnpm gate` green with the stack up.
