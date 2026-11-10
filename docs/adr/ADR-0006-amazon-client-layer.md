# ADR-0006 — Amazon client layer

Status: Accepted (Gate 2, D20, 2026-11-10) · Date: 2026-11-10 · Task: P2-ARCH

## Context

seller-hub calls SP-API and the Amazon Ads API directly with each seller account's LWA token (D52). Ads is built
on **Ads API v1** (D53) with 20 named v0 exceptions (`docs/discovery/ads-domains.md` §4); MVP uses EX-PROFILES,
EX-EXPORTS, EX-PORTFOLIOS, EX-TARGETING-RECS, EX-TARGETING-DISCOVERY, EX-CHANGE-HISTORY (SCOPE §5 risk 7). No
Reporting v3 (D57 a). Facts that shape the client:

- SP-API limits are per (application, selling partner, operation) and low; the catalogue carries `rateLimit
  {rate, burst}` for 307 of 394 operations (`catalog/spapi/operations.json`; e.g.
  `orders@2026-01-01.searchOrders` 0.0056/20, `reports.createReport` 0.0167/15); responses carry
  `x-amzn-RateLimit-Limit` (`docs/discovery/spapi-domains.md` cross-cutting 1).
- Ads limits are dynamic with no table; 429 + `Retry-After`; report concurrency can be **1 per client app**;
  exports cap 5 in progress per endpoint (`refs/amazon-ads/docs/reference/concepts/rate-limiting.md`,
  `refs/amazon-ads/docs/guides/reporting/ads-v1/limits.md`).
- 158 of 238 v1 operations answer **207** with `success[index]` / `error[index]`; `batchMax` per operation
  (`catalog/ads/operations.json` fields `multiStatus207`, `batch`, `batchMax`). v0 SP v3 wraps the same shape and
  needs vendor media types and `Prefer: return=representation`.
- Regions: NA/EU/FE hosts and LWA endpoints differ (`docs/discovery/ads-domains.md` §1; SP-API regional
  endpoints, `catalog/spapi/operations.json` `regions`).
- The official SP-API JS SDK (`refs/amazon/selling-partner-api-sdk/javascript/sdk`, package
  `@amazon-sp-api-release/amazon-sp-api-sdk-js`) is untyped JS on superagent, takes credentials per client instance,
  and its README contradicts its code on RDT support (`docs/discovery/reference-patterns.md` §2). There is no
  official Ads JS SDK.
- SP-API models are Swagger 2.0 (`refs/amazon/selling-partner-api-models/models/**`); Ads specs are OpenAPI 3
  (`refs/amazon-ads/specs/**`).

## Options

| Option | For | Against |
|---|---|---|
| Official SP-API JS SDK + hand-written Ads client | Amazon-maintained SP-API surface, built-in LWA and Bottleneck limiter | no types; per-instance credentials do not fit multi-tenant pooling; in-process limiter cannot be shared by api + N workers; RDT unclear; two different styles for SP and Ads |
| **Generated TypeScript types from the pinned `refs/` models + our own transport in `amazon-core`** | one style for SP and Ads; typed requests/responses per operation; tenancy-aware credentials, distributed limiter, 207 mapping and logging rules in one place; regenerable when `refs/` is refreshed | we own the transport (~1–2 k lines) and the codegen step |
| Hand-written clients per operation | full control | drift from Amazon's models; big surface (MVP alone touches ~40 operations) |

## Decision

**Generate types, own the transport.**

1. **Codegen** (`tools/codegen`, run by P3-CLIENTS, output committed under `packages/amazon-sp/src/generated` and
   `packages/amazon-ads/src/generated`): SP-API Swagger 2.0 → OpenAPI 3 (swagger2openapi) → `openapi-typescript`;
   Ads OpenAPI 3 → `openapi-typescript`. Only operations listed in an allow-list file per package are emitted
   (start with the MVP set from `docs/architecture/overview.md` §5); Ads uses the **product-specific** v1 contracts
   (`SPCreateCampaign`, not `CreateCampaign`) as `ads-domains.md` §2 recommends. Each generated operation carries
   metadata from `catalog/` (rate, burst, restricted, batchMax, multiStatus207, generation, EX id).
