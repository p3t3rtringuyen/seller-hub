# P2-ARCH — report

Date: 2026-11-10 · Model: Opus 5.5 · Checkout: main (not committed, per brief)

## What I did

Read CLAUDE.md, `prompts/p2-architecture.md`, `docs/DECISIONS.md`, `docs/SCOPE.md` (23 ticked MVP rows),
`docs/PLAN.md`, the discovery docs (`ads-domains`, `reference-patterns`, `legacy-api-domain` §1.11–§3,
`spapi-domains` cross-cutting, `ads-mcp` §2/§5/§6, `legacy-web-features` §0/§16), `catalog/legacy/web-ux-rules.json`,
and checked the shape of `catalog/spapi/operations.json` (rateLimit present for 307/394 ops) and
`catalog/ads/operations.json` (1090 ops: 238 v1, 852 v0; fields `batchMax`, `multiStatus207`, `generation`).
Wrote the overview, conventions and 14 ADRs, then appended one OPEN question (D64).

## Files created / changed

- `docs/architecture/overview.md` — context + container diagrams (mermaid), request path and data path sequences,
  module map, table placing all 23 MVP rows (module, api, worker, web route, Amazon source with catalogue cite),
  D59 dependency note, seams for later items.
- `docs/architecture/conventions.md` — naming, UUIDv7 ids, RFC 9457 errors with real HTTP status, grid (offset)
  vs feed (cursor) lists, sort/filter grammar, money as decimal strings + currency, UTC instants / marketplace-local
  dates, logging allow-list, job idempotency, copy and constants, tenancy in code, import boundaries.
- `docs/adr/README.md` and ADR-0001 … ADR-0014 (each: Context · Options ≥ 2 with trade-offs · Decision ·
  Consequences · Revisit when).
- `docs/DECISIONS.md` — appended D64 (retention defaults) under "Phát sinh trong lúc làm".

## Key decisions (summary)

| ADR | Decision |
|---|---|
| 0001 | pnpm + Turborepo + Node 24 LTS + ESLint/Prettier + boundaries lint; feature code in `modules/<name>` packages shared by api and worker; registries generated from file conventions (no shared index edits) |
| 0002 | **Fastify 5** (not NestJS), explicit composition; handler → service → repository; Ajv validates shape from the contract, services own business rules, default-deny permission guard from `x-permission` |
| 0003 | Next.js BFF with opaque httpOnly session forwarded server-side; **MUI 7 core + TanStack Table** grid in `packages/ui` (no MUI X licence); nuqs URL state; SSE |
| 0004 | Identity in the API on Better Auth core behind an interface (no Keycloak); shared schema + `Scope` + Postgres RLS; seller account = selling partner × region; role grants by seller account, marketplace column as seam; invitations; machine tokens seam |
| 0005 | Envelope encryption (AES-256-GCM, AAD = tenant/seller/kind/region); KMS in cloud, `SH_MASTER_KEYS` in self-host; rewrap job; revocation sequence with crypto-shred |
| 0006 | Types generated from pinned `refs/` models, own transport: Redis LWA cache, distributed token bucket (catalog-seeded, header-adapted for SP-API; AIMD + per-app report semaphore for Ads), jittered retries (no blind write retries), 207 `BatchResult`, region routing, RDT blocked in MVP, `production/sandbox/replay` modes; v0 exceptions as named adapters behind ports |
| 0007 | Assistant in API using Amazon MCP in token mode with FIXED context; write tools become approval-gated commands; own MCP server later as separate app with delegated tokens, no Amazon creds |
| 0008 | BullMQ OSS + DB-driven schedule (`sync_states`), resumable runner state machines, raw landing, deterministic job ids, overlap cursors, newest-first backfill, per-seller semaphore, inbox for SQS sources |
| 0009 | Schemas by layer, monthly range partitions on local date, MinIO/S3 raw with 35-day lifecycle, PII schema reserved, Kysely + kysely-codegen + forward-only SQL migrations (node-pg-migrate) per module |
| 0010 | REST + OpenAPI 3.1 contract-first, per-module YAML bundled by Redocly, lint rules for permissions/errors/pagination, generated types + openapi-fetch client |
| 0011 | Command pattern with outbox; executor maps 207, reconciles after write timeouts, refreshes mirror; dry-run + confirmation token (428) + Idempotency-Key; rules produce proposals, auto-run only within Owner/Admin caps, cooldown, kill switches, undo |
| 0012 | Real Postgres for repositories (RLS tested), replay fixtures + Amazon mock server, contract tests, Storybook interaction tests, Playwright on compose; sandbox smoke outside PR CI |
| 0013 | pino + OpenTelemetry (trace through queues) + metrics; operational tables + in-app System health; alerts in-app/email in MVP |
| 0014 | **Proposed (D21 OPEN)**: same images; docker compose (Postgres, Redis noeviction/AOF, MinIO, Caddy) vs AWS (ECS, RDS, ElastiCache, S3, KMS, SQS, Secrets Manager) |

## Checks

- Every cited `catalog/…`, `refs/…`, `docs/…` path exists (script over all backticked paths; only glob patterns
  reported as not literal files).
- Every ADR has the five required sections (script check).
- Mermaid diagrams: **not rendered** (no mermaid CLI installed; I did not install tools). Checked by reading; one
  node label with parentheses was quoted to avoid a parse error.
- Contradiction review against DECIDED items: D0 (no legacy code), D1 c, D3 a, D4, D5/D60 (vendor seams), D11
  (RDT blocked), D50 c, D52, D53 (v0 only as named adapters), D54, D55 (fixed roles; marketplace narrowing is a
  non-exposed seam), D57 (no Reporting v3), D58, D62, D63 — no conflicts found.
- Deviation from the prompt: the prompt lists "Ads Reporting v3" among job types; D57 a forbids it, so ADR-0008
  has no v3 job family.

## Open questions

- **D64** (new, appended): retention defaults — recommend (a) raw 35 d, job runs 90 d, audit/change history 25 months.
- **D21** (existing, OPEN): ADR-0014 stays Proposed until decided.
- D59: SP detail/builder validation and tooltips rely on ads-web rules + v1 contracts until the second console pass;
  the design keeps them as data/copy (overview §5).

## Follow-ups for the orchestrator

1. ADR-0001 moves feature code to `modules/<name>`: update CLAUDE.md "Target layout" and PLAN.md OWNED_PATHS for
   P3-IDENTITY (`modules/platform-{auth,tenancy,connections}/**`) and P4 slices (`modules/<m>/**`,
   `contracts/modules/<m>.yaml`, `apps/web/app/(app)/<m>/**`, `apps/web/messages/*/<m>.json`).
2. P2-DATA inputs: schemas and frame in ADR-0009, `ops.*` model in ADR-0011, identity/tenancy tables in ADR-0004,
   ingestion tables in ADR-0008.
3. P3-SCAFFOLD must pick the time library (conventions §6) and zod generator (ADR-0010).
4. Verify live during P3-SMOKE: Ads per-client report concurrency, `x-amzn-RateLimit-Limit` presence, RDT in JS
   transport (stubbed anyway), `AdvertiserAccount.alternateIds` (EX-PROFILES).
