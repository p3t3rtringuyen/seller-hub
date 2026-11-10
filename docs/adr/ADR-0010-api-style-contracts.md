# ADR-0010 — API style and contracts

Status: Accepted (Gate 2, D20, 2026-11-10) · Date: 2026-11-10 · Task: P2-ARCH

## Context

The web app, later the assistant (ADR-0007) and seller-hub's own MCP server (AI-04) consume the API. Several
slices define endpoints in parallel; none may edit a shared contract file. The legacy had two copies of one API
(trap 13) and errors inside 200 (trap 2). Validation and permissions must be declared, not remembered
(ADR-0002).

## Options

| Option | For | Against |
|---|---|---|
| **REST + OpenAPI 3.1, contract-first, per-module source files bundled at build** | language-neutral contract for web, MCP server and future public API; Fastify validates from it; typed client generated; reviewable diffs per module | YAML authoring discipline; bundling step |
| REST, code-first (zod-to-openapi / decorators) | types and spec in one place | the spec becomes an output nobody reviews; parallel slices drift in style |
| tRPC | end-to-end types with no codegen | TS-only coupling; no contract for MCP/public API; RBAC metadata not declarative |
| GraphQL | flexible reads | per-field auth and N+1 complexity; poor fit for command-style writes and file downloads |

## Decision

1. **REST/JSON, OpenAPI 3.1, contract-first**, versioned path `/v1`.
2. **Sources**: `contracts/shared/*.yaml` (problem details, pagination, money, date range, scope params, common
   headers — owned by P3-SCAFFOLD, changed only via the orchestrator) and `contracts/modules/<module>.yaml` (one file
   per module, owned by its slice). Each module file holds its `paths` and `components` with names prefixed by the
   module (`AdsCampaignRow`).
3. **Bundling**: `tools/contracts` (Redocly CLI `join`/`bundle`) merges all module files into
   `packages/contracts/dist/openapi.json` (generated, gitignored) — discovered by glob, so no shared index is edited.
   Redocly lint rules (in `contracts/redocly.yaml`) enforce: operationId `<module>.<verb><Noun>`, every operation has
   `x-permission` (or `x-public: true`) and `x-scope` (`tenant` | `seller-account`), every operation declares
   `4XX` problem responses, list operations use the shared pagination parameters, no inline anonymous schemas for
   bodies, module prefix on component names.
4. **Generated outputs** (`packages/contracts`): TypeScript types (`openapi-typescript`), a typed fetch client
   (`openapi-fetch`) used by the web app (through `/bff`) and tests, and zod schemas for forms (`openapi-zod-client`
   or equivalent — chosen in P3-SCAFFOLD). The API registers routes by operationId and gets request/response JSON
   schemas from the bundle.
5. **Contract tests**: every route's responses are validated against the bundle in API tests (ADR-0012); CI fails if
   the bundle has breaking changes against `main` without a version bump note (`oasdiff`).
6. **Style**: resources nested under `/v1/seller-accounts/{sellerAccountId}` when seller-scoped; commands as
   `POST …/commands` with a `kind` discriminator (ADR-0011); long operations return 202 + resource to poll;
   conventions §3–§6 for errors, lists, money and time.

## Consequences

- A slice's API change is one YAML file + handlers + tests; reviewers read the YAML diff.
- The web app cannot call an endpoint that is not in the contract (typed client).
- The future MCP server (ADR-0007) derives its tools from the same bundle.

## Revisit when

A public developer API is offered (add a stability policy and separate public tag set), or bundling becomes a
bottleneck.

## Amendment — Gate 2 (2026-11-10)

Accepted by the user with D20, from P2-BACKLOG. `docs/BACKLOG.md` §1 (shared-file protocol) is the authoritative statement.

- Contract files are **one per slice**: `contracts/modules/<module>/<key>.yaml` (was one per module). New component names are prefixed `<Module><KeyPascal>`; `$ref` only to slices in `depends_on`.
- One generic `POST …/commands` endpoint (`kind`, `payload`); each command handler declares its payload schema, mirrored with `x-command-kind` in the slice contract.
