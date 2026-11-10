# P3-SCAFFOLD — report

Status: DONE. Branch `claude/p3-scaffold-f31648`, commits `feat(scaffold): …` and `fix(testing): …` (not pushed).
Model: Sonnet 5.5, worktree session.

## What was built

An empty but real system: from a fresh clone, `install → stack:up → db:migrate → db:seed → dev` works, the gate command
is green, and every convention of `docs/BACKLOG.md` §1.2 is implemented by a generator and proven by one example module.

| Area | Result |
| --- | --- |
| Workspace | pnpm 10 + Turborepo 2, `catalog:` versions in `pnpm-workspace.yaml`, Node 24 (`.nvmrc`, `engines`), TS 5.9 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint 9 flat + Prettier |
| `packages/config` | tsconfig base, shared ESLint config (layer rules, `apps/web` import fences), zod env schema (fails closed, names only in errors), `ports.ts` (offset ports), flags, `loadEnvFile()` |
| `packages/core` | `uuidv7`, request id, `Money`/decimal helpers + `ratio`, `Scope` + `requireScope`, `Result`/`DomainError`, pino logger with redaction + request-log allow-list, time (`@js-temporal/polyfill`), and the `define*` convention types (`conventions.ts`) |
| `packages/db` | Kysely client, `withScope()` (SET LOCAL for RLS), forward-only migration runner, seed runner, `db:migrate/reset/seed/codegen`, generated `db.d.ts` (57 tables, committed), fixture seed (two tenants + seller accounts) |
| Migrations | the 14 `db/design/*.sql` files, verbatim, as `packages/db/migrations/2026111000000N_platform_<name>.sql` in order (a test keeps them identical to `db/design`) |
| `packages/contracts` | bundle (`dist/openapi.json`, `operations.json`), `openapi-typescript` types, `openapi-fetch` typed client, zod schemas from the bundle |
| `packages/metrics`, `packages/testing` | metric registry + `sumRatio`; test DB helper (migrated template DB per suite, `sh_app` NOBYPASSRLS connection, skip/require switch), fixture loader |
| `apps/api` | Fastify 5: `/healthz`, `/readyz`, `/v1/openapi.json` from the contract; routes bound by operationId; default-deny guard (401/404/403); problem+json for every error with real status; correlation id; allow-listed request log; boot refuses undeclared permissions / unbound operations |
| `apps/worker` | BullMQ Worker per registered job + `platform.noop`, payload rules (tenantId/sellerAccountId/traceId), deterministic job ids, schedules, graceful close |
| `apps/web` | Next.js 15 App Router, placeholder BFF (`/bff/*`: GET/HEAD forwarded, writes → 501 problem until P3-IDENTITY), example feature page, Vitest + RTL |
| `docker-compose.dev.yml` | Postgres 16, Redis 7 (noeviction + AOF), MinIO; project name and all host ports from env; bound to 127.0.0.1; `pnpm stack:*` wrapper |
| CI | `.github/workflows/ci.yml`: gate with Postgres/Redis services (`SH_REQUIRE_DB=1`) + Playwright smoke job |
| Tests/tooling | Vitest (unit, integration), RTL, Playwright (`playwright.config.ts`, `e2e/smoke`), Storybook 9 (`.storybook`, one story set) |
| Docs | `docs/architecture/dev-setup.md`; CLAUDE.md "Commands" (gate command = `pnpm gate`) |

### Generators (BACKLOG §1.2) — `tools/registry`, `tools/contracts`

Implemented and covered by `tools/registry/test` (8) and `tools/contracts/test` (7): routes, permissions, jobs, syncs,
commands (+ `x-command-kind` both ways), migrations (name pattern, unique timestamps, ordered index), seeds, module public
entries (`public.generated.ts`), nav, slots, message catalogues, metrics, per-slice contracts (bundle + lint rules:
operationId prefix, `x-permission` declared, `x-scope`, `4XX`, named request bodies, component prefix, duplicates).
`pnpm new:module <module> [<key>]` creates a module skeleton and slice stubs. `modules/example` (key `hello`) exercises all
of it end to end; deletion steps are in dev-setup.md §6.

## Commands run and results

Environment: Windows 11, Node v26.12.1 (Node 24 not installed; none installed system-wide), pnpm 10.12.1, Docker Desktop 28.
Stacks: `COMPOSE_PROJECT_NAME=sellerhub_p3scaffold` (offset 0) and, from a fresh clone, `sellerhub_p3b` with `SH_PORT_OFFSET=100`
(ports 55532/56479/59100/4200/3200) — both up at the same time next to the legacy `ads-api-cache-1` (6379, untouched). Both
stacks were removed with `down -v` at the end; the legacy container was not touched.

