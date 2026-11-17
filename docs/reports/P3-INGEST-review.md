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

---

## Re-review 1 (branch tip `b48292c`)

Scope: `git diff ffe37b7..b48292c` (3 commits: `23aeb67` fix, `d4e69a4` worker + docs, `b48292c` report mapping;
22 files, +1352/−328), the "Fix round 1" section of `docs/reports/P3-INGEST.md`, and the new
`packages/ingestion/test/fixround.test.ts`. Same rules as before: read-only, no stack. Vault wiring is deferred on
purpose until P3-IDENTITY merges; that is accepted.

### Verdict

**MERGE-AFTER-FIXES — 1 must-fix (major, residual of B1)**, plus 5 new minors. The original M1–M6 and the claimed
minors are fixed and tested. B1's correctness half is fixed: two chains never run a step at once, and a healthy long
wait is no longer taken for a dead chain. Its amplification half is not: when the queue is slow, the stale sweep still
starts extra chains that never merge.

### Item by item

| Item | Status | Evidence |
|---|---|---|
| B1 | **Partly fixed**, see R1 | Per-run lease `engine.ts:223-224` drops an overlapping chain (`state: "duplicate"`). The `nextStepAt` heartbeat (`engine.ts:244`, `repository.ts:723`) is written whenever a step returns `done: false`. `findStaleRuns` (`repository.ts:707`) uses the heartbeat. Tick, refresh and backfill join an open run and enqueue nothing (`scheduler.ts:113-133`, `requester.ts:144-146`, `:169`, `:208`). Tests: concurrent `processRun` → one `createReport`; a 25-min poll with 24 ticks → one chain; double refresh → one chain. |
| M1 | Fixed | Run-stable key (`run.createdAt`). The index is replaced in one transaction (`replaceRawObjects`: delete, then insert). Texts joined with `\n`. Test: PUT of part 1 fails once → rows `[0, 1]`. |
| M2 | Fixed | `documentId = exportId`; `download` calls `GetExport` for a fresh URL; no URL in `job_runs`. Tested. |
| M3 | Fixed | `windows.ts` builds windows from local dates in the profile's zone, else the marketplace's, else the account's. `ctx.timeZone`, `ctx.dates`; backfill and CLI take `YYYY-MM-DD` local dates. The directory reads `ads_profiles.time_zone` and `ref.marketplaces.time_zone`. I checked `localMidnight`'s two-pass DST settle and the catch-up rule. Unit tests: 00:30 UTC in Los Angeles, DST edge, chunk edges. |
| M4 | Fixed | `connected` = `active` (or a paused status). `pending` or missing → no states. A run of an unconnected API is cancelled `not_connected`, and `reconcilePaused` resumes `not_connected`. Tested (Ads-only account, pending connection). |
| M5 | Fixed | SP `CANCELLED` and Kiosk `DONE` without a document → `documentId: null` → `upserting` → `finish` with 0 rows, nothing landed. `FATAL` still fails. Tested. |
| M6 | Fixed (see N1) | `createRunRequester` (refresh, backfill, `getSyncHealth` with definition metadata). `BullRunEnqueuer` / `RUN_QUEUES` live in `@seller-hub/ingestion/queue`. The scheduler uses the requester. Tested without Amazon clients. |
| Minors 1, 3, 4, 5, 6, 9, 10 | Fixed | Scratch dropped on cancel and reauth. `complete` flag. `attempts` reset after progress. Pause/resume by definition keys. Gate TTL 45 min. Demo upsert multi-row. Shutdown note in `ingestion.md` §8. |
| Minor 2 | Partly fixed | Inbox purge added to maintenance; `SH_JOB_RUN_RETENTION_DAYS` read (see N4). Bucket lifecycle → BACKLOG (accepted). |
| M7, M8, minors 7, 8 | Deferred to BACKLOG | As agreed. |

### R1 (major, must fix) — Under queue backlog the stale sweep still starts chains that never merge

- `packages/ingestion/src/scheduler.ts:137-141` re-enqueues a stale run with
  `jobId = ${runId}-${epochSeconds}`. That job id is new on every tick. `repository.ts:707` falls back to
  `jr.updated_at` when a run has no heartbeat yet (a run created but not yet started). The per-run lease only
  excludes *overlapping* steps: it is released at the end of each step, so two chains that take turns both live on
  (`apps/worker/src/ingest.ts:203` continues each with `step + 1`).
