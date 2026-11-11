# P3-SCAFFOLD — review (P5-REVIEW-P3-SCAFFOLD)

Branch `claude/p3-scaffold-f31648` (3 commits, 150 files, +15.9k), read in its worktree. Reviewer: Opus 5.5, read-only.

**Verdict: MERGE-AFTER-FIXES** (p5-review wording: `CHANGES_REQUIRED`, 4 must-fix). The scaffold is solid and close to
complete: all BACKLOG §1.2 conventions have a generator, migrations equal the design DDL, compose is isolated, the gate is
real. Four defects must be fixed before main because every later task inherits them; each is a small change.

## Must fix before merge (blockers)

### B1 — BFF is an open proxy (SSRF); becomes a token leak once P3-IDENTITY adds the Bearer hop
`apps/web/app/bff/[...path]/route.ts:47` — `new URL(`/${path.join("/")}`, apiBase())`. Next decodes `%2F` inside a
catch-all segment, so `/bff/%2F%2Fhost:port/x` gives the path `//host:port/x`, which `new URL` treats as a
protocol-relative URL and resolves to **another host**.
- Reproduced on the built app (`next start`, fake upstreams on 4400 = api, 4500 = "attacker"):
  `GET /bff/%2F%2F127.0.0.1:4500/steal → 200`, upstream hits `['4400 GET /v1/x', '4500 GET /steal']`.
- Today: unauthenticated SSRF from the web server (internal network, cloud metadata). After P3-IDENTITY (which adds
  `Authorization: Bearer` to this forward): the user's API token is sent to any host an attacker links to.
- Fix: build the path from `path.map(encodeURIComponent)`, require it to start with `/v1/`, and assert
  `target.origin === new URL(apiBase()).origin` (else 400 problem). Add a unit/e2e test with the `%2F%2F` case.

### B2 — Module boundary and layering lint rules never run
`packages/config/eslint.mjs:85-113`. In flat config a later block's `no-restricted-imports` **replaces** the earlier one
for the same file. The "Amazon calls" block (`modules/*/src/**`, line 106) is last, so for every module file it is the
only restriction left. Proof:
`eslint --print-config modules/example/src/service/hello/hello-service.ts` → `no-restricted-imports` contains only
`axios, got, undici, node-fetch, @aws-sdk/client-sp*`.
- Failure: a slice imports `@seller-hub/mod-ads/src/repository/...` (deep import into another module) or a repository
  imports a service → lint passes. Parallel slices will couple to each other's internals unnoticed (conventions §11).
- Fix: one `no-restricted-imports` per file group carrying **all** patterns for that group (merge the module, layer and
  HTTP-client patterns into each block, e.g. through a helper that concatenates groups), and a test in
  `packages/config/test` that runs `ESLint.calculateConfigForFile` on a service/repository/module file and asserts every
  expected pattern is present.

### B3 — A `$ref` to a component of a `depends_on` slice fails the bundle
`tools/contracts/src/bundle.ts:107-131`. Each file is bundled alone, so an external `$ref` is pulled into that file's
components under its original name; the prefix check only exempts names from `contracts/shared/`, so the borrowed name
is rejected. BACKLOG §1.2 / ADR-0010 amendment explicitly allow `$ref` to slices in `depends_on`.
- Reproduced (scratch root, `tsx tools/contracts/src/cli.ts --root …`): `ads/bulk.yaml` referencing
  `./campaign-manager.yaml#/components/schemas/AdsCampaignManagerCampaign` →
  `component "AdsCampaignManagerCampaign" must be prefixed AdsBulk`, exit 1.
- Failure: every wave-2+ slice that reuses an S01 schema (S03, S04, S05, S07, S09–S11) cannot build its contract.
- Fix: run the prefix check against the file's **own** `components` as written in the source YAML (before bundling), or
  exempt names that another slice file of the same bundle defines identically (the merge already detects conflicts).
  Add the cross-file case to `tools/contracts/test/bundle.test.ts`.

### B4 — Migration runner refuses the normal parallel-wave merge order
`packages/db/src/migrate.ts:85-94` throws when an unapplied file is older than the newest applied one. In a wave, slice A
(created 10:00) and slice B (created 09:00) both satisfy BACKLOG's "≥ newest on main"; if A merges first, every database
that ran `db:migrate` after A's merge (dev stacks of other sessions, later staging) fails with "is older than an applied
migration" once B merges. Fresh test DBs hide it, so the gate stays green.
- Fix (pick one, record it): (a) apply older unapplied migrations in timestamp order and log them — safe because §1.2
  forbids a migration to reference same-wave tables; or (b) keep the hard error and make the orchestrator re-stamp a
  slice's migrations to "now" just before its merge (add to BACKLOG §1.5 and dev-setup). (a) is less error-prone.

