# Dev setup

Task P3-SCAFFOLD. From a fresh clone to a running app, the conventions the generators read, and how to add a
slice. Authoritative sources: `docs/BACKLOG.md` §1 (shared-file protocol), ADR-0001, 0002, 0009, 0010.

## 1. Prerequisites

| Tool    | Version                                                    | Notes                                                                                 |
| ------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Node.js | 24 LTS (`.nvmrc`; `engines: >=24`)                         | Newer Node works (developed on 26); do not install a system-wide Node just for this.  |
| pnpm    | 10.12 (`packageManager` in `package.json`)                 | `corepack enable` or `npm i -g pnpm@10.12.1`                                          |
| Docker  | Docker Desktop / Engine with Compose v2                    | Postgres 16, Redis 7, MinIO run in containers                                         |

## 2. From a fresh clone to a running app

```bash
pnpm install
cp .env.example .env.local        # dev-only placeholders for the compose stack are already filled in
pnpm stack:up                     # Postgres 16 + Redis 7 + MinIO, waits until healthy
pnpm db:migrate                   # all migrations, in timestamp order (14 platform files = db/design/*.sql)
pnpm db:seed                      # fixture tenants + seller accounts (+ every module's seed)
pnpm dev                          # gen, then web (3100), api (4100), worker
```

Check: `curl http://127.0.0.1:4100/readyz` → `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`;
open `http://127.0.0.1:3100`.

`.env.local` is read by every CLI and server through `loadEnvFile()`; set `SH_ENV_FILE=.env.example` to use another
file (CI does). Amazon credentials (`SPAPI_*`, `ADS_*`) are only filled by the user and never read by the scaffold.
`node scripts/check-env.mjs SH_` prints which variables are set (names only).

### Ports and several stacks side by side

Every host port and the compose project name come from the environment, with **non-standard defaults**
(Postgres 55432, Redis 56379, MinIO 59000/59001, API 4100, web 3100). `SH_PORT_OFFSET` shifts all of them; an
explicit `SH_PG_PORT`, `SH_REDIS_PORT`, `SH_MINIO_PORT`, `SH_MINIO_CONSOLE_PORT`, `SH_API_PORT`, `SH_WEB_PORT` wins.

```bash
COMPOSE_PROJECT_NAME=sellerhub_b SH_PORT_OFFSET=100 pnpm stack:up     # a second, independent stack
COMPOSE_PROJECT_NAME=sellerhub_b SH_PORT_OFFSET=100 pnpm stack:down -v # remove it with its volumes
```

`pnpm stack:up|down|ps|logs` wraps `docker compose -f docker-compose.dev.yml` and prints the ports it used. Containers
are bound to `127.0.0.1` only. Never reuse a project name of another stack, and never stop containers you did not start.

## 3. Commands