- Failure scenario: first-connect backfill of 24 monthly windows × 5 syncs = 120 runs on the `backfill` queue
  (concurrency 2). Most windows wait more than 10 min before their first step. From then on, every tick re-enqueues
  up to 100 of them under fresh job ids. Nothing writes a heartbeat until a step runs, so the next tick does it
  again. Each extra job later runs a step and becomes its own chain. Example: run X ends up with ~1 chain per minute
  of backlog, each polling `getReport` every 30 s. That multiplies queue load, deepens the backlog that caused it,
  and burns the seller's SP quota. The same happens to a scheduled run whose delayed next job is promoted but waits
  more than 10 min behind others.
- Data stays correct: steps are serialised and the state machine is persisted. This is an amplification and quota
  problem, not data loss, so I rank it major rather than blocker. It will still show up on the first real backfill.
- Fix (small):
  1. Store the expected next step in the heartbeat: `runs[runId] = { nextStep, nextStepAt }`, written where the
     step returns `done: false`, with `nextStep = payload.step + 1`.
  2. In `processRun`, drop (`done: true`) a payload whose `step` is below the stored `nextStep`.
  3. Have the stale sweep re-enqueue with `jobIdFor(run.id, nextStep)` (step 0 for a never-started run). If the
     original job is still waiting or delayed, BullMQ ignores the add (same job id). If it was really lost, it is
     re-created. Either way there is one chain.
  - Also bump `nextStepAt` when the sweep re-enqueues, so it doesn't fire on every tick.
- Test: 120 runs created, the queue not drained for 30 simulated minutes with a tick per minute → at most one queued
  job per run, then draining runs each run's steps in a single sequence.

### New minors (may fix later / with the sync-health API task)

- **N1** `requester.ts:104-126`: `stateFor` inserts missing sync states through `system` (the owner role). So the
  API process, which will host the refresh route, would need `sh_owner` credentials and bypass RLS. Insert under
  `withScope` on the app connection instead (RLS `WITH CHECK` allows it), and drop `system` from the requester.
  Fix before the sync-health/refresh API task.
- **N2** `requester.ts:144-146`: a refresh without `entityIds` joins any open non-backfill run. If that run is a
  `scheduled` run that already fetched its data (`processing` past its pages, `parsing`, `upserting`), a
  refresh-after-write (D62 a) for a definition without `refreshEntities` returns `created: false` and misses the
  write until the next schedule. The user's "Refresh now" also keeps the scheduled run's queue and priority. Join
  only a run that has not started yet (`state = 'requested'`, no `startedAt`), and re-enqueue it at `interactive`.
  Otherwise create a new run, whose window ends later, so its job key differs.
- **N3** `engine.ts:223`: the per-run lease TTL (30 min) is shorter than the per-seller gate (45 min) and than a
  large report's download → parse → upsert step. A step that outlives it lets a second chain step in concurrently.
  Renew it, or make it at least the gate's TTL.
- **N4** `apps/worker/src/ingest.ts:149`: `SH_JOB_RUN_RETENTION_DAYS` is read from `process.env` outside the
  typed config and is not in `.env.example`. Both files are outside this task's paths. Orchestrator: add it to
  `packages/config/src/env.ts` and `.env.example`.
- **N5** `packages/ingestion/test/minio.test.ts:6-7` (unchanged from round 0): `loadConfig` runs at module top
  level, outside the `try`. Without an env file the suite fails ("Invalid or missing environment variables")
  instead of skipping. The gate passes only because the stack env is loaded. Move `loadConfig` inside the `try`.

### Regressions

None found:
- Ownership is unchanged: only owned paths plus `pnpm-lock.yaml` (`bullmq`/`ioredis` now dependencies of
  `@seller-hub/ingestion`).
- `@seller-hub/core` time helpers (`localDateOf`, `addDays`, `daysBetween`) already exist on `main`.
- The cross-tenant test still covers the repository, and the new repository functions are scoped or system-only
  as before.
- `processRun` cancels runs for paused or unconnected APIs before taking any lease.
- The M5 empty path re-reads no landed documents.

### Commands (re-review 1)

