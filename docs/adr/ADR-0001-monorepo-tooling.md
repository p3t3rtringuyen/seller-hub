# ADR-0001 — Monorepo layout and tooling

Status: Accepted, pending Gate 2 (D20) · Date: 2026-11-10 · Task: P2-ARCH

## Context

D3 a fixes TypeScript across web, API and worker. Up to three writer sessions work in parallel worktrees
(D6), each owning disjoint paths; a feature slice must be addable without editing shared files. D54 requires
Vitest, Storybook and Playwright in a Turborepo pipeline with CI blocking on red. The worker and the API must
share module code (repositories, sync definitions, command handlers).

## Options

**Package manager**
| Option | For | Against |
|---|---|---|
| **pnpm workspaces** | strict node_modules (no phantom deps), fast, content-addressed store, `workspace:` protocol, catalogs for single versions | symlink quirks on some Windows tools |
| npm workspaces | no extra tool | hoisting hides undeclared deps; slower |
| Yarn 4 (PnP) | strict, fast | PnP friction with Next.js / Storybook tooling |

**Task runner**
| Option | For | Against |
|---|---|---|
| **Turborepo** | named in D54; simple pipeline file; local + remote cache | less graph introspection than Nx |
| Nx | generators, module-boundary lint, affected graph | heavier; more config surface for parallel agents to disagree about |

**Lint / format**
| Option | For | Against |
|---|---|---|
| **ESLint 9 flat config + typescript-eslint + Prettier**, `eslint-plugin-boundaries` for layer rules | Next.js, React, Storybook and Playwright plugins exist; boundary rules (conventions §11) | slower than Biome |
| Biome | very fast, one tool | no Next.js / boundary plugins at the level we need |

**Where feature code lives**
| Option | For | Against |
|---|---|---|
| **`modules/<name>` workspace packages** imported by `apps/api` and `apps/worker` | one owner path per slice; api and worker share the same service/repository code; apps stay composition roots | adds a workspace root; P3 owned paths shift slightly |
| `apps/api/src/modules/<name>` only | matches the first sketch in CLAUDE.md | worker cannot import from an app cleanly → duplicated repositories or a back-door import |

## Decision

- **pnpm** (with `catalog:` versions in `pnpm-workspace.yaml`), **Turborepo**, **Node 24 LTS** (`.nvmrc`,
  `engines`), TypeScript 5.x strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
  ESM only, project references via a shared `packages/config/tsconfig.base.json`.
- **ESLint flat config + Prettier**, with `eslint-plugin-boundaries` enforcing conventions §11.
- Layout:

```
apps/web            Next.js BFF (ADR-0003)
apps/api            Fastify composition root (ADR-0002)
apps/worker         BullMQ composition root (ADR-0008)
apps/mcp            later (AI-04, ADR-0007)
modules/<name>      feature modules: src/{routes,service,repository,sync,commands}/, migrations/, contract/
packages/config     tsconfig, eslint, env schema, flags
packages/core       ids, Money/Decimal, time, Result, errors, Scope
packages/db         Kysely instance, generated DB types, migration runner, RLS helpers
packages/contracts  OpenAPI bundle + generated types + typed client (ADR-0010)
packages/amazon-core, amazon-sp, amazon-ads   (ADR-0006)
packages/ingestion  job framework, registry loader (ADR-0008)
packages/metrics    metric definitions shared by api and web
packages/ui         design system + data grid (ADR-0003)
packages/testing    fixtures loader, Testcontainers helpers, Amazon mock (ADR-0012)
contracts/          OpenAPI sources per module (ADR-0010)
db/migrations       (generated index only; files live in modules/*/migrations, ADR-0009)
tools/              catalog builders, codegen, registry generator
```

- Registries (routes, sync definitions, command handlers, migrations, contract parts) are **discovered by a
  generator** (`tools/registry`) from file conventions at build time into gitignored `*.generated.ts` files. A
  slice adds files; it never edits a shared index.

## Consequences

- P3-SCAFFOLD creates `modules/` and the registry generator; P3-IDENTITY's owned paths become
  `modules/platform-{auth,tenancy,connections}/**` instead of `apps/api/src/modules/{auth,tenancy,connections}/**`
  (orchestrator: adjust PLAN.md and CLAUDE.md target layout).
- One lockfile → dependency changes conflict between parallel worktrees; rule: a slice that adds a dependency
  says so in its report, the orchestrator merges lockfile changes first.
- Turbo cache keys include env names listed in `turbo.json` (`globalEnv`), so builds stay reproducible.

## Revisit when

Builds exceed ~10 min in CI (consider Nx affected or remote cache), or Biome gains the plugins we need.
