# P3-SCAFFOLD — Monorepo, dev stack, CI

Model: Sonnet · checkout: worktree (commit on your branch)
OWNED_PATHS: repo-root config files, `apps/*` skeletons, `packages/config/**`, `packages/db/**`,
`packages/contracts/**`, `docker-compose*.yml`, `.env.example`, `.github/**`,
`docs/architecture/dev-setup.md`, the "Commands" section of `CLAUDE.md`, `docs/reports/P3-SCAFFOLD.md`

## Goal

An empty but real system: everything later sessions need to add a feature by adding files.

## Inputs

`docs/adr/*`, `docs/architecture/*`, `docs/data-model/README.md`, `db/design/*.sql`,
`docs/BACKLOG.md` (shared-file protocol — implement it here).

## Build (follow the ADRs; where an ADR is silent, choose the boring option and note it)

- Workspace, task runner, shared TS / lint / format config (`packages/config`).
- `apps/web` — Next.js App Router shell; BFF route placeholder; no auth yet (P3-IDENTITY).
- `apps/api` — health endpoint, error envelope and request logging per conventions (no bodies, no
  auth headers), OpenAPI served from `packages/contracts`, module auto-registration per the
  shared-file protocol.
- `apps/worker` — queue connection, a no-op job, graceful shutdown.
- `packages/db` — migration tool per ADR; turn `db/design/*.sql` into the first migrations;
  `db:migrate`, `db:reset`, `db:seed` (fixture tenant + seller account, no real data).
- `packages/contracts` — per-module contract files + bundler + typed client generation.
- `docker-compose.dev.yml` — Postgres 16, Redis 7, object storage (MinIO), and the identity
  provider if the ADR chose one. **Ports and project name come from env** (`COMPOSE_PROJECT_NAME`,
  `PORT_OFFSET` or explicit `*_PORT` vars) so two worktrees can run side by side.
- `.env.example` — every variable name with a comment; keep the Amazon variables already there.
- CI workflow: install, lint, typecheck, test, build (runs only once a remote exists — D7).
- Test runners: unit/integration (e.g. Vitest) and Playwright, each with one passing example.

## Then

- Write `docs/architecture/dev-setup.md`: from fresh clone to a running app.
- Replace the "Commands" section of `CLAUDE.md` with the exact commands, and name the **gate
  command** every session runs before reporting DONE (e.g. `pnpm lint && pnpm typecheck && pnpm
  test && pnpm build`).

## Done when

From a fresh clone of your branch: install → compose up → migrate → seed → dev works; the gate
command is green; a second stack with another `COMPOSE_PROJECT_NAME` starts without port clashes.
Report the commands and their output summaries.