2. **`packages/amazon-core` transport** (`fetch` via undici):
   - **Credentials**: `CredentialSource` → `(tenantId, sellerAccountId, api, region)` → access token. LWA token
     cache in Redis (encrypted, TTL = expiry − 60 s), single-flight refresh with a Redis lock; `invalid_grant` →
     `ConnectionNeedsReauth` (ADR-0005 step 6). Grantless (`client_credentials` with scope) supported for app-level
     operations only.
   - **Rate limiting**: distributed **token bucket in Redis** (atomic Lua) keyed
     `rl:{app}:{api}:{region}:{sellingPartnerOrAdsAccount}:{operation}`. SP-API seeds `rate`/`burst` from
     `catalog/spapi/operations.json` and **adapts** the rate from `x-amzn-RateLimit-Limit` when present
     (stored with TTL). Ads: buckets per (client app, advertiser account, operation group) start from conservative
     defaults in config and use AIMD — halve on 429, creep up on success; **report creation** and **export creation**
     also take a **global per-client-app semaphore** (concurrency 1 for v1 reports by default, 5 per export
     endpoint), with fair round-robin across tenants (matters for SaaS). Callers choose `wait` (worker: delay the job
     with `moveToDelayed`) or `failFast` (interactive API lookups → 503 + `Retry-After`).
   - **Retries**: 429 → honour `Retry-After` / bucket, then exponential backoff with full jitter (base 1 s, cap
     60 s, max 6 attempts); 5xx/network on **reads** → same; on **writes** a 5xx/timeout is *not* blindly retried:
     the command executor reconciles by re-reading (ADR-0011). 400/401/403/404/422 are never retried (401 once after
     a forced token refresh).
   - **207 mapping**: `BatchResult<TIn, TOut> = { items: Array<{ index, input, ok: true, entity } | { index, input,
     ok: false, errors: AmazonItemError[], retryable }> }`, normalised for v1 (`success/error`) and v0 SP v3 wrappers;
     a 207 is never treated as success as a whole. Chunking by `batchMax`.
   - **Region routing**: host and LWA endpoint chosen from the seller account's region (table in
     `amazon-core/regions.ts` from `ads-domains.md` §1 and SP-API endpoints).
   - **Restricted / RDT**: operations flagged `restricted` in `catalog/spapi/operations.json`, plus
     `orders.searchOrders`/`getOrder` buyer-info paths (SCOPE §5 risk 10), are callable only through
     `withRestrictedDataToken(dataElements)`. In MVP (D11) that method throws `PiiDisabled`; the client never requests
     `buyerInfo`/`shippingAddress`.
   - **Modes** (`SH_AMAZON_MODE`): `production`; `sandbox` (SP-API sandbox hosts; Ads uses test accounts —
     `EX-TEST-ACCOUNTS`, there is no Ads sandbox host); `replay` (fixtures from `packages/testing`, ADR-0012) used by
     CI, Storybook data and local dev without credentials.
   - **Logging** per conventions §7; OTel span per call with operation id, region, status, retries, throttled.
3. **`packages/amazon-ads` port/adapter split for D53**: domain ports (`CampaignsPort`, `TargetsPort`,
   `ReportsPort`, `PortfoliosPort`, `ExportsPort`, `HistoryPort`, `ProfilesPort`, `TargetingRecsPort`,
   `TargetingDiscoveryPort`, …). v1 adapters are the default; each v0 adapter lives in `src/v0/<ex-id>/` with a
   header naming its EX id and the release-notes page to watch. Swapping an exception to v1 replaces one adapter;
   callers do not change. A test lists every v0 adapter and fails if it is not in the exception table.
4. **`packages/amazon-sp`**: one thin typed client per API family/version used (sellers, listingsItems,
   catalogItems, reports, fbaInventory, sales, orders@2026-01-01, finances@2024-06-19, finances v0
   `listFinancialEventGroups`, notifications later, vendor families later).
5. The SDK repo stays a **reference** (token-cache margin, Bottleneck reservoir semantics, RDT call shape) — not a
   dependency.

## Consequences

- P3-CLIENTS delivers codegen, transport, limiter, 207 mapping, replay mode and the MVP operation allow-list.
- Refreshing `refs/` (P0 scripts) → regenerate → type errors surface model changes at compile time.
- The Ads report semaphore makes backfills slow by design (SCOPE §5 risk 4); ingestion spreads them (ADR-0008).
- The AI layer (ADR-0007) reuses the credential source and audit, not the limiter (MCP has its own limits).

## Revisit when

Amazon publishes a typed, multi-tenant-friendly JS SDK for both APIs; Ads publishes per-operation limits; or a v0
exception gains a v1 equivalent (swap the adapter).