| Command | Result |
|---|---|
| `git log --oneline ffe37b7..b48292c`, `git diff --stat`, `git diff --name-only main...<branch>` | 3 commits; files inside OWNED_PATHS + `pnpm-lock.yaml` |
| `npx vitest run` in `packages/ingestion` (task worktree at `b48292c`, no env) | units **18 passed**; engine 15, fixround 12, families 5 **skipped (no database)**; `minio.test.ts` **fails at import** without env (N5, environment-only) |

**Skipped:** `pnpm gate` and every DB/Redis/MinIO test, because the brief forbids starting a stack. The task reports
gate exit 0 with the stack up (ingestion 51, worker 10, web 22).

### For the next round

R1 only (+ its test). N1–N5 may go to BACKLOG or ride along. After R1, I expect **MERGE**.

---

## Re-review 2 (commit `9513e9a`)

Scope: `git diff b48292c..9513e9a` (1 commit, 9 files, +227/−53): R1, N1, N2, N3, N5. N4 moves to the orchestrator
at integration (accepted). Read-only, no stack.

### Verdict

**MERGE-AFTER-FIXES — 1 must-fix (R2, major).** R2 is a regression introduced by the R1 fix, and the fix is small.
R1's backlog amplification is gone. N1, N2, N3 and N5 are fixed.

### Item by item

| Item | Status | Evidence |
|---|---|---|
| R1 | Fixed for the backlog case | The heartbeat stores `nextStep = payload.step + 1` (`engine.ts` → `setNextStepAt`). `processRun` drops a payload with `step < nextStep` (`engine.ts:223-226`). The sweep re-adds with the chain's own id `jobIdFor(run.id, nextStep)`, so BullMQ ignores it while the original is queued (`scheduler.ts:147`), and pushes `nextStepAt` out by the grace (`:149`). Tests: "a backlog of never-started runs and a tick per minute leaves ONE queued job per run"; "a job of an older step is dropped". **But see R2.** |
| N1 | Fixed | `requester.ts` no longer takes `system`. `ensureSyncStateScoped` inserts under `withScope` on the app connection (RLS `WITH CHECK`). The requester needs no owner role. |
| N2 | Fixed (see N6) | A refresh joins only an open run in `requested` with no `startedAt` (`requester.ts:143`), and re-adds it at `interactive` (`…-0-interactive`). The step guard drops whichever of the two jobs runs second. Otherwise it creates a new run. Tested. |
| N3 | Fixed | Per-run lease TTL 60 min (≥ the 45-min per-seller gate). |
| N5 | Fixed | `loadConfig` inside the `try`: without env the MinIO suite is skipped, not crashed (confirmed below). |

### R2 (major, must fix) — A run whose step job *failed* cannot be resumed for 24 h

- `packages/ingestion/src/scheduler.ts:147`. The sweep now reuses the chain's own job id for `nextStep`.
  `packages/ingestion/src/queue.ts:38` keeps failed jobs for 24 h (`removeOnFail: { age: 86_400 }`), and BullMQ
  ignores an `add` whose job id still exists in any state, failed included.
- When `processRun` throws, the heartbeat is not advanced, so `nextStep` stays at the failed job's step `N`. A throw
  is easy to get: a Postgres restart or connection reset mid-step, a serialisation error in a scoped transaction, the
  object store down while landing outside the engine's catch, or a job BullMQ fails after `maxStalledCount` stalls.
  Every sweep then re-adds `${runId}-N`, the existing failed job swallows it, and the next sweep runs 10 min later
  and does the same.
- Failure scenario: the DB restarts while the scheduled listings run is at step 7. Job `${runId}-7` fails, and the
  run stays `processing` with `nextStep = 7`. For the next 24 h the sweep's adds are no-ops. Meanwhile the tick
  skips this sync every time (`scheduler.ts:112`, `findOpenSyncRun` → "its live chain carries it"), so the sync
  does not run at all for a day. The status screen shows it in flight and slowly going stale.
- Round 1 recovered this in 10 min (unique ids), so this is a regression. The in-memory test queue
  (`testing.ts:30`) only dedups *pending* ids, so it cannot show the problem.
- Fix (either is enough):
  - (a) Give the sweep a recovery id distinct from chain ids, e.g. `${runId}-${nextStep}-resume-${epochSeconds}`.
    The step guard now makes a same-step duplicate harmless: whichever job runs first advances `nextStep`, and the
    other is dropped. `bumpNextStepAt` bounds it to one extra job per grace period.
  - (b) Look up `${runId}-${nextStep}` in the queue before adding; if it is `failed` or `completed`, remove it, then
    add.
  - Also consider catching `processRun` errors in the worker processor (`apps/worker/src/ingest.ts:197`) and
    returning a backoff re-enqueue, so a run job never ends in BullMQ's failed set.
