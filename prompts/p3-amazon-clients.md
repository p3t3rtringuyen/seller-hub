# P3-CLIENTS — Amazon client layer

Model: Sonnet · checkout: worktree (commit on your branch)
OWNED_PATHS: `packages/amazon-core/**`, `packages/amazon-sp/**`, `packages/amazon-ads/**`,
`tools/codegen/**`, `docs/reports/P3-CLIENTS.md`

## Goal

One way to call Amazon, used by every slice: authenticated, rate-limited, retried, observable,
testable without the network.

## Inputs

ADR on the Amazon client layer, `catalog/spapi/*`, `catalog/ads/*`, `refs/amazon/*` (models, SDK
docs), `docs/discovery/reference-patterns.md`, `docs/SCOPE.md` (which APIs the MVP needs).

## Build

`packages/amazon-core`
- LWA token service: exchange refresh token → access token, cache until expiry minus a margin
  (Redis), single-flight per credential. The refresh token comes from a credential-provider
  interface (P3-IDENTITY implements the vault behind it); this package never reads env for
  tenant credentials.
- Rate limiter: token bucket per (seller account, operation), seeded from
  `catalog/spapi/operations.json`, adjusted from `x-amzn-RateLimit-Limit`; shared through Redis
  so workers on several machines respect one budget.
- Retry with full jitter on 429 and 5xx; honour `Retry-After`; never retry non-idempotent writes
  without an idempotency guard.
- Logging hooks: operation, seller account, status, latency, request id — never tokens or PII.

`packages/amazon-sp`
- Clients for the MVP APIs plus the always-needed ones (sellers, reports, feeds, notifications,
  tokens), from the official SDK or generated from `refs/amazon/selling-partner-api-models` per the
  ADR (generator config in `tools/codegen`, regenerable, generated code not hand-edited; the
  generator finds `refs/` through the git common dir, as CLAUDE.md describes, because a worktree
  has no `refs/` of its own).
- Restricted Data Token flow for restricted operations (only wired if D11 = yes; otherwise a
  guard that refuses restricted calls with a clear error).
- Region routing (NA / EU / FE) and a sandbox switch.

`packages/amazon-ads`
- Client per region; LWA; client-id and profile-scope headers; versioned media types from
  `catalog/ads/operations.json`; batch writes returning per-item results (207); **v1 report**
  helper (create → poll → download → decompress) — no Reporting v3 (D57 a). Named v0 exception
  adapters under `src/v0/` as listed in PLAN.md (budget-rules read only).

Both
- Recorded-fixture tests (HTTP mocked; fixtures shaped from catalogue definitions or sandbox
  responses) — no live calls in CI.
- `pnpm amazon:sandbox` script for live checks with the env credentials (used by P3-SMOKE).
- README per package: how a slice calls an operation, adds one, and tests it.

## Done when

Gate command green; tests cover token refresh, throttling (429 → backoff → success), partial
failure (207), region routing and the restricted-call guard.
