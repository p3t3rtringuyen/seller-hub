# P2-ARCH — Architecture and ADRs

Model: Opus · checkout: main · do not commit
OWNED_PATHS: `docs/architecture/**`, `docs/adr/**`, `docs/reports/P2-ARCH.md`; you may append OPEN
questions to `docs/DECISIONS.md` ("Phát sinh trong lúc làm").

## Goal

Decide how seller-hub is built, once, in writing, so a dozen implementation sessions build the same
system. Every ADR is a decision with its alternatives, not a description.

## Inputs

`docs/SCOPE.md` (with the user's MVP ticks), `docs/DECISIONS.md` (D0–D11), `docs/discovery/*`
(especially `reference-patterns.md` and the replacement map in `legacy-api-domain.md`),
`catalog/spapi/*`, `catalog/ads/*`.

## Outputs

`docs/architecture/overview.md` — system context and containers (mermaid), the request path
(browser → web BFF → API → Amazon), the data path (Amazon → worker → raw landing → normalised
tables → facts → API → UI), and where each MVP feature lives.

`docs/architecture/conventions.md` — naming; IDs; error envelope (the HTTP status is always the
real one — the legacy API answered 200 with an error inside, do not repeat it); pagination,
sorting and filtering on list endpoints; money (decimal with currency code); time (UTC storage;
facts keyed by the marketplace's local date); logging (no tokens, no PII, no request bodies of
credential calls); where copy and constants live.

`docs/adr/ADR-NNNN-<slug>.md`, one per decision. Format: Context · Options (≥2, with trade-offs) ·
Decision · Consequences · Revisit when. At least:

1. Monorepo layout and tooling (package manager, task runner, TS config, lint/format).
2. Backend framework and module structure (handler → service → repository; who owns validation).
3. Frontend: Next.js App Router; BFF with httpOnly session — **Amazon and identity tokens never
   reach the browser**; UI kit (MUI 7 + a data-grid, or alternatives) — weigh what the legacy UX
   rules need (server-side tables, ellipsis + tooltip cells, skeletons, URL state).
4. Identity and tenancy: identity provider (Keycloak vs built-in auth library), tenant → members →
   roles, per-seller-account and per-marketplace permissions, invitation flow.
5. Credential vault: envelope encryption of LWA refresh tokens (KMS in cloud, master key from env
   for self-host), rotation, revocation on disconnect.
6. Amazon client layer: official SDK packages vs code generated from `refs/` models; LWA token
   cache; Restricted Data Tokens; rate limiting — a token bucket per (seller account, operation)
   seeded from `catalog/spapi/operations.json` and adapted from `x-amzn-RateLimit-Limit`; retries
   with jitter on 429/5xx; Ads API 207 partial failures; region routing; sandbox switch. Ads: built
   on **Amazon Ads API v1** (D53); the v0 exceptions from `docs/discovery/ads-domains.md` sit behind
   the same client interface so swapping one to v1 later touches one adapter.
   Also the AI layer (D50 = c): an assistant that uses Amazon's hosted Ads MCP and SP-API MCP servers
   with per-seller OAuth and approval for every write; later, a seller-hub MCP server over our own
   data — decide where each lives and how credentials flow.
7. Ingestion: job queue and scheduler; job types (paged pull, report request → poll → download →
   decompress → parse → upsert, Data Kiosk, Ads Reporting v3, Ads exports, SP-API notifications,
   Marketing Stream); idempotency and cursors; backfill; per-seller concurrency; a plug-in registry
   so feature slices add sync definitions without editing shared files.
8. Storage: PostgreSQL 16 schemas by layer; partitioning of fact tables; raw payload landing in
   object storage (S3 / MinIO) with retention; PII tables, encryption and purge; migration tool.
9. API style: REST, contract-first OpenAPI in `contracts/`, a generated typed client for the web
   app; how per-module contracts are bundled without slices editing one shared file.
10. Writes to Amazon: command pattern with audit log and change-history rows (who / what / when /
    source = user | rule | amazon); confirmation for bulk/destructive actions; how rule engines
    (auto bidding, budget rules) run safely (dry run, limits, kill switch).
11. Testing: unit; repository tests against a real Postgres; contract tests; ingestion tests from
    recorded fixtures (no live Amazon calls in CI); sandbox smoke; Playwright end-to-end.
12. Observability: structured logs, traces, job-run table, alerting on sync lag and throttling.
13. Deployment shapes: self-host (docker compose) and cloud (per D21) — what differs.

Where an ADR depends on something only the user can decide, mark it `Proposed`, append the
question to DECISIONS.md (options + your recommendation), and say so in your final message.

## Done when

Every MVP feature in SCOPE.md has a home in the overview; every ADR has real alternatives; nothing
contradicts a DECIDED item.
