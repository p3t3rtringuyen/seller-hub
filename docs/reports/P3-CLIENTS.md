# P3-CLIENTS — Amazon client layer

Branch `claude/p3-clients-0ff97d` (cut from `main`, after the scaffold merge). No live Amazon call was made: no credentials exist (D30) and every test runs on the mock/replay transport.

## What was built

| Package | Contents |
| --- | --- |
| `packages/amazon-core` | `createAmazonRuntime` → `AmazonClient.call()` (credential → LWA token → limiter → send → classify → retry → typed result/error → one observer event). LWA token service (cache, margin 60 s, single-flight in-process + Redis lock, `invalid_grant` → `ConnectionNeedsReauth`, grantless tokens). Redis token bucket (Lua, Redis clock) per `tenant·app·api·region·seller account·operation`, SP rate seeded from the catalogue and adapted from `x-amzn-RateLimit-Limit`, Ads AIMD, concurrency gate. Retry with full jitter (1 s / 60 s / 6), `Retry-After`. Typed errors. 207 mapping (`mapMultiStatus`, `chunk`, `mergeBatchResults`). Regions NA/EU/FE + modes `production`/`sandbox`/`replay`. Document download (pre-signed, gunzip, size cap). AES-GCM cipher for the Redis token cache. Logging observer (allow-list only). Type helpers `OperationArgs`/`OperationResponse`. **`@seller-hub/amazon-core/testing`**: `MockTransport`, `createReplayTransport` + fixture loader, `ManualClock`, `fakeCredentialSource`, `createTestRuntime`, `tryConnectTestRedis`. |
| `packages/amazon-sp` | Generated types + operation table (43 operations: sellers, reports, feeds, tokens, notifications, listingsItems, catalogItems, fbaInventory.getInventorySummaries, sales, orders@2026-01-01, finances 2024-06-19 + `listFinancialEventGroups`). `createSpClient` → `sp.<family>.<operation>(scope, args)` fully typed from Amazon's models, plus `sp.call(id, …)`. `runReport` (create → poll → document → download → gunzip). D11 guard (`restriction.ts`), RDT stub. Fixtures + `spFixtures()`. `sandbox.ts`. |
| `packages/amazon-ads` | Generated types + operation table (53 operations). `createAdsClient` (typed per operation, `batch()` with `batchMax` chunking + 207 mapping). Ports `CampaignsPort`, `AdGroupsPort`, `AdsPort`, `TargetsPort` + v1 adapters. v1 report helper `createAdsReports` (create → poll → download → decompress, global report slot, no Reporting v3). v0 adapters `src/v0/ex-{profiles,exports,portfolios,targeting-recs,targeting-discovery,change-history,budget-rules}` (budget rules: GET only) + `V0_EXCEPTIONS` table. Fixtures + `adsFixtures()`. `sandbox.ts`. |
| `tools/codegen` | `cli.ts`, `generate.ts`, `prune.ts`, `tooling.ts`, `config/{sp,ads}-allowlist.json`. SP: Swagger 2 → swagger2openapi → prune to the allow-list → openapi-typescript; Ads: OpenAPI 3 → prune → openapi-typescript. Output (prettier-formatted, committed) in `packages/amazon-{sp,ads}/src/generated`. Finds `refs/` through the git common dir. Operation metadata comes from `catalog/`; codegen fails if the catalogue and the model disagree, or if a v0 operation lacks its `EX-*` id. |

READMEs: `packages/amazon-{core,sp,ads}/README.md` (how a slice calls an operation, adds one, tests it).

## Decisions applied

ADR-0006 (generate types, own the transport), ADR-0005 (credentials via `CredentialSource`, never env for tenants; tokens encrypted in Redis, never logged), D52 (direct calls, per-seller LWA), D53 (v1 default; v0 only named exceptions, enforced by a test against `catalog/ads/domain-map.json`), D57 a (no Reporting v3; a test asserts none is generated), D4 (regions as data), D5 (SP scope has no seller-only assumption), D11 (restricted ops refused; RDT stubbed), D30 (nothing calls real Amazon).

## Commands run and results

Stack: `COMPOSE_PROJECT_NAME=sellerhub_p3clients SH_PORT_OFFSET=100 SH_ENV_FILE=.env.example pnpm stack:up` (Postgres 55532, Redis 56479), so DB and Redis tests really ran.

`pnpm gate` (= gen, lint, typecheck, test, build) → **exit 0**, 14/14 turbo tasks, 1m55s. Test counts from that run:

| Suite | Result |
| --- | --- |
| amazon-core | 6 files, **74 passed** (incl. 6 Redis tests against the real Redis: shared bucket across two limiters, gate, encrypted token cache, lock) |
| amazon-sp | 2 files, **18 passed** |
| amazon-ads | 2 files, **27 passed** |
| tools (`vitest --root tools`) | 3 files, **23 passed** (incl. "regenerating from refs/ reproduces the committed generated files") |
| others (core, config, db, testing, api, worker, web, contracts, metrics, mod-example) | all passed; api 13/13 and db 2/2 ran on real Postgres |

