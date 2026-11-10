# Architecture Decision Records

Format: Context · Options (≥ 2, with trade-offs) · Decision · Consequences · Revisit when.
Status values: `Proposed` (needs a user decision first), `Accepted, pending Gate 2 (D20)`, `Accepted`,
`Superseded by ADR-NNNN`. A new decision gets the next number; an accepted ADR is changed only by a new ADR
that supersedes it.

| ADR | Title | Status | Depends on |
|---|---|---|---|
| [0001](ADR-0001-monorepo-tooling.md) | Monorepo layout and tooling (pnpm, Turborepo, ESLint+Prettier, `modules/*`) | Accepted, pending D20 | D3, D6, D54 |
| [0002](ADR-0002-backend-framework.md) | Backend framework: Fastify 5, handler → service → repository, default-deny | Accepted, pending D20 | D3 |
| [0003](ADR-0003-frontend-bff-ui.md) | Next.js App Router BFF, httpOnly session, MUI 7 + TanStack Table | Accepted, pending D20 | D3, D51, D54 |
| [0004](ADR-0004-identity-tenancy.md) | Identity (built-in, Better Auth core) and tenancy (shared schema + RLS, fixed roles) | Accepted, pending D20 | D1, D55 |
| [0005](ADR-0005-credential-vault.md) | Credential vault: envelope encryption, KMS / env master key, rotation, revocation | Accepted, pending D20 | D1, D52 |
| [0006](ADR-0006-amazon-client-layer.md) | Amazon client layer: generated types, own transport, distributed limiter, 207, v0 adapters | Accepted, pending D20 | D11, D52, D53, D57 |
| [0007](ADR-0007-ai-mcp-layer.md) | AI layer: MCP client assistant, seller-hub MCP server (seams only in MVP) | Accepted, pending D20 | D50 |
| [0008](ADR-0008-ingestion.md) | Ingestion: BullMQ, DB-driven schedule, resumable runners, plug-in sync registry | Accepted, pending D20 | D3, D57, D58, D62 |
| [0009](ADR-0009-storage.md) | Storage: schemas by layer, monthly fact partitions, raw landing, PII, Kysely + SQL migrations | Accepted, pending D20 (retention defaults: D64) | D3, D11 |
| [0010](ADR-0010-api-style-contracts.md) | REST + OpenAPI 3.1 contract-first, per-module files bundled | Accepted, pending D20 | — |
| [0011](ADR-0011-amazon-writes-commands-rules.md) | Writes: commands + outbox, audit, confirmation, rule engine caps and kill switch | Accepted, pending D20 | D62, D63 |
| [0012](ADR-0012-testing.md) | Testing: real Postgres, fixtures/replay, contract tests, Storybook, Playwright | Accepted, pending D20 | D30, D54 |
| [0013](ADR-0013-observability.md) | Observability: pino, OpenTelemetry, operational tables, in-app health | Accepted, pending D20 | D21 |
| [0014](ADR-0014-deployment-shapes.md) | Deployment shapes: docker compose self-host, AWS cloud | **Proposed** | **D21 (OPEN)** |

Overview and conventions: `docs/architecture/overview.md`, `docs/architecture/conventions.md`.