- Test: make the test queue keep failed ids (or use BullMQ in the worker test). A step throws once → the sweep
  resumes the run within one grace period.

### New minors (may fix later)

- **N6** `requester.ts:155`: for a sync with no window (`lookbackDays` unset, e.g. a `lastUpdatedAfter` paged
  pull), the job key is `syncKey:sa:scope:-:-`, the same as the open run's. When that run has already started,
  N2's "start a new run" path makes `createRun` return the started run with `created: false` and enqueues nothing.
  The refresh silently joins a run that is past its fetch, which is exactly the case N2 meant to avoid (D62 a
  refresh after write for a definition without `refreshEntities`). Add a `keySuffix` (e.g. the request time)
  when an open started run exists.
- **N7** `engine.ts:223-226`: the step guard reads `nextStep` from the `state` loaded *before* the per-run lease is
  taken. Chain Y can finish step N between that read and X acquiring the lease, so X runs step N once more. Its
  successor id collides with Y's and is deduped, so it converges, but at the cost of an extra Amazon call (e.g. a
  second `getReport`). Re-read the run's scratch after taking the lease.

### Regressions

R2 above. No other: the diff stays within owned paths. The requester API changes (no `system`) are internal to the
package and the worker scheduler. `testing.ts` now re-enqueues `step + 1`, as the worker does.

### Commands (re-review 2)

| Command | Result |
|---|---|
| `git log --oneline b48292c..9513e9a`, `git diff --stat` | 1 commit, 9 files, all inside OWNED_PATHS |
| `npx vitest run` in `packages/ingestion` (task worktree at `9513e9a`, no env) | units **18 passed**; engine 15, fixround 15, families 5, minio 1 **skipped (no database / object store)**; the MinIO suite now skips cleanly (N5 confirmed) |

**Skipped:** `pnpm gate` and every DB/Redis/MinIO test (no stack, per the brief).

### For the next round

R2 (+ a test where the queue keeps failed job ids). N6 and N7 may go to BACKLOG. After R2, I expect **MERGE**.

---

## Re-review 3 (branch tip `3b1d06b`)

Scope:
- Fix round 3 (`3ee1745`: R2, N6, N7).
- The merge of `main` @ `bd14904` (P3-IDENTITY) into the branch (`5fd3435`).
- The integration commit `3b1d06b`: vault credential source in the worker, and N4 typed `SH_JOB_RUN_RETENTION_DAYS`.

The touches to `packages/config/src/env.ts` and `.env.example` are an orchestrator-granted exception to the row; I
accept them. Read-only, no stack.

### Verdict

**MERGE** — no must-fix left. 4 minors for BACKLOG (N8–N11).

### Fix round 3

| Item | Status | Evidence |
|---|---|---|
| R2 | Fixed | The sweep adds with `replaceFinished: true` (`scheduler.ts`). `BullRunEnqueuer.enqueue` looks up the id and removes it if `failed`/`completed`, and leaves a waiting, delayed or active job alone (`queue.ts`). The in-memory queue now keeps finished ids like BullMQ, so the test can show the bug. Test "R1 + R2 together": a backlog keeps one job per run, and a run whose job failed is re-added once after the grace and drained once. The `getState` → `remove` sequence isn't atomic, but a finished job can't change state underneath without a retry, which this queue never does (`attempts: 1`). |
| N6 | Fixed | When an open started run exists, the refresh run gets `keySuffix: r<time>`, so a windowless sync creates a new run (`requester.ts`). Tested. |
| N7 | Fixed | The step guard re-reads the sync state *after* taking the per-run lease, and the step uses the fresh state (`engine.ts`). |

### Integration seam (vault, P3-IDENTITY)

