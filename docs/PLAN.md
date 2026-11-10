# PLAN

Source of truth for the orchestrator: which task runs when, on which model, in which checkout,
and what it must leave behind. Change it only through the orchestrator, and record why in
`docs/STATUS.md`.

## Models (D6)

| Alias | Model id | Use for |
| --- | --- | --- |
| opus | `claude-opus-5-5` | orchestration, synthesis, architecture, data model, review, security |
| sonnet | `claude-sonnet-5-5` | discovery that needs code reading, all implementation |
| haiku | `claude-haiku-5-5` | summarising many files, smoke tests, QA checklists |

The orchestrator must itself run on opus: a session can only start sessions of the same tier or
cheaper.

## Concurrency (D6)

- At most **3 writer sessions** (worktree) at once; at most **6 sessions** in total.
- At most **1 session runs the full stack** (docker compose + app) at once, until P3-SCAFFOLD has
  made ports and `COMPOSE_PROJECT_NAME` configurable; after that, each such session gets its own
  project name and port offset (recorded in STATUS.md).
- Two writers never own overlapping paths.
- At most **1 session drives the user's Chrome** (Claude in Chrome) at once.

## Gates

| Gate | Passes when | Unblocks |
| --- | --- | --- |
| G0 | D0–D9 decided; R1–R3 confirmed; bootstrap done | P1 |
| G1 | User ticked MVP in `docs/SCOPE.md`; D10–D11 decided; user said `duyệt` | P2 |
| G2 | User approved ADRs, the ADR amendments from P2-BACKLOG and `docs/BACKLOG.md` (`duyệt`); D20–D21 decided | P3 |
| G3 | P3 merged; R5/R6 names set (`check-env.mjs SPAPI_ ADS_`); D30 decided; P3-SMOKE DONE | P4 |
| G4 | MVP waves merged; D40 decided | P6-DEPLOY |

## Tasks

`wt` = runs in its own git worktree (`use_worktree: true`, `branch_name` = task id lowercased,
`source_branch: main`) and commits on its branch. `main` = shares the main checkout, writes only
its OWNED_PATHS, does not commit.

### P0 — Bootstrap (orchestrator itself, after G0)

1. `git init` if needed; make sure `.gitignore` covers `refs/`, `.env.local`.
2. Initial commit of the kit (`chore(repo): bootstrap seller-hub kit`).
3. Run `powershell -File scripts/fetch-refs.ps1`; confirm `refs/amazon/VERSIONS.txt`.
4. Confirm every legacy path in R3 is readable (list one directory each; read nothing else).
5. Run `node scripts/fetch-ads-refs.mjs` (R4): mirrors every Amazon Ads API spec, the MCP tool
   specs and every docs page into `refs/amazon-ads/` (`INDEX.md`, `manifest.json`).

### P1 — Discovery

| ID | Prompt | Model | Effort | Checkout | Depends | OWNED_PATHS / outputs |
| --- | --- | --- | --- | --- | --- | --- |
| P1-SPAPI | `p1-spapi-catalog.md` | sonnet | medium | main | P0 | `tools/catalog/spapi.mjs`, `catalog/spapi/**`, `docs/discovery/spapi-domains.md` |
| P1-ADS | `p1-ads-catalog.md` | sonnet | high | main | P0 | `tools/catalog/ads.mjs`, `catalog/ads/**`, `docs/discovery/ads-domains.md`, `docs/discovery/ads-mcp.md` |
| P1-CONSOLE | `p1-ads-console.md` | sonnet | high | main | P0, R11 | `catalog/console/**`, `docs/discovery/ads-console-features.md` |
| P1-VENDOR | `p1-vendor-console.md` | sonnet | high | main | P0, P1-CONSOLE done (one Chrome driver) | `catalog/vendor/**`, `docs/discovery/vendor-features.md` |
| P1-WEB | `p1-legacy-web.md` | sonnet | medium | main | P0 | `catalog/legacy/web-*.json`, `docs/discovery/legacy-web-features.md` |
| P1-API | `p1-legacy-api.md` | sonnet | medium | main | P0 | `catalog/legacy/api-*.json`, `catalog/legacy/entities.json`, `catalog/legacy/jobs.json`, `docs/discovery/legacy-api-domain.md` |
| P1-REF | `p1-reference-patterns.md` | haiku | medium | main | P0 | `docs/discovery/reference-patterns.md`, `docs/discovery/feature-ideas.md` |
| P1-SCOPE | `p1-scope-synthesis.md` | opus | high | main | all above | `docs/SCOPE.md` → **G1** |

P1-SPAPI, P1-ADS, P1-WEB, P1-API, P1-REF and P1-CONSOLE run in parallel (six sessions — the
total cap). P1-CONSOLE drives the user's Chrome: tell the user it is running, so they leave its
tab alone. P1-VENDOR (added 2026-11-09 for D5 = Seller + Vendor) also drives Chrome, so it starts
when P1-CONSOLE is done, in the slot of whichever P1 session finished first. P1-SCOPE waits for it.

### P2 — Design

| ID | Prompt | Model | Effort | Checkout | Depends | OWNED_PATHS / outputs |
| --- | --- | --- | --- | --- | --- | --- |
| P2-ARCH | `p2-architecture.md` | opus | high | main | G1 | `docs/architecture/**`, `docs/adr/**` |
| P2-DATA | `p2-data-model.md` | opus | high | main | P2-ARCH | `docs/data-model/**`, `db/design/**` |
| P2-BACKLOG | `p2-backlog.md` | sonnet | high | main | P2-DATA | `docs/BACKLOG.md`, `docs/reports/P2-BACKLOG.md` → **G2** |