| Command | Result |
| --- | --- |
| `pnpm install` | OK (710 packages) |
| `pnpm stack:up` | postgres/redis/minio healthy |
| `pnpm db:reset` / `db:migrate` | 14 platform migrations applied; re-run applies 0; `db:migrate` after adding the example migration applied exactly 1 |
| `pnpm db:codegen` | "Introspected 57 tables" (matches the data model) |
| `pnpm db:seed` | `platform.fixtures, example.hello` |
| `pnpm gate` (stack up, `SH_REQUIRE_DB=1`) — **in the fresh clone on the second stack** | exit 0: gen, lint (11 tasks + root eslint + prettier), typecheck (11 + root tsc), test (11 tasks), build (11 tasks incl. `next build`, tsup) |
| Test counts | config 3, core 8, metrics 3, contracts 4, worker 3 (includes the Redis job round trip), mod-example 9 (6 on real Postgres/RLS), testing 7 (migrations ≡ design, 57+ tables, sh_app NOBYPASSRLS, `withScope`), api 13 (real Postgres), web 3, tools 15 — 68 total, 0 skipped with `SH_REQUIRE_DB=1` |
| `pnpm e2e` | 3 passed (home, example page with generated nav/slot/messages, BFF 501 problem) |
| `pnpm build-storybook` | built |
| `node apps/api/dist/main.js` + worker (manual) | `/healthz` 200, `/readyz` `{database: ok, redis: ok}`, protected route → 401 problem+json, request log line has only allow-listed fields; worker started with queues `platform.noop`, `example.hello-greet` |

One gate failure on the first cold run in the clone (hook timeout while the DB template was built under a parallel turbo run)
was fixed in the second commit (`--hookTimeout=60000 --testTimeout=30000`); the rerun above is green.

## Decisions taken where an ADR was silent or had to change (please record)

1. **Time library**: `@js-temporal/polyfill`, wrapped in `packages/core/src/time.ts` (conventions §6).
2. **Zod generator** (ADR-0010): no generator; `z.fromJSONSchema` over the bundle at runtime (`packages/contracts/src/zod.ts`).
3. **Migration runner — deviation from ADR-0009**: own small forward-only runner instead of node-pg-migrate. Reason: it does not
   recognise the 14-digit timestamps fixed by BACKLOG §1.2 (logs "Can't determine timestamp") and orders multi-directory sets by
   its own rules. Same guarantees: advisory lock, history table, out-of-order and missing-file errors, no down migrations.
4. **Lint boundaries — deviation from ADR-0001**: `no-restricted-imports` overrides instead of `eslint-plugin-boundaries`.
5. **MinIO image** (ADR-0014): upstream MinIO images are no longer pulled from Docker Hub/Quay; dev compose uses
   `bitnamilegacy/minio:2025.7.23` (unmaintained). Revisit before P6.
6. Dev `sh_owner` is the compose bootstrap superuser (`POSTGRES_USER=sh_owner`), so the foundation migration's default privileges
   apply; `sh_app` gets LOGIN + password from `SH_PG_APP_PASSWORD` in `db:migrate`. Production must create a non-superuser owner.
7. Versions pinned in the `catalog:`: TS 5.9, ESLint 9, Vitest 3, Next 15, Storybook 9, Fastify 5, BullMQ 5, zod 4 (newer majors exist
   for several; ADR-0001 asks for TS 5.x / ESLint 9).
8. Convention files **default-export**; `define*` helpers live in `packages/core/src/conventions.ts`. `SyncDefinition` and
   `JobDefinition` are minimal (key/family/schedule…, index signature); P3-INGEST adds the runner fields.
9. `apps/api` and `apps/worker` bundle everything (tsup) into one `dist/main.js`.

## Skipped, not done, or limited (honest list)

- `docker-compose.yml` (self-host with app images) and Dockerfiles (ADR-0014): out of this prompt's scope; P6-DEPLOY or a follow-up.
- Lint rule "a web feature imports another feature only via `public.ts`" (BACKLOG S02): needs import resolution; not enforced yet — propose to P3-DS.
- `oasdiff` breaking-change check, coverage gates (ADR-0012), Storybook interaction-test runner/a11y addon: not wired (Storybook builds; story `play` functions are not executed in CI yet).
- API query parsing of `filter[metric][op]` (deepObject) and recursive schemas (cut to `{}`) are not handled in `apps/api/src/binding.ts` — S01 will need both (request via BLOCKED).
- SIGTERM/SIGINT graceful shutdown was not exercised on Windows; `startWorkers().close()` is covered by the worker test.
- Not run on Node 24 (local is 26.12); CI uses `.nvmrc` (24).
- Prettier is scoped to files this task owns (`.prettierignore` excludes `docs/`, `prompts/`, `README.md`, `CLAUDE.md`, others' scripts); an accidental `prettier --write .` touched 60+ foreign files and was reverted before the commit (`git diff main` outside OWNED_PATHS: only `CLAUDE.md` Commands, `.env.example`, `.gitignore`).
- `x-scope: tenant` operations resolve with `sellerAccountId = null`; the real resolver is P3-IDENTITY's `Authenticator` (`apps/api/src/auth.ts`).

## Follow-ups for the orchestrator

1. Record decisions 1–6 as ADR amendments (ADR-0001/0009/0010/0014, conventions §6).
2. Before wave 1: decide who adds deepObject query parsing + `$ref` cycles to the API binder (P3-IDENTITY owns `apps/api/src/main.ts`; `binding.ts` is mine/orchestrator).
3. P3-IDENTITY: replace `noAuthenticator`, add the BFF session + CSRF, make `SH_MASTER_KEY` required, create `platform-*` modules with `pnpm new:module`.
4. P3-INGEST: extend `SyncDefinition`/`JobDefinition`; the worker `registry.generated.ts` already lists syncs, jobs and commands.
5. Delete `modules/example` (+ its web/metrics/fixture files) when the first real module lands.
6. Lockfile policy: new third-party versions go into the `catalog:` block; `pnpm-lock.yaml` is regenerated, never hand-merged.