| Command                                      | What it does                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm gate`                                  | **The gate**: `gen`, `lint`, `typecheck`, `test`, `build` (what every session runs)        |
| `pnpm gen`                                   | Registries (`*.generated.*`) and the contract bundle; runs automatically before every task |
| `pnpm lint` / `typecheck` / `test` / `build` | One step of the gate (Turborepo over the workspaces, plus `tools/` and root files)         |
| `pnpm test:integration`                      | Like `test`, but a missing database/Redis is a failure, not a skip (CI uses this mode)     |
| `pnpm db:migrate` / `db:seed` / `db:reset`   | Apply migrations / seed fixtures / drop all schemas and re-migrate (local DB only)         |
| `pnpm db:codegen`                            | Regenerate `packages/db/src/generated/db.d.ts` from the live schema (commit the result)    |
| `pnpm contracts:lint`                        | Redocly lint of `contracts/**` (also part of `lint`)                                       |
| `pnpm e2e`                                   | Playwright specs in `e2e/<key>/` (starts the web dev server; `pnpm exec playwright install chromium` once) |
| `pnpm storybook` / `build-storybook`         | Storybook for `apps/web/features/**` and `packages/ui/**`                                  |
| `pnpm new:module <module> [<key>]`           | Module skeleton, plus a slice's stub files when `<key>` is given                           |
| `pnpm format`                                | Prettier write                                                                             |

DB-backed tests (repository isolation, API, migrations) use the compose Postgres: they create a throw-away database
per test file from a migrated template (`packages/testing/src/test-db.ts`) and connect as `sh_app` (NOBYPASSRLS).
Without a reachable database they are **skipped with a warning**; with `SH_REQUIRE_DB=1` (`pnpm test:integration`,
CI) they fail instead. Run the gate with the stack up.

## 4. Repository layout

```
apps/web         Next.js App Router shell + BFF (apps/web/app/bff/[...path]); features/<module>/<key>/ for slice UI
apps/api         Fastify composition root: contract-bound routes, default-deny guard, problem+json, request log
apps/worker      BullMQ composition root: one Worker per registered job (+ the no-op platform.noop job)
modules/<m>      feature modules (src/{routes,handlers,service,repository,sync,jobs,commands,permissions,public}/<key>/, migrations/, seed/, test/)
packages/        config, core, db, contracts, metrics, testing (and later amazon-*, ingestion, ui)
contracts/       shared/*.yaml (P3-SCAFFOLD) and modules/<module>/<key>.yaml (one OpenAPI file per slice)
db/design        DDL drafts from P2-DATA (frozen reference); db/migrations holds only the generated index
tools/           registry (file-convention generator), contracts (bundler + lint), catalog builders
e2e/<key>/       Playwright specs per slice
```

Decisions recorded by this task (where an ADR left a choice):

- **Time library**: `@js-temporal/polyfill`, wrapped in `packages/core/src/time.ts` (nothing else imports Temporal).
- **Zod generator**: none. `packages/contracts/src/zod.ts` builds zod schemas from the bundle at runtime with
  `z.fromJSONSchema` (OpenAPI 3.1 component schemas are JSON Schema), so forms get the contract's own constraints.
- **Migration runner**: `packages/db/src/migrate.ts`, a small forward-only runner (advisory lock, `public.schema_migrations`,
  timestamp order from the generated index). It replaces node-pg-migrate named in ADR-0009 because that tool does not
  recognise the 14-digit timestamps of BACKLOG §1.2 and orders several directories by its own rules.
- **Lint boundaries**: `no-restricted-imports` overrides in `packages/config/eslint.mjs` instead of `eslint-plugin-boundaries`.
- **Bundling**: `apps/api` and `apps/worker` build with tsup into one self-contained `dist/main.js`.
- **Object storage image**: upstream MinIO no longer publishes images; the dev compose file uses the last Bitnami build
  (`bitnamilegacy/minio`). Revisit with ADR-0014.

## 5. Conventions the generators read (BACKLOG §1.2)

`pnpm gen` (= `tools/registry` + `tools/contracts`) discovers these files by glob and writes gitignored
`*.generated.*` files. A slice only **adds** files; it never edits a shared index. Every convention file
**default-exports** its definition (an array where noted); helper types are in `packages/core/src/conventions.ts`.

| File a slice adds                                                    | Default export                                    | Generated into                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `modules/<m>/src/routes/<k>/*.route.ts`                              | `RouteModule` (`router.operation(operationId, h)`) | `apps/api/src/registry.generated.ts`                               |
| `modules/<m>/src/{handlers,service,repository}/<k>/**`               | (free-form)                                       | —                                                                  |
| `contracts/modules/<m>/<k>.yaml`                                     | OpenAPI 3.1 file                                  | `packages/contracts/dist/openapi.json` (+ `operations.json`)       |
| `modules/<m>/src/permissions/<k>.permissions.ts`                     | `PermissionDecl[]` (`{ permission, roles[] }`)    | permission matrix in the API guard                                 |
| `modules/<m>/src/jobs/<k>/*.job.ts`                                  | `JobDefinition` (`queue: "<m>.<job>"`)            | `apps/worker/src/registry.generated.ts`                            |
| `modules/<m>/src/sync/<k>/*.sync.ts`                                 | `SyncDefinition` (`key: "<m>.<name>"`)            | `apps/worker/src/registry.generated.ts`                            |
| `modules/<m>/src/commands/<k>/*.command.ts`                          | `CommandHandler` (`kind`, `payloadSchema`, …)     | worker registry; contract needs a schema with `x-command-kind`     |
| `modules/<m>/migrations/<UTC yyyymmddhhmmss>_<m>_<k>_<desc>.sql`     | forward-only SQL                                  | `db/migrations/index.generated.json` (ordered)                     |
| `modules/<m>/seed/<k>.seed.ts`                                       | `SeedDefinition` (`defineSeed`)                   | `db/migrations/seeds.generated.json` → `pnpm db:seed`              |
| `modules/<m>/src/public/<k>.ts`                                      | named exports                                     | `modules/<m>/src/public.generated.ts` (`src/index.ts` re-exports)  |
| `apps/web/features/<m>/<k>/<k>.nav.ts`                               | `NavEntry` or array (plain data)                  | `apps/web/nav.generated.ts`                                        |
| `apps/web/features/<m>/<k>/*.slot.tsx`                               | `{ slot, component, order }`                      | `apps/web/slots.generated.ts` (`slotsFor(name)`)                   |
| `apps/web/messages/<locale>/<m>.<k>.json`                            | message catalogue                                 | `apps/web/messages.generated.ts` (namespace `<m>.<k>`)             |
| `packages/metrics/src/<domain>/*.metric.ts`                          | `MetricDefinition`                                | `packages/metrics/src/index.generated.ts`                          |
| `packages/testing/fixtures/<api>/<operation>/<k>--<case>.json[.gz]`  | recorded/synthetic Amazon payload                 | read with `loadFixture()`                                          |
| tests `*.test.ts(x)`, stories `*.stories.tsx`, specs `e2e/<k>/**`    | —                                                 | picked up by the shared configs                                    |

What the build fails on (see `tools/registry/test` and `tools/contracts/test`): a key that is not kebab-case or a file
without a default export; a duplicate sync key, queue or command kind; a sync key or queue outside `<module>.`; a command
using an undeclared permission or without `batchMax`/`payloadSchema`; a migration name not matching the pattern or a
timestamp used twice; a nav/slot/permission with missing fields or unknown roles; a contract operation with a wrong
`operationId` prefix, without `x-permission`/`x-public`, `x-scope` or a `4XX` response, with an `x-permission` no
permissions file declares, an inline request-body schema, a component without the `<Module><KeyPascal>` prefix, or a
duplicate path/operation; an `x-command-kind` without a registered handler (and the reverse). At boot the API also
refuses to start if a contract operation has no handler, a route binds an unknown operation, or a permission is
undeclared.

## 6. Adding a slice

1. Module owner only: `pnpm new:module <module>` (skeleton `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`).
2. `pnpm new:module <module> <key>` creates the slice's stub route/handler/service/repository/permissions/public/test,
   `contracts/modules/<module>/<key>.yaml` and the message file; fill them in.
3. Add migrations/seeds/sync/jobs/commands/nav/slots as needed (table above); a repository takes a `Scope` first and its
   test proves tenant isolation against real Postgres (see `modules/example/test/hello/hello.test.ts`).
4. `pnpm gen`, then `pnpm gate`. Never edit `*.generated.*`, root config, `pnpm-lock.yaml` or another slice's files; ask
   for a change in a shared file with `BLOCKED` (BACKLOG §1.3).

`modules/example` (key `hello`) is a working example of every convention above, with its migration (`ops.example_hello`),
seed, contract, web feature (`apps/web/features/example/hello`, `app/(app)/example`), metric
(`packages/metrics/src/example`) and fixture. **Delete it when the first real module lands:** remove those paths, run
`pnpm install && pnpm gen && pnpm db:reset && pnpm db:codegen`, and drop `@seller-hub/mod-example` from `apps/api`'s
devDependencies.

## 7. Shared files and who edits them

See BACKLOG §1.3. In short: root config, lockfile, `.github`, compose files, `.env.example`, `contracts/shared`,
`tools/**`, `packages/{config,core,db,contracts,testing}` belong to P3-SCAFFOLD, then the orchestrator.
New third-party versions go into the `catalog:` block of `pnpm-workspace.yaml`.