### P3 — Foundation

| ID | Prompt | Model | Effort | Checkout | Depends | OWNED_PATHS |
| --- | --- | --- | --- | --- | --- | --- |
| P3-SCAFFOLD | `p3-scaffold.md` | sonnet | high | wt | G2 | repo root config, `apps/*` skeletons, `packages/{config,db,contracts,core,metrics,testing}/**`, `modules/` root conventions + `pnpm new:module`, `tools/registry/**`, `tools/contracts/**`, `contracts/shared/**`, `contracts/redocly.yaml`, `.storybook/**`, Playwright config, `docker-compose*.yml`, `.env.example`, `.github/**`, CLAUDE.md "Commands" section. Implements every convention of BACKLOG §1.2 |
| P3-CLIENTS | `p3-amazon-clients.md` | sonnet | high | wt | P3-SCAFFOLD merged | `packages/amazon-core/**`, `packages/amazon-sp/**`, `packages/amazon-ads/**` (incl. `src/v0/{ex-profiles,ex-exports,ex-portfolios,ex-targeting-recs,ex-targeting-discovery,ex-change-history,ex-budget-rules}` and ports `CampaignsPort, AdGroupsPort, AdsPort, TargetsPort`), `tools/codegen/**` |
| P3-DS | `p3-design-system.md` | sonnet | medium | wt | P3-SCAFFOLD merged | `packages/ui/**`, `apps/web/app/(shell)/**`, `apps/web/app/(app)/layout.tsx`, shell code reading `nav.generated.ts` / `slots.generated.ts` |
| P3-IDENTITY | `p3-identity-tenancy.md` | sonnet | high | wt | P3-CLIENTS merged | `modules/platform-{auth,tenancy,connections}/**`, `modules/platform-audit/**` (skeleton, `ops.audit_log`, `AuditWriter` only), `contracts/modules/platform-{auth,tenancy,connections,audit}/**`, `apps/web/app/(auth)/**`, `apps/web/app/(app)/settings/{members,connections}/**`, core-schema migrations inside those modules. Also: `/v1/me` column preferences, `ref.marketplaces` / `ref.ads_limits` read endpoint |
| P3-INGEST | `p3-ingestion-engine.md` | sonnet | high | wt | P3-CLIENTS merged | `apps/worker/**`, `packages/ingestion/**` (incl. `migrations/**` for `ingest.*`), `apps/web/app/(app)/settings/sync/**`, `docs/architecture/ingestion.md`. Registry loader reads `*.sync.ts`, `*.job.ts`, `*.command.ts` |
| P3-SMOKE | `p3-smoke.md` | haiku | low | main | P3-* merged, R5/R6, D30 | `docs/reports/P3-SMOKE.md` only → **G3** |

P3-CLIENTS ∥ P3-DS; then P3-IDENTITY ∥ P3-INGEST. Each code task goes through P5 before merge.

### P4 — Feature slices

One task per slice in `docs/BACKLOG.md`: slices S01…S15, task ID `P4-S01`…, prompt `p4-slice.md`
with parameter `SLICE_ID`, model sonnet, checkout wt. OWNED_PATHS (the slice's `owned` block is
authoritative), depends_on, wave and size come from the BACKLOG entry. Effort `high` for slices that
write to Amazon (S02, S03, S04, S05, S07, S09, S10, S11), `medium` otherwise.

| Wave | Slices (≤ 3 writers) |
| --- | --- |
| 1a (L0) | S01 ∥ S02 |
| 1b (L0) | S03 — closes slice L0 |
| 2 | S04 · S05 · S06 |
| 3 | S07 · S08 · S09 |
| 4 | S10 · S11 · S12 |
| 5 | S13 · S14 · S15 |

A wave starts when the previous wave is merged **and the orchestrator has made the wave-prep commit**
(BACKLOG §1.5: shared files, new dependencies). P5-QA runs for every slice (all have UI). Slices that
write to Amazon are proven on the mock / replay client until D30 is decided. G4 = all five waves merged.

### P5 — Review and QA (for every wt task before merge)

| ID | Prompt | Model | Effort | Checkout | Output |
| --- | --- | --- | --- | --- | --- |
| P5-REVIEW-<task> | `p5-review.md` | opus | high | main (read-only; reads `git diff main...<branch>`) | `docs/reports/<task>-review.md` |
| P5-QA-<task> | `p5-qa.md` | haiku | medium | wt, `source_branch: <task branch>` | `docs/reports/<task>-qa.md` |

QA only for tasks with UI or with an end-to-end acceptance criterion. Review findings go back to
the task's own session (SendMessage), not to a new session. Re-review after fixes.

### P6 — Hardening and release

| ID | Prompt | Model | Effort | Checkout | Depends | Output |
| --- | --- | --- | --- | --- | --- | --- |
| P6-SEC | `p6-security.md` | opus | high | main | MVP waves merged | `docs/security/**`, new BACKLOG items |
| P6-DEPLOY | `p6-deploy.md` | sonnet | medium | wt | G4, P6-SEC fixes merged | `deploy/**`, `docs/onboarding/**` |