| Check | Result |
|---|---|
| Wiring | `apps/worker/src/credentials.ts` builds `vaultCredentialSource` (`envKeyProvider`, LWA app creds from `SPAPI_/ADS_LWA_CLIENT_*`, audit writer). `main.ts` passes it to `startIngest` and closes its pool on shutdown. |
| Least privilege | Credentials are read through `sh_app` (a separate `max: 3` pool) under RLS, one account at a time. The vault-wiring test proves another account's call fails ("no active sp credential") instead of borrowing one. |
| Fail closed | `envKeyProvider` throws at boot without `SH_MASTER_KEY(S)`. In production it refuses the `.env.example` dev key (P3-IDENTITY m6). |
| Secrets not logged or in payloads | Job payloads are unchanged (ids, `runCreatedAt`, `step`). `credentials.ts` logs nothing. The vault keeps the decrypted refresh token in memory for the LWA call only. Errors carry names and ids, not values (`NoCredentialError` has the seller account id only). The engine's `sanitize` stores `message` only, which is safe for these errors. `markNeedsReauth`'s audit details are `{ api, reason }`. `FAKE_APP` in `credentials.ts` is an obviously fake replay-only app id/secret, used only when `SH_AMAZON_MODE=replay` and the env vars are empty. |
| `invalid_grant` → pause | The client calls `markNeedsReauth`, which sets `core.connections.status = needs_reauth`. The directory maps it to `paused.sp`, and `scopesFor` returns `[]`. Tested end to end on the real DB (`vault-wiring.test.ts`). Status names match P3-IDENTITY's `markStatus`. |
| D30 | The new test uses `createTestRuntime` + `jsonResponse` (mock transport) only. No live Amazon call anywhere. |
| Merge | `5fd3435` changes no file under `packages/ingestion` or `apps/worker`. `git merge-tree main <branch>` is clean. Outside the row, `git diff main...<branch>` touches only `.env.example`, `packages/config/src/env.ts` (the N4 exception) and `pnpm-lock.yaml`. |
| N4 | `SH_JOB_RUN_RETENTION_DAYS` is in the zod schema (int, positive, default 90) and `.env.example`, and is read from typed config in `apps/worker/src/ingest.ts`. Fixed. |

### New minors (BACKLOG)

- **N8** `docs/architecture/ingestion.md:150-151` still says replay mode uses "fake credentials". Since `3b1d06b`
  the worker always uses the vault, in replay too: only the LWA *app* falls back to `FAKE_APP`. A replay run therefore
  needs a sealed refresh token in `core.credentials` for the account (e.g. created through the mock "connect" flow);
  the fixture seeds create none. Update the doc, or seed a sealed dev credential for the fixture account.
- **N9** `apps/worker/src/credentials.ts:17-34`: in production with no `SPAPI_`/`ADS_LWA_CLIENT_*` set, the worker
  boots. Every run of that API then fails at call time ("application credentials are not configured") and is
  retried 4× → `failing`. Consider a boot-time warning (or refusal) when an API has active connections but no app
  credentials. Also map `NoCredentialError` and the missing-app error to non-retryable, so they fail once.
- **N10** `apps/worker/test/ingest.test.ts:23` has the same pattern as N5: `loadConfig` runs at module top level, so
  without an env file the suite fails at import instead of skipping. It dates from round 0 but was not covered by
  N5. Move it inside the guard.
- **N11** (carried) The BACKLOG items agreed in earlier rounds stay open:
  - M7: Ads report slot.
  - M8: inbox `processing` rows.
  - Bucket lifecycle rule.
  - Minor 7: inbox retry backoff.
  - Minor 8: settings screen on `packages/ui` primitives and messages.
  - Sync-health/refresh API task (`createRunRequester` is ready for it).
  - Data Kiosk client.

### Commands (re-review 3)

| Command | Result |
|---|---|
| `git log --oneline 9513e9a..3b1d06b`, `git show 3ee1745`, `git show 3b1d06b`, `git show --stat 5fd3435` | reviewed as above |
| `git diff --name-only main...<branch>` + `git merge-tree --write-tree main <branch>` | only owned paths + the N4 exception + lockfile; clean |
| `npx vitest run` in `packages/ingestion` (worktree at `3b1d06b`, no env) | units **18 passed**, 38 DB/MinIO tests skipped |
| `npx vitest run` in `apps/worker` (no env) | run-job 4, worker 2, registry 2 **passed**; vault-wiring 3 skipped (no DB); `ingest.test.ts` **fails at import** without env (N10, environment-only) |

**Skipped:** `pnpm gate` and every DB/Redis/MinIO test (no stack, per the brief). The orchestrator's gate, run with
the stack up after the merge, is the evidence for those.