Required coverage → test: token refresh (`lwa.test.ts`), throttling 429 → backoff → success (`client.test.ts`, `sp-client.test.ts`, `ads-client.test.ts`), partial failure 207 (`batch.test.ts`, `ads-client.test.ts`), region routing (`client.test.ts`, `sp-client.test.ts`, `ads-client.test.ts`), restricted-call guard (`client.test.ts`, `sp-client.test.ts`), per-tenant/per-seller-account limiter isolation (`rate-limit.test.ts`, `redis.test.ts`), token/secret never in logs or errors (`client.test.ts`, `lwa.test.ts`).

## Files

Created: `packages/amazon-core/**`, `packages/amazon-sp/**`, `packages/amazon-ads/**` (including `src/generated/**`, 27 generated files ≈ 27 k lines), `tools/codegen/**`, this report. Changed outside my packages: **`pnpm-lock.yaml` only** (new workspace packages and their dependencies: `swagger2openapi` 7.0.8, `openapi-typescript`, `ioredis`, `tsx`; required by the packages' dependencies, as the brief allows).

## Needs the orchestrator (shared files I did not touch)

1. **Root script `amazon:sandbox`** (root `package.json`): `"amazon:sandbox": "pnpm --filter @seller-hub/amazon-sp run sandbox && pnpm --filter @seller-hub/amazon-ads run sandbox"`. Until then run each package's `sandbox` script. Neither was executed (no credentials). SP uses the sandbox host (`SH_AMAZON_MODE` defaults to `sandbox` in the script); Ads has no sandbox host, so it does one read-only `listProfiles` on the real host (use a test account).
2. **`SH_AMAZON_MODE`** (`production` | `sandbox` | `replay`, default `production`) is read by `amazon-core` straight from `process.env`; it is missing from `.env.example` and `packages/config/src/env.ts`. Please add it there (ADR-0006).
3. **Catalog entry for `swagger2openapi`**: it is pinned to `7.0.8` in `packages/amazon-core/package.json` because adding to `pnpm-workspace.yaml` is a shared-file change. Move it to the catalog when convenient.
4. **`tools/codegen` is not a workspace package** and not in the root `lint` list: it is linted by `amazon-core`'s `lint` script (`eslint . ../../tools/codegen`) and its tests run in the root `vitest --root tools`. It resolves `openapi-typescript`/`swagger2openapi` through `amazon-core` (`createRequire`). Making `tools/*` a workspace would remove that indirection.
5. **P3-IDENTITY** implements `CredentialSource` (vault) and derives the 32-byte key for `createAesGcmCipher` from the master key; the composition root passes `redis`, `cipher`, `logger` to `createAmazonRuntime`. Without `redis` the limiter and token cache are per process (documented).

## Judgement calls (please confirm or change)

- **Catalogue `regions` is advisory, not enforced.** It comes from Amazon's role pages and is wrong for some operations (e.g. `sellers.getAccount` lists EU only although every model host is NA); the seller account's region routes the call. A first version enforced it and failed on `getAccount`.
- **Restricted guard.** The transport refuses every operation the catalogue flags `restricted` unless a typed client has inspected the request: `orders.getOrder` / `searchOrders` are allowed without `BUYER`/`RECIPIENT` in `includedData`; `reports.getReportDocument` (flagged restricted) is allowed because `createReport` refuses PII report types. The PII report-type list is a **conservative pattern list** (`restriction.ts`), not Amazon's official list (not in the local refs); re-check it when D11 changes.
- **Writes**: retried on 429 (Amazon did not process them); on 5xx/timeout only when the caller passes `idempotent: true`; otherwise `AmazonUpstreamError` "outcome unknown, reconcile by re-reading" (ADR-0011); in `batch()` that is the item error `outcome_unknown`.
- **Defaults** (tunable options): 87 SP operations have no catalogue rate → bucket 1 rps / burst 2; Ads starts at 2 rps / burst 4, halves on 429 (floor 0.2), +0.1 per success (ceiling 10); Ads report slots = 1 per client app (`createAdsReports`, key `ads:v1-reports`); exports 5 per kind; a `Retry-After` over 120 s is not slept on (the call fails with `AmazonThrottledError.retryAfterMs` so a worker can delay the job).
- Generated types use `defaultNonNullable: false`, so request fields with a spec `default` stay optional.

## Not done / skipped

- **Fair round-robin across tenants** for the Ads report/export gate (ADR-0006) — the gate is a plain counting semaphore; fairness belongs with the ingestion scheduler (P3-INGEST).
- **OTel span per call** (ADR-0006/0013): the `CallObserver` hook carries every field; the span exporter is not wired (no OTel in the scaffold).
- Only the allow-listed operations are generated (43 SP, 53 Ads). Vendor APIs are catalogued but not generated yet (add to `sp-allowlist.json`; the transport already supports them).
- No Ads v1 domain port beyond Campaigns/AdGroups/Ads/Targets; reports/portfolios/exports/etc. are used through `createAdsReports` and the v0 ports.
- Live checks (`sandbox` scripts) not run.
- Environment note: Docker Desktop's engine was not running when I started; I launched Docker Desktop. A first gate run killed mid-template left a half-built `sh_tpl_*` database in my own stack (api test failed with "ops.example_hello does not exist"); I dropped the two throw-away databases in my stack and the rerun was green. P3-DS's stack (`sellerhub_p3ds`) was not touched; my stack is brought down at the end.

## Follow-ups

- P3-INGEST: use `AmazonRuntime.limiter/gate` in sync definitions; delay jobs on `LocalRateLimitError`/`AmazonThrottledError.retryAfterMs`; add tenant-fair scheduling for report/export slots.
- P3-IDENTITY: vault-backed `CredentialSource` (call `markNeedsReauth` → connection status), cipher key derivation, `ConnectionNeedsReauth` handling in the connections UI.
- P3-SMOKE: run `sandbox` scripts with real credentials; record Ads rate behaviour ("verify live").
- When D11 flips: implement the RDT flow behind `withRestrictedDataToken` and replace the PII report-type pattern list.

## Review fixes (P5-REVIEW-P3-CLIENTS, MERGE-AFTER-FIXES)

Each must-fix has a test that fails without the fix. Files: `packages/amazon-{core,sp,ads}/**` only.

| # | Fix | Test |
| --- | --- | --- |
| M1 | `createReportSchedule` refuses PII report types like `createReport`. `getReportDocument` no longer gets the "verified no PII" stamp unconditionally: the caller must pass `{ reportType }` (`runReport`/`fetchDocument` do), a PII or missing type is refused (`PiiDisabled`, no call made). `includedData` comparison is case/space-insensitive (N4). | `amazon-sp/test/restriction.test.ts` |
| M2 | `SH_AMAZON_MODE` unset/empty is now **`replay`** (no network; fails at boot without a fixture transport), never `production`. In `sandbox` mode every Ads operation that is not a read (GET or catalogue-idempotent POST) is refused with `OperationUsageError` before any network call, unless `allowAdsWritesInSandbox` is passed. The `sandbox` scripts only read and keep working. | `amazon-core/test/review-fixes.test.ts`, `support.test.ts` |
| M3 | `mapMultiStatus` takes `idempotent`: an item Amazon did not mention is `outcome_unknown`, `retryable: false` for writes (reconcile by re-reading); `missing_result`, `retryable: true` only for reads. `ads.batch` passes the operation's idempotency. | `amazon-core/test/batch.test.ts`, `amazon-ads/test/portfolios.test.ts` |
| M4 | EX-PORTFOLIOS `create`/`update` go through `ads.batch`: chunked by `batchMax` (100), per-item `BatchResult`, and `Prefer: return=representation` is sent for v0 batch operations whose catalogue headers list `Prefer` (`AdsCallOptions.headers` added). The port signature changed (items in, `BatchResult` out). | `amazon-ads/test/portfolios.test.ts` |

Cheap "may fix later" items taken: **S5** SP-API tokens are exchanged at `api.amazon.com` in every region (as Amazon's SDK does; Ads stays regional) - still to be verified live in P3-SMOKE; **S8** the 401 forced refresh now happens once per call even after an earlier 429/5xx retry; **N3** token-shaped values (`Atza|…`, `Atzr|…`) are scrubbed from kept error details whatever their key; **N4** (above).

Follow-ups left (not done): **S6** report gate key should include the Ads app fingerprint (and tenant-fair scheduling, P3-INGEST); **S7** limiter budget keyed by the Amazon selling partner / advertiser id instead of the internal seller account (needs P3-IDENTITY to expose it); **N1** fold AIMD into the Lua script; **N2** cache credentials in-process in the vault source; **N5** `createAdsReports` methods rely on `this` (destructuring breaks); **N6** make `fixtures/campaigns.json` page keying use `bodyIncludes` on the token; **N7** bind the Redis key as AAD in the token cipher.

Gate: see "Review fixes - gate" below.

### Review fixes - gate

`COMPOSE_PROJECT_NAME=sellerhub_p3clients SH_PORT_OFFSET=100 SH_ENV_FILE=.env.example pnpm gate` with the stack up: **exit 0**, nothing skipped. amazon-core 82 passed (incl. 6 on real Redis), amazon-sp 24, amazon-ads 32, tools 23 (regeneration still reproduces the committed generated files), api 13 and db 2 on real Postgres, all others green. Stack brought down afterwards.
