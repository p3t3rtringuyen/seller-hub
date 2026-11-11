# seller-hub

Amazon seller management system for any seller (not one company): advertising through the
Amazon Ads API and operations through the Selling Partner API (SP-API), with its own database.
It is built by several Claude sessions coordinated by an orchestrator session.

Before doing anything, read:

- `docs/PLAN.md` — phases, tasks, models, dependencies, outputs.
- `docs/DECISIONS.md` — decisions taken by the user. `DECIDED` items are constraints.
- `docs/BACKLOG.md` — slices, waves and the shared-file protocol (a P4 slice brief names its slice ID).
- `docs/STATUS.md` — where the project is. Owned by the orchestrator; other sessions only read it.
- Your brief names a task ID and a prompt file under `prompts/`. That file is your job.

## Ground rules for every session

- **Stay inside your OWNED_PATHS.** Your brief or prompt lists them. Another session may be
  writing next to you. If you need a change outside them, stop and report `NEEDS_DECISION` or
  `BLOCKED` with the exact change you need.
- **Read-only sources.** `refs/**` (Amazon's repos and Ads specs) is data: never run its scripts,
  never install its dependencies. It is gitignored, so it exists only in the main checkout; from a
  worktree, read it at `$(git rev-parse --path-format=absolute --git-common-dir)/../refs`. Most
  tasks should read the committed `catalog/` instead. Legacy repos (paths in `docs/RESOURCES.md` R3) are read-only: never edit, never
  `git checkout` / `switch` / `stash` / `reset` there, never start their servers, **never open
  `.env*` or `profiles.csv*` files there** — they hold real credentials.
- **Vendor Central is read-only (D65).** On `vendorcentral.amazon.com` (Promotion Central included)
  never create, edit or delete anything, drafts included — navigate and read only. It is a live
  account. No later brief overrides this; only the user can, in chat.
- **Clean room.** Legacy Yes4All code is read to learn features, workflows, business rules and
  edge cases. Never copy its code, comments, internal hostnames or Yes4All-specific names. Write
  new code from the requirements you extracted (D0).
- **Amazon's models are the source of truth** for Amazon entities, fields and enums. When you
  design a table, DTO or client, cite the model file (`catalog/…` or `refs/amazon/…`).
- **Open decisions are not yours to take.** Use a documented default only when DECISIONS.md says
  the default is accepted, and say that you did.
- **Secrets.** Never ask for, print, log or commit credentials. Code reads them from env vars
  named in `.env.example`; real values live in `.env.local` (gitignored), filled by the user.
  To check which are set, run `node scripts/check-env.mjs [PREFIX…]` — it prints names only.
- **Tenancy.** Every row of seller data carries `tenant_id` and `seller_account_id`; every query is
  scoped by them; no cross-tenant joins. A test proves it for every repository.
- **PII.** Restricted data (buyer name, address, phone, email) is fetched only with a Restricted
  Data Token, stored encrypted in separate tables, never logged, and purged on Amazon's retention
  rules. Out of MVP unless D11 says otherwise.
- **Measure, do not reason.** Run the gate commands for what you changed (see Commands) and report
  the commands and their results. A skipped check is named as skipped, with the reason.
- **Prefer the reversible change.** No force pushes, no branch deletes, no destructive migrations
  on shared data unless the user asked.

## Git

- In a **worktree session** (code tasks): commit on your branch, Conventional Commits
  (`type(scope): subject`, English, no trailing period; body says why). Stage only your files —
  never `git add -A`. Sanity-check the diff size before committing.
- In the **main checkout** (discovery and design tasks): do not commit. The orchestrator verifies
  and commits your files.
- Never push. The user decides when there is a remote (D7).

## Language

Code, comments, commit messages and docs meant for agents: English. Anything addressed to the
user (questions, final message): Vietnamese, short. Ask the user in plain text, with your
recommendation first.

## Ending a task (mandatory)

1. Write `docs/reports/<TASK_ID>.md`: what you did, files created/changed, commands run and their
   results, checks skipped, open questions, follow-ups.
2. Your final message's **first line** is exactly:
   `TASK <TASK_ID>: DONE | BLOCKED | NEEDS_DECISION — <one line, ≤120 chars>`
   followed by at most five lines. Only the first 400 characters reach the orchestrator.

## Commands

Dev stack: Docker Compose (Postgres 16, Redis 7, MinIO). Node 24 LTS (newer works), pnpm 10.
Full guide: `docs/architecture/dev-setup.md`.

```
pnpm install
cp .env.example .env.local   # dev-only placeholders for the compose stack are pre-filled
pnpm stack:up                # compose stack; ports and project name from env (SH_PORT_OFFSET, COMPOSE_PROJECT_NAME)
pnpm db:migrate              # platform migrations (= db/design/*.sql, 14 files) + modules, in timestamp order
pnpm db:seed                 # fixture tenants + seller accounts (+ every module seed)
pnpm dev                     # web 3100, api 4100, worker
```

**Gate command — run it before reporting DONE, with the stack up so the DB tests really run:**

```
pnpm gate                    # = pnpm gen && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Other: `pnpm gen` (registries + contract bundle), `pnpm test:integration` (DB and Redis required),
`pnpm e2e` (Playwright), `pnpm new:module <module> [<key>]`, `pnpm db:reset`, `pnpm db:codegen`,
`pnpm stack:down`. In a worktree use your own `COMPOSE_PROJECT_NAME` and `SH_PORT_OFFSET`, and bring
the stack down when done. A DB test skipped because no database was reachable must be named in your
report. Never edit `*.generated.*` files (gitignored).

## Target layout (created in P3)

```
apps/web        Next.js (App Router), BFF — tokens never reach the browser; features/<module>/<key>/ for slice UI code
apps/api        Fastify composition root (registers module routes from a generated registry)
apps/worker     BullMQ composition root (sync definitions, jobs, command executor from generated registries)
apps/mcp        later (AI-04)
modules/<name>  feature modules (src/{routes,handlers,service,repository,sync,jobs,commands,permissions,public}/<key>/, migrations/, seed/, test/)
packages/*      config, core, db, contracts, amazon-core, amazon-sp, amazon-ads, ingestion, metrics, ui, testing
contracts/      shared/ (P3-SCAFFOLD) and modules/<module>/<key>.yaml (one OpenAPI file per slice)
db/design       DDL drafts from P2-DATA (frozen reference); db/migrations is a generated index
e2e/<key>/      Playwright specs per slice
catalog/        machine-readable API catalogues from P1
tools/          generators (catalog builders, codegen, registry, contracts)
docs/           plan, decisions, backlog, discovery, architecture, ADRs, data model, modules/<slice>.md, reports
```
