# @seller-hub/amazon-ads

Typed Amazon Ads client. **Ads API v1 is the default (D53); v0 exists only as named exceptions; there is no Reporting v3
(D57 a, v3 shuts off 2027-06-30).**

## Calling

```ts
const ads = createAdsClient(runtime.client);
const scope = { tenantId, sellerAccountId, region: "na", profileId, accountId } as const; // profile → Amazon-Advertising-API-Scope

await ads.SPQueryCampaign(scope, { body: { adProductFilter: { include: ["SPONSORED_PRODUCTS"] }, maxResults: 1000 } });
const result = await ads.batch("SPUpdateTarget", scope, targets); // 207: chunked by batchMax, one result per input
```

Slices should depend on the **ports**, not on operation ids: `CampaignsPort`, `AdGroupsPort`, `AdsPort`, `TargetsPort`
(`createCampaignsPort(ads)` …) offer `query`, `queryPages`, `create`, `update`, `delete`. A swap of the API generation
replaces one adapter.

A 207 is never success as a whole: `BatchResult.items[i]` is `{ ok: true, entity }` or `{ ok: false, errors, retryable }`;
`partial` means some succeeded and some failed (the command is `partially_succeeded`). A whole-request failure becomes a
failure of every item in the chunk; a 5xx on a write is `outcome_unknown` (not retried: reconcile by re-reading).

## Reports (v1 only)

```ts
const reports = createAdsReports({ ads, gate }); // gate from createAmazonRuntime: 1 report at a time per client app
const out = await reports.run(scope, body); // create → poll (5 s … 60 s) → download parts → gunzip
out.parts; // Uint8Array per part; out.text() for GZIP_JSON / CSV
```

Fields and dimensions come from `catalog/ads/reports.json`. If a column is missing in v1, hide it and record the exception;
do not fall back to v3.

## v0 exceptions (`src/v0/<ex-id>/`)

`EX-PROFILES`, `EX-EXPORTS` (5 jobs per endpoint, 202 → poll → download), `EX-PORTFOLIOS`, `EX-TARGETING-RECS`,
`EX-TARGETING-DISCOVERY`, `EX-CHANGE-HISTORY`, `EX-BUDGET-RULES` (**read only** — GET operations, no write method).
Each folder's header names the exception, why v1 is not enough and where to watch for the v1 equivalent. `test/exceptions.test.ts`
fails if a generated v0 operation is not in the exception table or disagrees with `catalog/ads/domain-map.json`.

## Adding an operation / testing

Add it to `tools/codegen/config/ads-allowlist.json` (a v0 operation needs `"exception": "EX-…"`), run
`pnpm --filter @seller-hub/amazon-core run codegen`, commit `src/generated/**`. Test with `createTestRuntime()` /
`createReplayTransport` from `@seller-hub/amazon-core/testing` and `adsFixtures()` from `@seller-hub/amazon-ads/testing`
(see `test/ads-client.test.ts`). Ads has no sandbox host: `pnpm --filter @seller-hub/amazon-ads run sandbox` does one read-only
`listProfiles` on your region's host with `.env.local` credentials (use a test account).
