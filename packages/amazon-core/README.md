# @seller-hub/amazon-core

The one transport every Amazon call goes through (ADR-0006). `amazon-sp` and `amazon-ads` are typed clients on top of it;
slices never call Amazon any other way (lint blocks `axios`, `undici`, …).

| Concern                  | Where                            | Behaviour                                                                                                                                                                                                             |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LWA tokens               | `lwa.ts`, `token-cache.ts`       | refresh token → access token, cached (Redis, AES-GCM encrypted) until expiry − 60 s, single-flight per credential (in-process + Redis lock). `invalid_grant` → `ConnectionNeedsReauth`. Grantless token for app calls. |
| Credentials              | `credentials.ts`                 | `CredentialSource` interface; the vault (P3-IDENTITY) implements it. This package never reads tenant credentials from env (only `env-credentials.ts`, for `pnpm amazon:sandbox`).                                     |
| Rate limits              | `rate-limit.ts`                  | Redis token bucket (Lua, Redis clock) per `tenant · app · api · region · seller account · operation`; SP rate seeded from the catalogue, adjusted by `x-amzn-RateLimit-Limit`; Ads AIMD; concurrency gate.           |
| Retry                    | `retry.ts`, `client.ts`          | 429 and 5xx/network on reads: full jitter (1 s base, 60 s cap, 6 attempts), `Retry-After` honoured. Writes retry only on 429 (not processed) or when the caller passes `idempotent: true`. 401 → one forced refresh.   |
| Errors                   | `errors.ts`                      | `AmazonValidationError` (400/422), `AmazonAuthError`, `AmazonNotFoundError`, `AmazonThrottledError`, `AmazonUpstreamError`, `LocalRateLimitError`, `ConnectionNeedsReauth`, `PiiDisabled`.                            |
| 207                      | `batch.ts`                       | `mapMultiStatus` → one `BatchResult` item per input (v1 `success/error`, v0 wrappers); a missing item is a failure, never a success. `chunk` / `mergeBatchResults`.                                                   |
| Regions / modes          | `regions.ts`                     | NA / EU / FE hosts and LWA endpoints as data. `SH_AMAZON_MODE`: `production`, `sandbox` (SP host only), `replay` (fixtures, no network).                                                                              |
| Restricted data (D11)    | `client.ts`                      | Operations the catalogue flags `restricted` are refused (`PiiDisabled`) unless a typed client has verified the request carries no PII element. RDT is not wired.                                                      |
| Logging                  | `observer.ts`                    | One event per call: operation, account, status, latency, request id, retries — no URL, query, body, header or token. `loggerObserver(pino)` logs it.                                                                  |
| Documents                | `download.ts`                    | Pre-signed URLs: no auth header, retried, gunzipped, size-capped.                                                                                                                                                    |

## Wiring (composition root)

```ts
const { client, gate } = createAmazonRuntime({
  credentials: vaultCredentialSource, // P3-IDENTITY
  redis, // shared limiter + token cache across api and workers
  cipher: createAesGcmCipher(key32), // derived from the vault master key
  logger,
});
const sp = createSpClient(client); // @seller-hub/amazon-sp
const ads = createAdsClient(client); // @seller-hub/amazon-ads
```

Without `redis` everything is in-process: fine for tests and one dev process, wrong for several workers.

## Adding an operation

Operations are generated, not written. Add the operation id to `tools/codegen/config/sp-allowlist.json` or
`ads-allowlist.json` (a v0 Ads operation also needs its `EX-*` id from `catalog/ads/domain-map.json`), then:

```bash
pnpm --filter @seller-hub/amazon-core run codegen
```

and commit the changed `packages/amazon-{sp,ads}/src/generated/**`. The generator reads the pinned models through
`refs/` (found via the git common dir from a worktree) and the committed `catalog/`. Tests fail if the committed output
is stale, if a catalogue fact (path, rate, batch max, restricted) differs, or if a v0 operation has no named exception.

## Testing a slice without the network

```ts
import { createTestRuntime, jsonResponse } from "@seller-hub/amazon-core/testing";

const t = createTestRuntime(); // mock Amazon + manual clock + fake credentials + working LWA
t.transport.route({ path: "/sellers/v1/marketplaceParticipations" }, jsonResponse(200, { payload: [] }));
const sp = createSpClient(t.runtime.client);
await sp.sellers.getMarketplaceParticipations({ tenantId: "t", sellerAccountId: "s", region: "na" });
```

- `route(matcher, ...responses)` serves responses in order (`429, 429, 200`); `{ throw: new Error() }` simulates a network failure.
- Sleeping is instant (`ManualClock`); `t.clock.sleeps` lists the backoff delays; `t.events` the finished calls.
- `createReplayTransport({ fixtures })` + `mode: "replay"` serves JSON fixtures (`packages/amazon-sp/fixtures`,
  `packages/amazon-ads/fixtures`; `spFixtures()` / `adsFixtures()`), so Storybook and local dev run without credentials.
- Redis-backed behaviour: `tryConnectTestRedis()` returns `null` without the dev stack (tests skip; `SH_REQUIRE_DB=1` makes it fail).

No test makes a live call. `pnpm amazon:sandbox` (developer's own credentials) is the only live check and is not in the gate.