## Should fix (may land as follow-ups; list them in BACKLOG)

| # | Where | Problem → failure | Fix |
|---|---|---|---|
| S1 | `apps/worker/src/runtime.ts:61-66` + `payload.ts:89-96` | `upsertJobScheduler(..., { name })` creates jobs with no data; the payload rule (tenantId/sellerAccountId/traceId) rejects them as `UnrecoverableError`. Any `*.job.ts` with `schedule` (outbox relay, rule evaluator) fails on every tick. No test covers it. | Scheduled jobs either fan out per seller account or get a system payload shape exempt from the per-account rule; decide in P3-INGEST (owner of the runner) and test it. |
| S2 | `packages/core/src/logger.ts:8-29` | Redaction lists camelCase only and one nesting level. LWA/Amazon use `access_token`, `refresh_token`, `client_secret`, header `x-amz-access-token`; `err.config.headers.Authorization` is two levels deep → logged in clear if any of them reaches a log object. | Add snake_case keys, `x-amz-access-token`, `*.headers.*` variants (and `err.config.headers`); test with an LWA-shaped object. |
| S3 | `.env.example:46-58` | Brief/CLAUDE.md say "names only"; the file now holds dev placeholder passwords (`sh_owner_dev_only`, MinIO keys) and CI loads it via `SH_ENV_FILE=.env.example`. Not real secrets and loopback-only, but a copied `.env.local` passes the fail-closed check with known values anywhere. | Orchestrator decision: accept as documented dev-only (record it), or empty the values and let CI set them in `ci.yml` env. |
| S4 | `apps/web/tsconfig.tsbuildinfo` (committed), `.gitignore` | Build artefact in git; rewritten by builds → churn and merge conflicts between slices. | `git rm --cached`, add `*.tsbuildinfo` to `.gitignore`. |
| S5 | `package.json:15` `test:integration` | `SH_REQUIRE_DB=1 turbo …` is POSIX-only; fails on Windows (the user's platform), and CLAUDE.md "Commands" advertises it. | Use `cross-env`, or a tiny tsx wrapper, or drop it and document `SH_REQUIRE_DB=1` in env. |
| S6 | `tools/registry/src/discover.ts:36-39,94` | Glob `modules/*/src/public/*.ts` matches `hello.test.ts` / `x.d.ts`, the regex then fails and `discover` **throws** (whole `pnpm gen` crashes with an internal message) instead of reporting a convention error. Same pattern for `*.permissions.ts` with a dot in the key. | Narrow globs (`!**/*.test.ts`, `!**/*.d.ts`) and push to `errors` instead of throwing. |
| S7 | `apps/api/package.json:24` | `@seller-hub/mod-example` is a devDependency of `apps/api` although the registry imports module files by relative path. Unclear whether each new module must also be added here (a shared-file edit per module, against §1.3). | Remove it if unused, or document in dev-setup §6 / BACKLOG §1.5 that wave prep adds module deps to apps. |
| S8 | `packages/config/src/ports.ts:116-146` | Offsets 0..1000 with adjacent bases: offset 1 collides minio(+1)=59001 with another stack's console; offset 947 puts pg on 56379+… range of redis. | Require offsets in steps of 10 (validate) or space the bases further; document "use multiples of 100". |

## Nits

- `packages/db/migrations/*.sql:2` header cites `test/migrations-match-design.test.ts`; the test is
  `packages/testing/test/platform-db.test.ts`.
- `tools/contracts/src/bundle.ts:206-209`: two schemas with the same `x-command-kind` overwrite silently; report a duplicate.
- `tools/registry/src/generate.ts:379-390`: slot names are not checked against the slots declared in BACKLOG/slice docs; a typo
  registers a slot nobody renders. Also `<k>.nav.ts` file name is not checked against the key.
- `apps/api/src/binding.ts:131-136`: any handler result with a numeric `status` field is treated as an `OperationResponse`;
  a domain object with `status: number` would be mis-sent. Prefer an explicit marker (`respond()` brand).
- Contract lint requires `{sellerAccountId}` for `x-scope: seller-account`; BACKLOG §1.2 writes the commands endpoint as
  `/v1/seller-accounts/{id}/commands`. Align BACKLOG wording (S02 will hit this).
- `$ref` "only to slices in `depends_on`" is not enforced (no machine-readable `depends_on`); acceptable, note it.
- Seeds run in file order after the platform seed; a seed depending on another slice's seed has no ordering hook.
- `modules/example` creates `ops.example_hello`; after merge, deleting the example makes `db:migrate` fail by design on
  every DB that applied it ("applied migrations without a file") — dev-setup says `db:reset`; keep that step explicit
  in the deletion task.
- `apps/web/app/layout.tsx` is owned by P3-DS per BACKLOG §1.3; created here as a necessary stub — P3-DS replaces it.

## Checks asked by the brief

1. **Ownership vs PLAN P3-SCAFFOLD row** — everything is inside the row except: `scripts/stack.ts` (new file in `scripts/`,
   harmless, CLI wrapper for compose — accept and add to the row), `docs/architecture/dev-setup.md` (named in the prompt),
   and the example module set (`modules/example/**`, `contracts/modules/example/hello.yaml`, `apps/web/features/example/**`,
   `apps/web/app/(app)/example/page.tsx`, `apps/web/messages/en/example.hello.json`, `packages/metrics/src/example/**`,
   `packages/testing/fixtures/example/**`, `e2e/smoke/**`) which the prompt's "one passing example" requires; marked for
   deletion. `.env.example`, `.gitignore`, `CLAUDE.md` (Commands only — verified by diff) are in scope. No edits to
   `db/design`, `docs/` (other than its own), `prompts/`, `catalog/`. **OK.**
2. **Generators vs BACKLOG §1.2 + ADR Gate-2 amendments** — routes, per-slice contracts (prefix, operationId, x-permission
   declared, x-scope, 4XX, named request bodies, duplicates), permissions, `*.job.ts`, `*.sync.ts` (duplicate key fails),
   `*.command.ts` (kind, permission, batchMax, payloadSchema, apply; `x-command-kind` both ways), migrations (name
   pattern, unique timestamps, ordered `db/migrations/index.generated.json`), seeds, `public/<k>.ts` →
   `public.generated.ts` with one-line `index.ts`, `*.nav.ts`, `*.slot.tsx`, `messages/<locale>/<m>.<k>.json`,
   `*.metric.ts`, fixtures (loader, `<k>--<case>`), tests/stories/e2e globs — **all present**. Gaps: B3, S6, nits above.
   Web "features import each other only through `public.ts`" not enforced (reported by the task itself).
3. **Migrations = `db/design/*.sql`** — 14 files, same order (`…000000`–`…000013`, `99_partitions` last); each is the design
   file byte-for-byte after a 2-line header (`tail -n +3 | cmp` OK for all 14); `core.apply_tenant_rls` (ENABLE RLS +
   `tenant_isolation` policy) intact; a test enforces equality. Applying on Postgres: **SKIPPED** here (see Gate).
4. **Compose** — `name: ${COMPOSE_PROJECT_NAME:-sellerhub}`; all host ports `${SH_*_PORT:-55432/56379/59000/59001}`, bound to
   127.0.0.1, computed from `SH_PORT_OFFSET` by `pnpm stack:*`; no standard port as default; secrets `:?`-required.
   **OK** (offset spacing: S8).
5. **Secrets** — no real credential in the diff; config fails closed with names only; request log is allow-listed
   (method, route template, status, duration, traceId). Findings: S2 (redaction), S3 (placeholder values).
6. **CLAUDE.md "Commands"** — names `pnpm gate` = `pnpm gen && pnpm lint && pnpm typecheck && pnpm test && pnpm build`;
   the script exists and ran. **OK.**

## Gate re-run

From the worktree, `SH_ENV_FILE=.env.example SH_PORT_OFFSET=300 COMPOSE_PROJECT_NAME=sellerhub_p5review pnpm gate`
→ **exit 0** (gen: 15 migrations, 1 contract, 5 operations; lint, typecheck, test, build 11/11 tasks each; `next build` OK).
Tests: all passed, **21 skipped** — DB/Redis tests (api 9, mod-example 6, testing 5, worker 1) because no stack was up.

**Stack part SKIPPED**: Docker Desktop's engine was not running (`docker ps` → pipe `dockerDesktopLinuxEngine` not found).
I did not start Docker Desktop (it could restart the legacy `ads-api-cache-1` container). So `stack:up`, `db:migrate`
on Postgres 16, RLS tests and the Redis round trip were not re-verified by me; the task report claims them green with
`SH_REQUIRE_DB=1` on two stacks. Re-run with the stack before merge (orchestrator), after the fixes.

Other commands: `eslint --print-config` (B2), scratch-root contract bundle (B3), `next start` on 127.0.0.1:3400 + two
local fake upstreams (B1); the Next server was stopped afterwards. No files changed in the worktree (`git status` clean).

## Follow-ups for the orchestrator

1. Send B1–B4 back to P3-SCAFFOLD (same branch), then re-run the gate **with the stack up and `SH_REQUIRE_DB=1`**.
2. Record the task's own decisions 1–9 (report) as ADR amendments; add S1 to P3-INGEST's brief, S2 to P3-CLIENTS/P3-IDENTITY.
3. Decide S3 and B4 option (a)/(b) and write them into BACKLOG §1.2/§1.5.

---

## Re-review (2026-11-11)

Commits `b00e58d..459f4f5` (9, on top of `947d6ea`; 44 files, +614/−110). Read-only again; worktree left clean.

**Verdict: MERGE.** All 4 blockers and all 8 should-fix items are fixed, each with a test that fails on the old code.
The DB/Redis part of the gate is still unverified by me (Docker down) — run it once with the stack before or right after merge.

| # | Fix | Evidence |
|---|---|---|
| B1 | `apps/web/lib/bff-target.ts`: segments re-encoded, `/v1/` only, target origin must equal API origin, else 400 problem | My repro on `next start` (fake upstreams 4400/4500): `/bff/%2F%2F127.0.0.1:4500/steal → 400`, upstream hits only `4400 GET /v1/x` (before: 200 + hit on 4500). Unit test `bff-target.test.ts` covers `//host`, dot and empty segments, non-`/v1`. |
| B2 | `eslint.mjs`: each file group carries the union of pattern groups | `--print-config`: service = boundary + HTTP + service layer; repository = boundary + HTTP + repository layer; route = boundary + HTTP. Stdin lint of a service importing a handler and `@seller-hub/mod-other/src/…` → 2 errors. `test/eslint.test.ts` asserts it via `calculateConfigForFile`. |
| B3 | Prefix rule applies only to components the file defines in its own YAML; duplicate `x-command-kind` now an error | My scratch case (`ads/bulk.yaml` → `./campaign-manager.yaml#/…/AdsCampaignManagerCampaign`) now bundles, exit 0 (before: prefix error). New bundle tests for the cross-file `$ref` and the duplicate kind. |
| B4 | Decision (a): `planMigrations()` applies late arrivals in timestamp order and logs `late arrival: …` | `packages/db/test/plan.test.ts`; documented in dev-setup ("Migration runner … Late arrivals … decision B4a"). Tested at plan level only; the DB path of `runMigrations` is unchanged apart from the plan and runs in the skipped DB tests. |
| S1 | Scheduler ticks carry `{system: true, traceId}`; `processScheduled()` required with `schedule` (generator error) | `apps/worker/test/run-job.test.ts` (4 cases), registry test; dev-setup §8. |
| S2 | Redaction: snake_case, `x-amz-access-token`, `x-api-key`, capitalised forms, up to 3 levels, `err.config.data/body` | `packages/core/test/logger.test.ts` checks 12 LWA/header/error-shaped secrets are absent from output. |
| S3 | DEV-ONLY placeholders kept; `loadConfig()` throws if any of them is set with `NODE_ENV=production` | config test; dev-setup §8. Matches the decision. |
| S4 | `tsbuildinfo` untracked, `*.tsbuildinfo` ignored | diff. |
| S5 | `test:integration` → `tsx scripts/test-integration.ts` (sets `SH_REQUIRE_DB=1`, Windows-safe) | diff; not run (needs DB). |
| S6 | Globs ignore `*.test.ts(x)`, `*.d.ts`, `*.generated.ts`; mismatches become errors, not throws | registry test "stray files". |
| S7 | `@seller-hub/mod-example` dropped from `apps/api`; dev-setup §8: apps need no per-module deps | diff + gate build green. |
| S8 | Offset must be a multiple of 100, 0..900 (env schema and `resolvePorts`) | config test proves no two ports collide across all valid offsets. |

Also checked: the 14 platform migrations are still the design files byte for byte after the 2-line header (header now
cites the right test). Nits from the first review not listed above stay as BACKLOG follow-ups (slot-name check, `respond()`
brand, commands path `{id}` vs `{sellerAccountId}`, seed ordering).

**Ownership:** every changed file is inside the updated PLAN row except **`scripts/test-integration.ts`** (new, a 10-line
wrapper for S5). Harmless; add it to the row (or move it under `tools/`) when recording the merge. Nothing else outside.

**Gate re-run:** from the worktree, `SH_ENV_FILE=.env.example SH_PORT_OFFSET=300 COMPOSE_PROJECT_NAME=sellerhub_p5review pnpm gate`
→ **exit 0**; lint/typecheck/test/build 11/11 each. Tests: api 4 + 9 skipped, config 10, contracts 4, core 9, db 2,
metrics 3, mod-example 3 + 6 skipped, testing 2 + 5 skipped, web 6, worker 6 + 1 skipped, tools 19 — **21 skipped**
(DB/Redis). **Stack part SKIPPED:** `docker info` failed (Docker Desktop engine not running); no stack started,
`ads-api-cache-1` untouched. The local `next start` used for B1 was stopped.
