# @seller-hub/amazon-sp

Typed SP-API client (ADR-0006: generated types, own transport in `amazon-core`). Seller and vendor accounts use the same
scope (`tenantId`, `sellerAccountId`, `region`); nothing here assumes a seller-only account (D5).

## Calling an operation

```ts
const sp = createSpClient(runtime.client);
const scope = { tenantId, sellerAccountId, region: "na" } as const;

const { body } = await sp.sellers.getMarketplaceParticipations(scope); // family.operation
await sp.reports.getReport(scope, { path: { reportId } }); // path / query / body typed from Amazon's model
await sp.call("orders.searchOrders", scope, { query: { marketplaceIds, createdAfter } }); // generic form
await sp.reports.createReport(scope, { body }, { wait: { kind: "failFast" } }); // interactive caller: 503 + Retry-After instead of waiting
```

Limits come from `catalog/spapi/operations.json` (`rateLimit` per operation) and the real rate from
`x-amzn-RateLimit-Limit`; waiting for the limiter is the default (workers), `failFast` is for request/response paths.
Reads never call low-rate operations per user request (SCOPE §5 risk 5): read the database.

`runReport(sp, scope, { reportType, marketplaceIds, … })` does create → poll → document → download → gunzip.

## D11: no PII

- `sp.withRestrictedDataToken()` and `tokens.createRestrictedDataToken` always throw `PiiDisabled`.
- Operations flagged `restricted` are refused by the transport. `orders.getOrder` / `orders.searchOrders` are allowed only
  without `BUYER` / `RECIPIENT` in `includedData`; `reports.getReportDocument` only with `{ reportType }` stated and non-PII (a document id can come from a schedule or
  `getReports`), and `createReport` / `createReportSchedule` refuse report types that return buyer data (`restriction.ts`, a conservative pattern list — verify
  against Amazon's restricted-reports list when D11 changes).

## Adding an operation / testing

Add it to `tools/codegen/config/sp-allowlist.json`, run `pnpm --filter @seller-hub/amazon-core run codegen`, commit
`src/generated/**` (never edit it). To test code that calls it: `createTestRuntime()` and `createReplayTransport` from
`@seller-hub/amazon-core/testing`; add a fixture file under `fixtures/` shaped like the catalogue response and load it
with `spFixtures()` from `@seller-hub/amazon-sp/testing`. See `test/sp-client.test.ts`.

`pnpm --filter @seller-hub/amazon-sp run sandbox` — one live read against the SP-API sandbox with your `.env.local`.
