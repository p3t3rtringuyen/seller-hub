# BACKLOG — slices, waves and file ownership (P2-BACKLOG, input to Gate 2)

Status: DRAFT for Gate 2 (user approves ADRs + this file with `duyệt`). Owner: orchestrator after approval.
Sources: `docs/SCOPE.md` (23 rows ticked `[x]`), `docs/adr/ADR-0001…0014`, `docs/architecture/{overview,conventions}.md`,
`docs/data-model/README.md` §6, `db/design/*.sql`, `docs/PLAN.md`, `docs/reports/{P2-ARCH,P2-DATA}.md`.

Decisions that bind this file: D10 (MVP = 23 rows, wave 1 = slice L0), D11 (no PII), D53 (Ads API v1; named v0
exceptions), D54 (Vitest + Storybook + Playwright), D55 (5 fixed roles), D57 a (v1 reports only), D60 (Vendor is v1 —
no slice may block it), D62 a (mirror + refresh after write), D63 a (rules default preview+approve), D65 (Vendor Central
read-only), D30 **OPEN** (slices that write to Amazon run `high` effort; their acceptance runs against mock / replay /
sandbox / Ads test account only, never a real seller account).

Contents: 0 Summary · 1 Shared-file protocol · 2 Common acceptance criteria · 3 Slices · 4 Waves · 5 Overlap check ·
6 Coverage of the 23 MVP rows · 7 Open items.

---

## 0. Summary

15 slices (S01…S15) in 5 waves, ≤ 3 writer sessions per wave. **Wave 1 = L0**, built on top of the P3 foundation:

```
P3 (SCAFFOLD → CLIENTS ∥ DS → IDENTITY ∥ INGEST)   delivers PLT-01, PLT-03, PLT-04, PLT-05 and the connect half of PLT-02
Wave 1a  S01 campaign-manager (ADS-01/02/03)  ∥  S02 commands + audit (PLT-07, PLT-06)
Wave 1b  S03 bid-rule (AUT-01)                      ← needs S01 facts + S02 command executor
Wave 2   S04 ads-bulk · S05 campaign-detail · S06 listings-sync
Wave 3   S07 ad-group-detail · S08 inventory · S09 portfolios
Wave 4   S10 search-terms · S11 campaign-create · S12 orders
Wave 5   S13 listing-screen · S14 sales-overview · S15 finance
```

Wave 1 has two steps (1a, 1b) because AUT-01 consumes the merged output of S01 and S02: "a wave starts when the
previous wave is merged" (PLAN P4) applies between waves, and 1b starts when 1a is merged. L0 is complete — and the
end-to-end L0 demo passes — when S03 is merged (S03 owns the L0 Playwright journey, `e2e/l0/**`).

Waves 2–5 are ordered ads-first (the product's core, and R6 Ads approval is likely first); the orchestrator may swap
the SP-API slices (S06, S08, S12, S14, S15) earlier if R5 is approved first. Dependencies in each entry are what
constrains the order, not the wave number.

---

## 1. Shared-file protocol

Goal: a slice is **added**, never **merged into** shared files. A slice creates files in directories it owns; shared
indexes are generated at build time by `tools/registry` (ADR-0001) from file-name conventions into gitignored
`*.generated.ts` files. P3-SCAFFOLD implements the generator and the conventions below (`docs/architecture/dev-setup.md`
documents them). Anything not in §1.3 is owned by exactly one slice or one P3 task.

### 1.1 Slice key, module and ownership vocabulary

- **module `m`** — a workspace package under `modules/<m>` (ADR-0001). Several slices may add code to one module
  (e.g. `ads` gets seven slices). **Module owner** = the slice that creates the module skeleton (table 1.4).
- **key `k`** — a short kebab-case name unique per slice (`campaign-manager`, `bulk`, …). It is the directory name and
  file-name infix by which a slice owns files **inside a shared module**. Keys are listed in each slice entry.
- A slice owns a path if it matches its OWNED_PATHS in §3. No path may match two slices of the same wave (§5).

### 1.2 What a slice adds (conventions the generator reads)

| Thing | The slice adds this file / directory (and nothing shared) | Discovered by → generated into |
|---|---|---|
| **API routes** | `modules/<m>/src/routes/<k>/*.route.ts` (Fastify plugin binding contract `operationId`s to handlers), `modules/<m>/src/{handlers,service,repository}/<k>/**` | glob → `apps/api/src/registry.generated.ts` |
| **OpenAPI contract** | `contracts/modules/<m>/<k>.yaml` — one file per slice-in-module (**refines ADR-0010**: "one file per module" becomes "one file per slice"; the key of a module's only slice may equal the module name, e.g. `contracts/modules/automation/automation.yaml`). Operation ids `<m>.<verb><Noun>`; new component names are prefixed `<Module><KeyPascal>` (e.g. `AdsBulkRequest`); only `$ref` to components of slices listed in `depends_on` | glob `contracts/modules/**/*.yaml` → `packages/contracts/dist/openapi.json` (Redocly `join`) |
| **Permissions** | `modules/<m>/src/permissions/<k>.permissions.ts` exporting `{ permission, roles[] }[]` (e.g. `ads.write` → Owner, Admin, Manager). A contract `x-permission` that no file declares fails the build | glob → permission matrix used by the API guard and `/v1/me` |
| **Worker jobs** (non-sync consumers: command executor, outbox relay, rule evaluator) | `modules/<m>/src/jobs/<k>/*.job.ts` exporting queue name `<m>.<job>`, processor, optional schedule (**extension of ADR-0008**; P3-INGEST's registry loader must read it) | glob → `apps/worker/src/registry.generated.ts` |
| **Sync definitions** (worker) | `modules/<m>/src/sync/<k>/*.sync.ts` (ADR-0008 `SyncDefinition`) + parsers in the same directory | glob → `apps/worker/src/registry.generated.ts`; build fails on duplicate definition key |
| **Command handlers** (Amazon writes) | `modules/<m>/src/commands/<k>/*.command.ts` exporting `kind` (`ads.target.update-bid`), payload JSON Schema, permission, `batchMax`, `apply()` / `reconcile()` (ADR-0011). **One generic endpoint** `POST /v1/seller-accounts/{id}/commands` (owned by S02) takes `{kind, payload}`; per-kind payload validation uses the handler's schema; the payload component is also declared in the slice's contract (`x-command-kind`) so the typed client knows it | glob → worker + API registries |
| **Migrations** | `modules/<m>/migrations/<UTC yyyymmddhhmmss>_<m>_<k>_<desc>.sql`, forward-only (ADR-0009). Timestamp = creation time and ≥ the newest on `main`. The file name always contains `_<m>_<k>_`, so no two slices can collide. **A migration may reference only tables from slices in `depends_on` or P3**, never a table created in the same wave. Merged migrations are never edited (new migration instead) | glob → ordered index `db/migrations/index.generated.json` |
| **Seeds** (dev/e2e data) | `modules/<m>/seed/<k>.seed.ts` (synthetic, no real data) | glob → `pnpm db:seed` |
| **Module public entry** | `modules/<m>/src/public/<k>.ts` (what other modules may import: service factories, types) | glob → `src/public.generated.ts`; `src/index.ts` is the fixed line `export * from "./public.generated"` created by the module owner |
| **Web pages** | `apps/web/app/(app)/<route>/…` — file-based routing; **each directory is owned by exactly one slice** (§3 lists them). Components, hooks and stories: `apps/web/features/<m>/<k>/**` | Next.js file routing, no index |
| **Menu entries** | `apps/web/features/<m>/<k>/<k>.nav.ts` exporting `{ id, labelKey, href, section, order, permission }` | glob → `nav.generated.ts` read by the shell (P3-DS) |
| **UI extension points ("slots")** | A page that other slices extend declares named slots in its slice doc (`docs/modules/<SID>.md`); an extending slice adds `apps/web/features/<m>/<k>/*.slot.tsx` exporting `{ slot: "ads.campaigns.bulk-actions", component, order }`. Slots declared in this backlog: `ads.campaigns.bulk-actions`, `ads.campaigns.name-link`, `ads.campaigns.row-actions`, `ads.ad-groups.name-link`, `ads.campaign-detail.tabs`, `ads.ad-group-detail.tabs`, `ads.campaigns.toolbar`, `ads.product-ads.columns` (all declared by S01 except `ads.campaign-detail.tabs` / `ads.ad-group-detail.tabs`, declared by S05 and S07; registered by S02..S11 as listed in their entries) | glob → `slots.generated.ts` |
| **Copy / messages** | `apps/web/messages/<locale>/<m>.<k>.json` (**refines conventions §9**: key suffix added because one module has several slices); loader merges `*.json` into namespace `<m>.<k>` | glob |
| **Metric definitions** | `packages/metrics/src/<domain>/*.metric.ts` (`ads`, `sales`, …); a domain directory is owned by the slice that defines it | glob → `packages/metrics/src/index.generated.ts` |
| **Test fixtures** (Amazon replay / mock) | `packages/testing/fixtures/<api>/<operation>/<k>--<case>.json\|.gz` (prefix = key) | glob |
| **Tests** | unit/integration next to code (`*.test.ts`); Storybook stories next to components (`*.stories.tsx`); Playwright specs in `e2e/<k>/**` | globs in the shared configs |
| **Docs** | `docs/modules/<SID>.md` (what it does, data flow, schedule, limits, final QA list) and `docs/reports/P4-<SID>.md` | — |

### 1.3 Shared files that remain (single owner, change by request)

A P4 slice **never edits** these. If it needs a change it stops with `BLOCKED` and gives the exact change
(`prompts/p4-slice.md` "Stop and ask"). The owner applies it in a *wave-prep commit* on `main` before the next wave
starts (or immediately for a blocking defect), so no two worktrees ever edit the same line.

| File / area | Owner during P3 | Owner afterwards |
|---|---|---|
| Root `package.json`, `pnpm-workspace.yaml` (+ `catalog:` versions), `turbo.json`, `tsconfig*`, ESLint/Prettier/boundaries config, `.github/**`, `docker-compose*.yml` | P3-SCAFFOLD | orchestrator |
| `pnpm-lock.yaml` | P3-SCAFFOLD | orchestrator — never hand-merged: on a conflict re-run `pnpm install` and commit the result. Slices list new third-party dependencies in their report and in §3 "New deps" |
| `modules/<m>/package.json` of a module with more than one slice | module owner | orchestrator (wave-prep adds the dependencies listed in each slice's "New deps", so concurrent slices never touch it); a module with one slice owner edits its own file |
| `.env.example` | P3-SCAFFOLD | orchestrator (slices name new env vars in the report; tunables go in typed `config` objects with defaults and need none) |
| `contracts/shared/*.yaml`, `contracts/redocly.yaml`, `tools/contracts/**`, `tools/registry/**` | P3-SCAFFOLD | orchestrator |
| `packages/config`, `packages/core`, `packages/db`, `packages/contracts` (generated parts excluded) | P3-SCAFFOLD | orchestrator |
| `packages/amazon-core`, `packages/amazon-sp`, `packages/amazon-ads` (incl. v0 exception adapters `src/v0/<ex-id>/`, ADR-0006) | P3-CLIENTS | orchestrator; a new operation or adapter a slice needs → `BLOCKED` with request (listed per slice under "Needs from packages") |
| `packages/ui`, `apps/web/app/(shell)/**`, `apps/web/app/layout.tsx`, `apps/web/app/(app)/layout.tsx`, `.storybook/**`, Playwright config | P3-DS (config: P3-SCAFFOLD) | orchestrator |
| `packages/ingestion`, `apps/worker/src/main.ts` and runner code, `apps/worker/**` except generated registry | P3-INGEST | orchestrator |
| `apps/api/src/main.ts`, plugins (auth, error mapper, guard) | P3-SCAFFOLD / P3-IDENTITY | orchestrator |
| `packages/testing/**` except `fixtures/**/<k>--*` | P3-SCAFFOLD | orchestrator |
| `db/design/*.sql` | P2-DATA (frozen reference) | orchestrator — a design correction is a request, not an edit; implemented as a new migration by the slice that owns the table |
| `docs/PLAN.md`, `docs/DECISIONS.md`, `docs/STATUS.md`, `docs/BACKLOG.md`, `docs/adr/**`, `docs/architecture/**`, `CLAUDE.md` | orchestrator | orchestrator |

### 1.4 Module skeletons (module owner = slice that creates it)

Skeleton = `modules/<m>/{package.json,tsconfig.json,README.md,src/index.ts}` (generated by `pnpm new:module <m>` from
P3-SCAFFOLD). Other slices of the same module depend on the owner.

| Module | Owner | Other slices adding to it |
|---|---|---|
| `platform-auth`, `platform-tenancy`, `platform-connections` | P3-IDENTITY | S06 (key `sp-participations` in `platform-connections`) |
| `platform-audit` (skeleton, `ops.audit_log` migration and `AuditWriter` — P3-IDENTITY must write sign-in/membership/connection events, so the table cannot wait for S02) | P3-IDENTITY | S02 (key `history`: `ops.change_history`, History screen, change-history sync) |
| `ads` | S01 | S03 (key `target-bid`), S04, S05, S07, S09, S10, S11 |
| `platform-commands` | S02 | — |
| `automation` | S03 | — |
| `listings` | S06 | S13 |
| `inventory` | S08 | — |
| `orders` | S12 | S14 |
| `finance` | S15 | — |

### 1.5 Merge procedure (orchestrator)

1. **Wave prep** (before a wave starts, on `main`): apply the "New deps" of the wave's slices to the modules' and root
   `package.json`, regenerate the lockfile, apply accepted `BLOCKED` requests for shared packages, bump nothing else.
2. Slices start from that commit in their own worktrees (≤ 3 writers).
3. Each slice passes its gate command, then P5-REVIEW and P5-QA (UI slices), then merges **one at a time**; after each
   merge run `pnpm gen && <gate command>` on `main`. Because paths are disjoint, merges are fast-forward-able; the only
   expected conflict is `pnpm-lock.yaml` → regenerate.
4. The wave is closed when all slices are merged and the gate is green on `main`; then wave prep for the next wave.

---

## 2. Common acceptance criteria (apply to every slice; entries add slice-specific ones)

- **C1 Gate.** The gate command from `CLAUDE.md` "Commands" (lint, typecheck, test, build) is green; `git diff main...HEAD --stat`
  shows nothing outside OWNED_PATHS.
- **C2 Unit tests (Vitest).** Every business rule in a service has a test; money/ratios per conventions §5 (decimal
  strings, no float); dates per §6 (marketplace-local dates).
- **C3 Tenant isolation (D54, CLAUDE.md).** Every repository has a test, against real Postgres 16 with RLS on, proving
  tenant B cannot read or write tenant A's rows and that a call without `Scope` fails (type and runtime). Every new route
  has an API test: other tenant's id → **404**, insufficient role → **403**, no session → **401**.
- **C4 Contract.** All routes exist in the slice's contract file with `x-permission`, `x-scope`, `4XX` problem responses;
  Redocly lint clean; responses validated against the bundle in API tests; real HTTP status codes (never 200 with error).
- **C5 UI (D54).** Every new component/widget has a Storybook story with an interaction test covering loading, empty,
  error and (where it applies) partial states; one Playwright spec per flow in `e2e/<k>/` on the compose stack with the
  Amazon mock server; copy only from message catalogues; business dates from the server.
- **C6 Failure behaviour.** Throttling (429) → retried by the client layer, the UI keeps showing the last good data with
  its `freshness` timestamp; partial failure → per-item warnings/errors, never shown as success (UX-13); empty data → an
  empty state with the next action, not an error; Amazon 5xx → problem+json 502/503 with `traceId`.
- **C7 No PII, no secrets.** No buyer data anywhere (D11); no token, cookie or auth header in logs, errors or fixtures.
- **C8 Writes (only slices that write to Amazon).** Go through `platform-commands` (dry-run + confirmation for bulk or
  destructive, `Idempotency-Key`, outbox, 207 mapping by `index`, retry only failed retryable items, reconcile after
  timeout), write `ops.audit_log` and `ops.change_history`, refresh the touched entities (D62 a). **Acceptance is proven
  with the mock/replay client and, once D30 is decided, Ads test account / SP-API sandbox — never a real seller account.**
- **C9 Docs & report.** `docs/modules/<SID>.md` and `docs/reports/P4-<SID>.md` exist; the report names the test that proves
  each acceptance criterion.

Slice entries refer to these as C1–C9 and list only what is specific.

---

## 3. Slices

Notation: `OWNED_PATHS` blocks are machine-checked (§5): one glob per line, `{a,b}` brace shorthand allowed. Every slice
also owns `docs/modules/<SID>.md` and `docs/reports/P4-<SID>.md`, `packages/testing/fixtures/**/<k>--*` for each of its
keys, and `e2e/<k>/**` — these are included in the blocks. "Needs from packages" = requests to shared-package owners that
the orchestrator must satisfy in wave prep (§1.3). Sizes/efforts follow `prompts/p2-backlog.md`.

### P3 deliveries that the L0 rows rely on (not slices)

| SCOPE row | Delivered by | What exactly | Gap left for P4 |
|---|---|---|---|
| PLT-01 | **P3-IDENTITY** (+ P3-DS shell) | tenants, users, BFF session, 5 fixed roles per seller account (D55), invitations, `/v1/me` with permissions, audit of sign-in/membership | none |
| PLT-03 | **P3-IDENTITY** | Ads LWA auth-code flow, encrypted refresh token, profile listing (EX-PROFILES / `QueryAdvertiserAccount`), choose profile, empty-profile state, `settings/connections` | none |
| PLT-04 | **P3-IDENTITY** (+ P3-SCAFFOLD seeds `ref.*`, P3-DS shell switcher) | seller-account / marketplace context, `ref.marketplaces` + `ref.ads_limits` as data, time zone / currency per marketplace, limits read endpoint | none |
| PLT-05 | **P3-INGEST** | sync engine: scheduler, token buckets, report runner, cursors, job runs, raw landing, sync-health API and `settings/sync` screen | none |
| PLT-02 (connect half) | **P3-IDENTITY** | SP-API self-authorization refresh token entered once, validated with `getMarketplaceParticipations` | participation sync + marketplace linking → **S06** |

### S01 — Campaign Manager read model (L0)

- **Goal:** mirror a seller's Sponsored Products structure and daily performance from Amazon into the DB and show it in a
  read-only Campaign Manager.
- **SCOPE IDs:** ADS-01, ADS-02, ADS-03 · **module:** `ads` (owner) · **key:** `campaign-manager`
- **wave:** 1a · **depends_on:** P3 (all) · **size:** L · **effort:** medium (read-only; no Amazon writes)

```owned
modules/ads/{package.json,tsconfig.json,README.md}
modules/ads/src/index.ts
modules/ads/src/{routes,handlers,service,repository,sync}/campaign-manager/**
modules/ads/src/permissions/campaign-manager.permissions.ts
modules/ads/src/public/campaign-manager.ts
modules/ads/migrations/*_ads_campaign-manager_*.sql
modules/ads/seed/campaign-manager.seed.ts
modules/ads/test/campaign-manager/**
contracts/modules/ads/campaign-manager.yaml
apps/web/app/(app)/ads/layout.tsx
apps/web/app/(app)/ads/campaigns/{page,loading,error,not-found}.tsx
apps/web/features/ads/campaign-manager/**
apps/web/messages/*/ads.campaign-manager.json
packages/metrics/src/ads/**
packages/testing/fixtures/**/campaign-manager--*
e2e/campaign-manager/**
docs/modules/S01.md
docs/reports/P4-S01.md
```

- **Amazon APIs:** Ads v1 `SPQueryCampaign`, `SPQueryAdGroup`, `SPQueryAd`, `SPQueryTarget` (`nextToken` paging);
  EX-EXPORTS (`CampaignExport…GetExport`, 1–2×/day full snapshot); v1 reports `AdsApiv1CreateReport` /
  `AdsApiv1RetrieveReport` with the field set in `catalog/ads/reports.json` (D57 a: **no** Reporting v3); limits from
  `refs/amazon-ads/docs/reference/concepts/limits.md` via `ref.ads_limits`. Cite `catalog/ads/operations.json`
  (`batchMax`, `generation`).
- **Tables / migrations** (from `db/design/05_ads.sql`, `06_facts_ads.sql`): `ads.portfolios`, `ads.sp_campaigns`,
  `ads.sp_campaign_placement_adjustments`, `ads.sp_ad_groups`, `ads.sp_ads`, `ads.sp_targets`, `facts.ads_sp_campaign_daily`,
  `facts.ads_sp_ad_group_daily`, `facts.ads_sp_target_daily`, `facts.ads_sp_ad_daily` (+ partitions via
  `core.ensure_monthly_partitions`). Other facts (search term, placement) are created by S10 / S05.
- **Sync definitions:** `ads.sp-structure` (v1 query, paged, incremental by `lastUpdatedDateTime` where the model has it),
  `ads.sp-export` (daily snapshot reconcile), `ads.sp-report-daily` (campaign / ad group / target / ad levels, newest-first
  backfill, overlap window to absorb Amazon's attribution restatements).
- **API** (`/v1/seller-accounts/{sellerAccountId}` prefix; permission `ads.read` = Viewer+):
  `GET /ads/campaigns`, `GET /ads/ad-groups`, `GET /ads/product-ads`, `GET /ads/targets` (grid shape: `page,pageSize,sort,q,
  state,preset,filter[metric][op],from,to,compareFrom,compareTo` → `items,total,totals,freshness`),
  `GET /ads/kpis` (KPI cards + daily series with compare), `GET /ads/export` (`level=` → CSV of the filtered set, streamed).
- **Screens:** `/ads/campaigns` — Campaign Manager: tabs Campaigns / Ad groups / Product ads / Targets (URL state `?tab=`),
  KPI cards + chart, date presets + compare, filters, search, quick chips (out of budget, impressions without clicks),
  column chooser / pin / hide (stored via `/v1/me` preferences), Total row over the whole filtered set, CSV export. **Read-only**:
  declares slots `ads.campaigns.bulk-actions`, `ads.campaigns.name-link`, `ads.campaigns.row-actions`,
  `ads.campaigns.toolbar`, `ads.ad-groups.name-link`, `ads.product-ads.columns`; with nothing registered the names render as plain text.
  All four grids accept `campaignId` / `adGroupId` filters (used by S05, S07). Public entry `src/public/campaign-manager.ts`
  exports `adsStatusBySku()` (used by S13) and `adSpendByDay()` (used by S14).
  Menu entry `Ads → Campaigns` via `campaign-manager.nav.ts`. Metric definitions (Spend, Sales, Orders, Units, Clicks,
  Impressions, CTR, CPC, ACOS, ROAS, CVR, CPM, CPO, AOV, TOS IS) in `packages/metrics/src/ads`.
- **Needs from packages:** v1 `SPQuery*`, EX-EXPORTS and report operations in `packages/amazon-ads` with replay fixtures
  (P3-CLIENTS); a column-preference endpoint under `/v1/me` (P3-IDENTITY); the registry generator (P3-SCAFFOLD).
- **New deps:** none expected (grid, charts come from `packages/ui`).
- **Acceptance (beyond C1–C9):**
  - A1 Sync from replay fixtures converges: running `ads.sp-structure` twice yields identical rows; Amazon-side deletes
    (missing in the snapshot) mark rows `archived`, not removed.
  - A2 A 429 or 5xx from Amazon mid-pagination resumes from the saved `nextToken`; no duplicate rows, no lost page.
  - A3 Daily report job: a day is written to facts only when the report for that marketplace-local day is complete; the
    last 7 days are re-pulled (restatement overlap) and rows are upserted by natural key.
  - A4 Ratios (ACOS, ROAS, CTR, CVR, CPC) are computed from summed numerators/denominators and are `null` when the
    denominator is 0; the Total row equals the sum over the **whole** filtered set (test with more than one page).
  - A5 Report columns Amazon does not return (D57 unknown coverage) are `null` in the DB and **hidden** in the UI; no zeros.
  - A6 Grid performance: 50k campaigns × 30 days: `GET /ads/campaigns` p95 < 1 s on the compose Postgres (EXPLAIN checked,
    indexes from `docs/data-model/README.md` §7).
  - A7 Empty seller account (connected, no campaigns) shows the empty state with a "sync now" action; an account whose
    profile is not linked shows a "connect" pointer, not an error.
  - A8 Compare range: previous-period deltas are computed server-side in the marketplace time zone.
- **QA checklist:** (1) sign in as Viewer, open Ads → Campaigns on the seeded account: 4 tabs load, Total row visible.
  (2) change date preset and enable compare → numbers and chart change, URL carries the state, reload keeps it. (3) filter
  `ACOS > 30` and `clicks ≥ 10`, search by name, click a quick chip → row counts change, Total row recomputes.
  (4) hide / pin columns, reload → persisted. (5) export CSV → row count equals the filtered total. (6) as a user of another
  tenant call the first tenant's seller-account id → 404. (7) stop the Amazon mock (or force 429) → page still shows data
  with an old "updated at". (8) account with zero campaigns → empty state. Measure: grid p95, number of Amazon calls per
  sync vs rate limits in `catalog/ads/operations.json`.

### S02 — Safe write layer + audit/History (L0)

- **Goal:** one command pipeline for every write to Amazon (validate → preview → approve → outbox → execute with 207
  mapping → reconcile → audit) and a History screen over the audit log and change history.
- **SCOPE IDs:** PLT-07, PLT-06 · **modules:** `platform-commands` (owner), `platform-audit` (key `history`; skeleton and
  `ops.audit_log` come from P3-IDENTITY) · **keys:** `commands`, `history`
- **wave:** 1a · **depends_on:** P3 (all) · **size:** L · **effort:** high (it is the code that writes to Amazon)

```owned
modules/platform-commands/{package.json,tsconfig.json,README.md}
modules/platform-commands/src/index.ts
modules/platform-commands/src/{routes,handlers,service,repository,jobs,commands,executor}/**
modules/platform-commands/src/permissions/commands.permissions.ts
modules/platform-commands/src/public/commands.ts
modules/platform-commands/migrations/*_platform-commands_commands_*.sql
modules/platform-commands/seed/commands.seed.ts
modules/platform-commands/test/**
modules/platform-audit/src/{routes,handlers,service,repository,sync}/history/**
modules/platform-audit/src/permissions/history.permissions.ts
modules/platform-audit/src/public/history.ts
modules/platform-audit/migrations/*_platform-audit_history_*.sql
modules/platform-audit/test/history/**
contracts/modules/platform-commands/commands.yaml
contracts/modules/platform-audit/history.yaml
apps/web/app/(app)/history/**
apps/web/features/platform-commands/**
apps/web/features/platform-audit/history/**
apps/web/messages/*/platform-commands.commands.json
apps/web/messages/*/platform-audit.history.json
packages/testing/fixtures/**/commands--*
packages/testing/fixtures/**/history--*
e2e/commands/**
e2e/history/**
docs/modules/S02.md
docs/reports/P4-S02.md
```

- **Amazon APIs:** write semantics are generic: Ads v1 `SPUpdate*`/`SPCreate*` return **207** per item (`multiStatus207`,
  `batchMax` in `catalog/ads/operations.json`); v0 `Prefer: return=representation`. EX-CHANGE-HISTORY `getHistory`
  (SP, `catalog/ads/operations.json`) for changes made outside the app. A test-only handler kind
  (`platform.test-echo`, registered only when `NODE_ENV=test`) proves the pipeline without any real Amazon operation.
- **Tables / migrations** (`db/design/07_ops.sql`): `ops.commands`, `ops.command_items`, `ops.outbox`, `ops.change_history`.
  Uses `ops.audit_log` created by P3-IDENTITY.
- **Jobs:** `platform-commands.outbox-relay`, `platform-commands.execute` (queue `amazon-write`, per-seller concurrency 1
  per operation family), `platform-audit.change-history-sync` (sync definition, EX-CHANGE-HISTORY, per profile).
- **API** (permission by kind = the handler's declared permission; feeds need `audit.read` = Analyst+):
  `POST /commands` (`{kind,payload}`, `Idempotency-Key` required, `?dryRun=true` → preview + `confirmationToken`,
  428 without a valid token for destructive / bulk > 20 / budget change > 50 %, 202 otherwise), `GET /commands` (cursor feed),
  `GET /commands/{commandId}` (per-item results), `POST /commands/{commandId}/approve`, `POST /commands/{commandId}/cancel`,
  `GET /history` (cursor feed over `ops.change_history`; filters entity type, source `user|rule|assistant|amazon`, date,
  user), `GET /audit-log` (cursor feed, Analyst+).
- **Screens:** `/history` — tabs "Changes" (change history, before → after) and "Audit log". UI building blocks for other
  slices, exported from `apps/web/features/platform-commands/public.ts`: `useSubmitCommand` (dry-run → confirm → submit),
  `CommandResultDrawer` (per-item success / warning / error, retry-failed), `ConfirmCommandDialog`. Menu entry `History`.
  Web rule: a feature may import another feature only through its `public.ts` (lint).
- **Needs from packages:** `getHistory` v0 adapter in `packages/amazon-ads/src/v0/ex-change-history` (P3-CLIENTS); worker
  registry support for `*.job.ts` (P3-INGEST); `AuditWriter` and the `platform-audit` skeleton (P3-IDENTITY).
- **New deps:** none expected.
- **Acceptance (beyond C1–C9):**
  - A1 One transaction creates command + items + outbox row; a crash between commit and enqueue is recovered by the relay
    (at-least-once) and the executor is idempotent by command id + item status (double delivery writes once).
  - A2 207 mapping: a batch of 25 items where Amazon rejects items 3 and 17 → those items `failed` with the Amazon error
    code in `meta.amazon` (sanitised), the rest `succeeded`, command `partially_succeeded`; the HTTP read is 200.
  - A3 Retry applies only to retryable failed items (throttling, transient) with backoff; non-retryable are final; a
    write is never resent blindly after a timeout — the executor re-reads and compares with `desired` (reconcile).
  - A4 Chunking honours the operation's `batchMax`; replace-semantics operations build the full record from a fresh read plus
    the patch.
  - A5 Dry-run returns a preview without side effects; a real call without a matching token → **428**; same
    `Idempotency-Key` with another payload → **409**; same key and payload → same command (no duplicate).
  - A6 After a command the touched entities are refreshed (D62 a) and `after` is written to `change_history`; every
    command / approval / cancel produces an `audit_log` row (who, what, when, trace id) with no secrets or PII.
  - A7 Role checks: Analyst/Viewer get 403 on `POST /commands`; Manager can create; the audit log is append-only
    (DELETE denied for `sh_app`).
  - A8 `change-history-sync` records `source = 'amazon'` rows for changes made in the Amazon console and de-duplicates
    against rows the app itself caused.
  - A9 Mock-only: no test or fixture contains a real credential or profile id (D30 OPEN).
- **QA checklist:** (1) with the test-echo kind (dev build flag) submit a 25-item command with 2 forced failures → drawer
  shows 23 ok / 2 errors with reasons, status "partially succeeded" (never green). (2) retry-failed re-runs only the 2.
  (3) submit a destructive command → confirmation dialog, then success; call the API without the token → 428 in the network
  tab. (4) double-click submit → one command. (5) History → Changes shows before → after and the actor; filter by source
  and date. (6) Viewer opens the Audit tab → 403 page. (7) other tenant's command id → 404. Measure: executor throughput vs
  `batchMax`; outbox lag after killing the worker mid-command.

### S03 — Bid rule with preview / approve (L0, closes wave 1)

- **Goal:** a seller defines one bid rule ("if ACOS > X % over N days with ≥ M clicks, lower the target's bid by Y %, floor
  Z"), previews its effect, approves it, and every change is audited and undoable.
- **SCOPE IDs:** AUT-01 · **modules:** `automation` (owner); `ads` (key `target-bid`: the first ads command handler) ·
  **keys:** `bid-rule`, `target-bid`
- **wave:** 1b · **depends_on:** S01, S02 · **size:** L · **effort:** high (writes bids to Amazon) · owns the **L0 end-to-end
  journey** `e2e/l0/**` (login → connect → sync → Campaign Manager → rule → preview → approve → History).

```owned
modules/automation/{package.json,tsconfig.json,README.md}
modules/automation/src/index.ts
modules/automation/src/{routes,handlers,service,repository,jobs,rules}/**
modules/automation/src/permissions/bid-rule.permissions.ts
modules/automation/src/public/bid-rule.ts
modules/automation/migrations/*_automation_bid-rule_*.sql
modules/automation/seed/bid-rule.seed.ts
modules/automation/test/**
modules/ads/src/commands/target-bid/**
modules/ads/src/permissions/target-bid.permissions.ts
modules/ads/src/public/target-bid.ts
modules/ads/test/target-bid/**
contracts/modules/automation/automation.yaml
contracts/modules/ads/target-bid.yaml
apps/web/app/(app)/automation/**
apps/web/features/automation/**
apps/web/messages/*/automation.bid-rule.json
apps/web/messages/*/ads.target-bid.json
packages/testing/fixtures/**/bid-rule--*
packages/testing/fixtures/**/target-bid--*
e2e/bid-rule/**
e2e/l0/**
docs/modules/S03.md
docs/reports/P4-S03.md
```

- **Amazon APIs:** reads only our facts (S01) and `ref.ads_limits`; writes v1 `SPUpdateTarget` (bid) through the command
  handler `ads.target.update-bid` (`catalog/ads/operations.json`: `batchMax`, 207). The handler kind is reused by S04.
- **Tables / migrations** (`07_ops.sql`): `ops.automation_settings`, `ops.rules`, `ops.rule_runs`.
- **Jobs:** `automation.evaluate` (schedule per rule; deterministic job id `automation.evaluate:{sellerAccountId}:{ruleId}:{localDate}`),
  `automation.expire-proposals`.
- **API** (`automation.manage` = Manager+; settings need `automation.settings` = Owner/Admin):
  `GET/POST /automation/rules`, `GET/PATCH/DELETE /automation/rules/{ruleId}`, `POST /automation/rules/{ruleId}/preview`
  (dry-run: affected targets with before → after, skipped with reason), `POST /automation/rules/{ruleId}/run`,
  `GET /automation/rules/{ruleId}/runs`, `GET /automation/runs/{runId}`, `POST /automation/runs/{runId}/undo`,
  `GET/PUT /automation/settings` (caps, floors / ceilings, max change %/day, kill switch, `auto_run_allowed`).
  Proposals are commands in state `pending_approval`, approved through S02's `POST /commands/{commandId}/approve`.
- **Screens:** `/automation/rules` (list, create / edit form with `MoneyField` / `PercentField`, enable switch),
  `/automation/rules/[ruleId]` (preview table, run history, undo), `/automation/settings` (caps + kill switch, Owner/Admin).
  Menu entry `Automation`.
- **Needs from packages:** `TargetsPort.update` in `packages/amazon-ads` (P3-CLIENTS).
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 The condition is evaluated from `facts` only, over **complete** marketplace-local days; a window with missing
    facts yields run status `skipped_no_data` (not an error, no proposals).
  - A2 New rules default to `preview_approve`; a rule can be `auto_within_caps` only if Owner/Admin has set caps and
    `auto_run_allowed` (the DB CHECK from `07_ops.sql` and the API both enforce it); a Manager cannot raise caps (403).
  - A3 Every proposed bid respects floor Z, the marketplace bid min/max from `ref.ads_limits`, and "max change % per day"
    across rules and runs; targets changed within the cooldown are skipped with a visible reason.
  - A4 Re-running the same window (same local date) is idempotent: same proposals, no duplicate commands.
  - A5 Preview shows before → after for every target and the reason for each skip; approving executes through S02 and
    the run ends `succeeded | partially_succeeded | failed` with per-target results.
  - A6 Kill switch: setting it cancels pending proposals and blocks auto-runs within one scheduler tick.
  - A7 Undo creates an inverse command from the stored `before` values, is itself previewable and audited, and refuses to
    undo targets whose bid changed since (conflicts listed).
  - A8 `source = 'rule'` on audit and change history; the rule id and run id are visible on the History screen.
  - A9 The L0 journey `e2e/l0/**` passes on the compose stack with the mock LWA + Amazon mock: login → connect Ads account →
    sync → Campaign Manager shows data → create rule → preview → approve → History shows the change.
- **QA checklist:** (1) as Manager create a rule (ACOS > 30 % over 7 d, clicks ≥ 10, −10 %, floor 0.10). (2) Preview →
  table of targets with before / after and skipped reasons. (3) Approve → run page shows per-target results, History has
  rows with source "rule". (4) Undo the run → bids restored, new audit rows. (5) As Manager try to enable auto mode →
  blocked; as Admin set caps then enable auto → next run executes without approval but never beyond caps (check max %/day).
  (6) Flip the kill switch → pending proposals cancelled. (7) Seed account with no facts → run "skipped, no data".
  (8) Other tenant's rule id → 404. Measure: rule evaluation time for 50k targets; commands created per run vs caps.

### S04 — Bulk actions in Campaign Manager

- **Goal:** select many campaigns / ad groups / ads / targets in the Campaign Manager and change state, budget or bid in one
  command with per-row results.
- **SCOPE IDs:** ADS-04 · **module:** `ads` · **key:** `bulk`
- **wave:** 2 · **depends_on:** S01, S02, S03 (reuses `ads.target.update-bid`) · **size:** M · **effort:** high (writes)

```owned
modules/ads/src/{routes,handlers,service,repository,commands}/bulk/**
modules/ads/src/permissions/bulk.permissions.ts
modules/ads/src/public/bulk.ts
modules/ads/test/bulk/**
contracts/modules/ads/bulk.yaml
apps/web/features/ads/bulk/**
apps/web/messages/*/ads.bulk.json
packages/testing/fixtures/**/bulk--*
e2e/bulk/**
docs/modules/S04.md
docs/reports/P4-S04.md
```

- **Amazon APIs:** v1 `SPUpdateCampaign`, `SPUpdateAdGroup`, `SPUpdateAd`, `SPUpdateTarget` (207, `batchMax` per
  `catalog/ads/operations.json`); bid suggestions EX-TARGETING-RECS (v0, interactive lookup, not mirrored).
- **Tables / migrations:** none (uses `ops.commands`; mirror refresh by S02).
- **Command kinds** (`modules/ads/src/commands/bulk/*.command.ts`): `ads.campaign.update-state`, `ads.campaign.adjust-budget`
  (`+$ +% =$ −$ −%`), `ads.ad-group.update-state`, `ads.ad.update-state`, `ads.target.update-state`, `ads.target.adjust-bid`
  (`+% −% =$`, or "apply suggested bid"; writes via S03's `ads.target.update-bid` logic).
- **API** (`ads.write` = Manager+): `POST /ads/bulk/resolve` (selection → items with current value, proposed value, row
  validation against `ref.ads_limits`; max 300 campaigns / 100 child entities), `GET /ads/bid-suggestions?targetIds=`;
  submission uses S02 `POST /commands`.
- **Screens:** no new route; registers `ads.campaigns.bulk-actions` and `ads.campaigns.row-actions` slots in the Campaign
  Manager (bulk bar with count, selection kept across pages and tabs, dialog per action, `CommandResultDrawer`).
- **Needs from packages:** `SPUpdate*` ports and the EX-TARGETING-RECS bid-recommendation adapter in `packages/amazon-ads`.
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 Selection above 300 campaigns / 100 children is rejected with 422 `selection_too_large`; selection "all matching the
    filter" resolves server-side to the same cap.
  - A2 Budget and bid arithmetic uses decimal helpers; results are clamped / rejected per row against the marketplace min/max
    (row error, rest of the batch continues); a −% that rounds to the same value is reported as "no change", not as an error.
  - A3 Illegal transitions (archived → enabled) are rejected per row before sending; archive = delete on Amazon and always
    needs the confirmation token (428 otherwise).
  - A4 A budget change larger than 50 % or a batch larger than 20 items requires confirmation (ADR-0011); smaller ones do not.
  - A5 Partial failure: result drawer lists ok / warning / error rows; "retry failed" resubmits only failed rows; the grid
    refreshes the changed rows afterwards (D62 a).
  - A6 Ids of another tenant or seller account inside a selection yield 404 for the whole request (no partial leak).
  - A7 Suggested-bid lookup failing (429 / 5xx) disables only "apply suggested bid" with a message; other actions still work.
- **QA checklist:** (1) select 3 campaigns on page 1, change page, select 2 more → bar says 5. (2) Pause → drawer, grid
  rows show Paused. (3) Budget `+10 %` on 5 → preview shows old/new per row; one row above max shows an error and is skipped.
  (4) Budget `+60 %` → confirmation required. (5) Select 301 → error. (6) Archive → confirmation dialog, rows disappear.
  (7) Force 2 failures in the mock → drawer "partially succeeded", retry-failed works. (8) Analyst sees no bulk bar (disabled
  with tooltip). Measure: time to resolve 300 rows; number of Amazon calls = ceil(items / batchMax).

### S05 — Campaign detail

- **Goal:** open one Sponsored Products campaign and change its settings, placement bid adjustments and campaign-level
  negatives, with its ad groups, budget rules and history alongside.
- **SCOPE IDs:** ADS-05 · **module:** `ads` · **key:** `campaign-detail`
- **wave:** 2 · **depends_on:** S01, S02 · **size:** L · **effort:** high (writes)

```owned
modules/ads/src/{routes,handlers,service,repository,sync,commands}/campaign-detail/**
modules/ads/src/permissions/campaign-detail.permissions.ts
modules/ads/src/public/campaign-detail.ts
modules/ads/migrations/*_ads_campaign-detail_*.sql
modules/ads/seed/campaign-detail.seed.ts
modules/ads/test/campaign-detail/**
contracts/modules/ads/campaign-detail.yaml
apps/web/app/(app)/ads/campaigns/[campaignId]/**
apps/web/features/ads/campaign-detail/**
apps/web/messages/*/ads.campaign-detail.json
packages/testing/fixtures/**/campaign-detail--*
e2e/campaign-detail/**
docs/modules/S05.md
docs/reports/P4-S05.md
```

- **Amazon APIs:** v1 `SPUpdateCampaign` (`optimizations.bidSettings` strategy and placement adjustments, budget, dates,
  portfolio), `SPCreateTarget` / `SPUpdateTarget` with `negative=true` at campaign level, `SPQueryTarget`; v1 report
  placement rows (field coverage per D57 — hide missing columns); budget rules read via EX-BUDGET-RULES (v0, interactive
  lookup, read-only; the tab is hidden if the adapter is not available). `catalog/ads/operations.json`, `catalog/ads/reports.json`.
- **Tables / migrations:** `facts.ads_sp_placement_daily` (`06_facts_ads.sql`); `ads.sp_campaign_placement_adjustments`
  already exists (S01) and is only written here.
- **Sync definitions:** `ads.sp-report-placement` (daily, same overlap rule as S01 A3).
- **Command kinds:** `ads.campaign.update-settings`, `ads.campaign.set-placement-adjustments` (replace semantics: whole set
  rebuilt from a fresh read + patch), `ads.campaign.add-negative-targets`, `ads.campaign.remove-negative-targets`.
- **API:** `GET /ads/campaigns/{campaignId}` (settings, `ads.read`), `GET /ads/campaigns/{campaignId}/placements`
  (adjustments + placement performance), `GET /ads/campaigns/{campaignId}/negative-targets`,
  `GET /ads/campaigns/{campaignId}/budget-rules`, `POST /ads/campaigns/{campaignId}/refresh` (202, re-reads from Amazon,
  D62 a); writes via `POST /commands` (`ads.write`).
- **Screens:** `/ads/campaigns/[campaignId]` — header with state / budget, tabs Settings, Ad groups (list; names link via
  the `ads.ad-groups.name-link` slot), Placements (TOS / ROS / PP 0–900 % with performance), Negative targeting, Budget
  rules (read-only), History (uses `/history?entityType=campaign&entityId=`), plus a "refresh from Amazon" button.
  Registers `ads.campaigns.name-link` (campaign name → this page). Declares slot `ads.campaign-detail.tabs`.
- **Needs from packages:** `SPUpdateCampaign` port with bid settings, EX-BUDGET-RULES read adapter (optional) in
  `packages/amazon-ads`.
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 Name rules (UX-16), start-date minimum and end-date ceiling are computed server-side in the marketplace time zone
    (UX-17); budget min/max from `ref.ads_limits`; violations come back as 422 `errors[]` with `code` + `meta`.
  - A2 Placement adjustments accept 0–900 % only; saving sends the **full** set (no silent reset of the other placements) —
    test with a fixture where Amazon has non-default values for other placements.
  - A3 Negative targets: duplicates (same text + match type) are rejected before sending; removal needs confirmation.
  - A4 Settings change shows before / after in the confirmation, writes `change_history` per changed field, and the page
    re-reads the campaign after the command (stale mirror never shown as final).
  - A5 Budget rules tab: adapter missing or throttled → tab shows "unavailable" without breaking the page.
  - A6 Placement report columns not returned by Amazon are hidden (D57); a campaign with no performance shows zeros only
    where Amazon returned zero, otherwise "no data".
  - A7 Viewer/Analyst can open the page read-only (controls disabled with reason); Manager+ can edit.
- **QA checklist:** (1) open a campaign from the Campaign Manager link. (2) Change the name to an invalid one → inline
  error; valid → saved, History tab shows before / after. (3) Change daily budget below min → blocked. (4) Set TOS 50 %,
  others unchanged → network shows full set sent; reload shows the same. (5) Add 2 negative keywords (one duplicate) →
  duplicate rejected. (6) Click refresh → "updated just now". (7) Switch to Viewer → fields disabled. (8) Other tenant's
  campaign id → 404 page. Measure: page time-to-first-data; Amazon calls per page view.

### S06 — SP-API link + listings sync

- **Goal:** link the seller's SP-API marketplaces to the same seller account as the Ads profile and keep a listings mirror
  (status, issues, title, image) fresh.
- **SCOPE IDs:** PLT-02 (sync and linking; the connect flow is P3-IDENTITY), CAT-01 · **modules:** `listings` (owner),
  `platform-connections` (key `sp-participations`) · **keys:** `sync`, `sp-participations`
- **wave:** 2 · **depends_on:** P3 (all) · **size:** M · **effort:** medium (read-only)

```owned
modules/listings/{package.json,tsconfig.json,README.md}
modules/listings/src/index.ts
modules/listings/src/{routes,handlers,service,repository,sync}/sync/**
modules/listings/src/permissions/sync.permissions.ts
modules/listings/src/public/sync.ts
modules/listings/migrations/*_listings_sync_*.sql
modules/listings/seed/sync.seed.ts
modules/listings/test/sync/**
modules/platform-connections/src/{routes,handlers,service,repository,sync}/sp-participations/**
modules/platform-connections/src/permissions/sp-participations.permissions.ts
modules/platform-connections/src/public/sp-participations.ts
modules/platform-connections/test/sp-participations/**
contracts/modules/listings/sync.yaml
contracts/modules/platform-connections/sp-participations.yaml
apps/web/app/(app)/settings/marketplaces/**
apps/web/features/platform-connections/sp-participations/**
apps/web/messages/*/listings.sync.json
apps/web/messages/*/platform-connections.sp-participations.json
packages/testing/fixtures/**/sync--*
packages/testing/fixtures/**/sp-participations--*
e2e/sp-participations/**
e2e/listings-sync/**
docs/modules/S06.md
docs/reports/P4-S06.md
```

- **Amazon APIs:** `sellers.getMarketplaceParticipations` (0.016 rps, once a day), report
  `GET_MERCHANT_LISTINGS_ALL_DATA` (`catalog/spapi/reports.json`), `listingsItems.searchListingsItems`
  (`includedData=summaries,issues`), `catalogItems.getCatalogItem` — rate limits from `catalog/spapi/operations.json`,
  read through the limiter, not hard-coded. No restricted operation (D11).
- **Tables / migrations** (`08_catalog.sql`): `catalog.listings`, `catalog.listing_issues`, `catalog.catalog_items`. Participation
  data goes into the existing `core.seller_account_marketplaces` (no new table).
- **Sync definitions:** `platform-connections.sp-participations` (daily), `listings.merchant-report` (daily + on demand),
  `listings.items-issues` (paged, per marketplace), `listings.catalog-enrich` (new ASINs only, queued under the limiter).
- **API:** `GET /connections/sp/marketplace-participations` (`connections.read`), `POST /connections/sp/marketplace-participations/refresh`
  (Admin+), `GET /listings/sync-status` (`listings.read` = Viewer+).
- **Screens:** `/settings/marketplaces` — participating marketplaces with state (active / suspended), linked to the seller
  account or not, last sync, "refresh". (Listings screen = S13.)
- **Needs from packages:** `sellers`, `reports`, `listingsItems`, `catalogItems` clients in `packages/amazon-sp` with replay
  fixtures (P3-CLIENTS); `/settings` route group conventions (P3-IDENTITY owns `settings/{members,connections}`, P3-INGEST
  `settings/sync`).
- **New deps:** none expected (TSV parsing from `packages/ingestion`).
- **Acceptance (beyond C1–C9):**
  - A1 Participation sync is idempotent; a marketplace that disappears or becomes `suspended` is flagged, never deleted;
    marketplaces outside the enabled regions (D4: US first) are stored as `disabled`.
  - A2 The SP-API connection is bound to the same `seller_account_id` as the Ads connection when the user selects "same
    account"; unlinking one does not delete the other's data.
  - A3 Merchant report: a report in `CANCELLED` / `FATAL` keeps the previous data and records a failed job run with retry
    scheduled; the TSV parser handles the file encoding and rows with empty ASIN / SKU (kept, flagged).
  - A4 SKUs missing from a newer full report are marked `inactive` / `deleted_on_amazon`, not removed; `listing_issues`
    are replaced per SKU (no stale issues).
  - A5 Enrichment never exceeds `getCatalogItem`'s rate limit; with the limiter at zero budget the job yields and
    resumes; enrichment failures for one ASIN do not stop the batch.
  - A6 No PII columns exist in any table or fixture of this slice (D11).
- **QA checklist:** (1) Admin opens Settings → Marketplaces: US active + linked. (2) Click refresh → "updated just now".
  (3) Replay a fixture with a new marketplace → appears as disabled. (4) Trigger listings sync via the dev command → counts
  in the sync-status endpoint; second run → same counts. (5) Replay a CANCELLED report → previous listings still present,
  sync-health (P3-INGEST screen) shows the failure. (6) Other tenant → 404. Measure: rows per minute for a 100k-SKU report;
  requests per minute vs limiter budget.

### S07 — Ad group detail

- **Goal:** open one ad group and manage its settings, product ads, keyword / product targets and negatives.
- **SCOPE IDs:** ADS-06 · **module:** `ads` · **key:** `ad-group-detail`
- **wave:** 3 · **depends_on:** S01, S02, S03, S04 (reuses state and bid commands) · **size:** L · **effort:** high (writes)

```owned
modules/ads/src/{routes,handlers,service,repository,commands}/ad-group-detail/**
modules/ads/src/permissions/ad-group-detail.permissions.ts
modules/ads/src/public/ad-group-detail.ts
modules/ads/test/ad-group-detail/**
contracts/modules/ads/ad-group-detail.yaml
apps/web/app/(app)/ads/ad-groups/[adGroupId]/**
apps/web/features/ads/ad-group-detail/**
apps/web/messages/*/ads.ad-group-detail.json
packages/testing/fixtures/**/ad-group-detail--*
e2e/ad-group-detail/**
docs/modules/S07.md
docs/reports/P4-S07.md
```

- **Amazon APIs:** v1 `SPUpdateAdGroup` (name, default bid), `SPCreateAd` / `SPUpdateAd`, `SPCreateTarget` /
  `SPUpdateTarget` (keywords with match type, product targets, negatives), suggestions EX-TARGETING-RECS (keyword and
  product suggestions, interactive).
- **Tables / migrations:** none.
- **Command kinds:** `ads.ad-group.update-settings`, `ads.ad.create`, `ads.target.create`, `ads.target.add-negative`
  (state changes and bid changes reuse S04 / S03 kinds).
- **API:** `GET /ads/ad-groups/{adGroupId}` (settings), `GET /ads/ad-groups/{adGroupId}/suggestions/keywords`,
  `GET /ads/ad-groups/{adGroupId}/suggestions/products`; the Ads / Targeting / Negative lists are S01's grid endpoints
  filtered by `adGroupId`; writes via `POST /commands`.
- **Screens:** `/ads/ad-groups/[adGroupId]` — settings (default bid), tabs Ads (+ add products by SKU or ASIN), Targeting
  (+ add keywords / products, bid editing), Negative targeting, archive with confirmation. Registers
  `ads.ad-groups.name-link`; declares slot `ads.ad-group-detail.tabs` (used by S10).
- **Needs from packages:** `SPCreateAd/Target` ports, EX-TARGETING-RECS keyword / product adapters in `packages/amazon-ads`.
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 Adding a product ad validates SKU / ASIN against the campaign's account type (`sku` for seller, `asin` for vendor —
    D60 seam) and reports **per ASIN / SKU** which ones failed (paste of 50 → 47 added, 3 errors listed).
  - A2 Keyword add: match types Broad / Phrase / Exact, duplicate detection against existing targets of the ad group, bid
    default to the ad group's default bid, bounds from `ref.ads_limits`.
  - A3 Negative keyword / product add and remove with duplicate checks; archive of the ad group needs confirmation and
    states how many targets / ads it will archive.
  - A4 Suggestion endpoints degrade independently (429 → empty list with `unavailable` flag, manual entry still works).
  - A5 The Targeting tab never shows a keyword's bid from a stale mirror after an edit (re-read after command, D62 a).
  - A6 Ad group id from another seller account of the same tenant → 404 unless the user has a grant there (RBAC by seller
    account).
- **QA checklist:** (1) open an ad group from the Campaign Manager's Ad groups tab. (2) Add 5 products incl. 1 invalid SKU →
  4 added, 1 error row. (3) Add keywords (paste 10 incl. a duplicate) → duplicate flagged. (4) Edit a keyword bid below min
  → blocked. (5) Add a negative keyword; remove it. (6) Archive the ad group → confirmation lists impact; after success it
  disappears from the list. (7) Block suggestions in the mock → page still usable. Measure: calls per "add 100 keywords"
  (= ceil(100 / batchMax)).

### S08 — FBA inventory

- **Goal:** keep a mirror of FBA inventory per SKU and expose it to listings and ads screens.
- **SCOPE IDs:** INV-01 · **module:** `inventory` (owner) · **key:** `fba`
- **wave:** 3 · **depends_on:** P3 (all); S01 (declares the `ads.product-ads.columns` slot used here) · **size:** M ·
  **effort:** medium (read-only)

```owned
modules/inventory/{package.json,tsconfig.json,README.md}
modules/inventory/src/index.ts
modules/inventory/src/{routes,handlers,service,repository,sync}/fba/**
modules/inventory/src/permissions/fba.permissions.ts
modules/inventory/src/public/fba.ts
modules/inventory/migrations/*_inventory_fba_*.sql
modules/inventory/seed/fba.seed.ts
modules/inventory/test/fba/**
contracts/modules/inventory/fba.yaml
apps/web/app/(app)/inventory/**
apps/web/features/inventory/fba/**
apps/web/messages/*/inventory.fba.json
packages/testing/fixtures/**/fba--*
e2e/fba/**
docs/modules/S08.md
docs/reports/P4-S08.md
```

- **Amazon APIs:** `fbaInventory.getInventorySummaries` (2 rps; `details=true`, filtered by `startDateTime` for changes) —
  `catalog/spapi/operations.json`.
- **Tables / migrations** (`09_inventory.sql`, `12_facts_ops.sql`): `inventory.fba_inventory`, `facts.inventory_fba_daily`.
- **Sync definitions:** `inventory.fba-summaries` (incremental by last-change time, plus a daily full reconcile and a daily
  snapshot into `facts.inventory_fba_daily`).
- **API:** `GET /inventory/fba` (grid by SKU: fulfillable, inbound working / shipped / receiving, reserved, unfulfillable,
  `freshness`; filters `q`, `lowStock`), `GET /inventory/fba/summary`. Public service `inventoryBySku()` for other modules.
- **Screens:** `/inventory` (grid + freshness), and an inventory column on the Campaign Manager's Product ads tab through
  the `ads.product-ads.columns` slot. Menu entry `Inventory`.
- **Needs from packages:** `fbaInventory` client in `packages/amazon-sp` (P3-CLIENTS).
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 Incremental pull since the last marker returns only changed SKUs; a crash mid-pagination resumes from `nextToken`.
  - A2 Quantities are integers; negative or null inputs from Amazon are stored as-is with a `data_quality` flag rather than
    coerced; totals equal the sum of the parts.
  - A3 The daily snapshot is written for the marketplace-local date; re-running the same date overwrites the same row.
  - A4 Seller with no FBA (MFN only) → empty state with explanation, not an error.
  - A5 The ads column shows "n/a" (not 0) for SKUs Amazon did not return.
- **QA checklist:** (1) open Inventory: rows with the four quantity groups, "updated at". (2) Filter low stock. (3) Open
  Campaign Manager → Product ads: inventory column present. (4) Replay a fixture with a changed SKU → only that row's
  timestamp changes. (5) MFN-only account → empty state. (6) Other tenant → 404. Measure: pull time for 20k SKUs at 2 rps.

### S09 — Portfolios

- **Goal:** list, create and edit portfolios (name, budget cap) and move campaigns between them.
- **SCOPE IDs:** ADS-09 · **module:** `ads` · **key:** `portfolios`
- **wave:** 3 · **depends_on:** S01, S02 · **size:** M · **effort:** high (writes)

```owned
modules/ads/src/{routes,handlers,service,repository,sync,commands}/portfolios/**
modules/ads/src/permissions/portfolios.permissions.ts
modules/ads/src/public/portfolios.ts
modules/ads/test/portfolios/**
contracts/modules/ads/portfolios.yaml
apps/web/app/(app)/ads/portfolios/**
apps/web/features/ads/portfolios/**
apps/web/messages/*/ads.portfolios.json
packages/testing/fixtures/**/portfolios--*
e2e/portfolios/**
docs/modules/S09.md
docs/reports/P4-S09.md
```

- **Amazon APIs:** EX-PORTFOLIOS (v0 `ListPortfolios`, `CreatePortfolios`, `UpdatePortfolios` — named exception D53, adapter
  `packages/amazon-ads/src/v0/ex-portfolios`, PUT = replace → full record from a fresh read); v1 campaign `portfolioId` via
  `SPUpdateCampaign`.
- **Tables / migrations:** none (`ads.portfolios` created by S01; this slice fills and writes it).
- **Sync definitions:** `ads.portfolios` (v0 list, daily + on demand).
- **Command kinds:** `ads.portfolio.create`, `ads.portfolio.update` (name, state, budget cap none / date range / recurring
  monthly), `ads.campaign.set-portfolio` (move / remove campaigns).
- **API:** `GET /ads/portfolios` (grid with spend / sales / ACOS aggregated from campaign facts, `totals`, `freshness`),
  `GET /ads/portfolios/{portfolioId}`; writes via `POST /commands`.
- **Screens:** `/ads/portfolios` (list), `/ads/portfolios/[portfolioId]` (settings + campaign table, move / remove). Registers
  a "Move to portfolio" action on `ads.campaigns.row-actions`. Menu entry `Ads → Portfolios`.
- **Needs from packages:** EX-PORTFOLIOS adapter (P3-CLIENTS).
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 Budget cap validation: date-range caps need end ≥ start (marketplace zone), recurring monthly needs an amount > 0;
    amounts in the marketplace currency with its precision.
  - A2 Update sends the full v0 record built from a fresh read (no field reset); a concurrent change on Amazon between read
    and write is detected on reconcile and reported, not overwritten silently.
  - A3 Moving 40 campaigns reports per-campaign results; a campaign already in the target portfolio is "no change".
  - A4 Portfolio aggregates equal the sum of its campaigns' facts for the selected range (test with 2 pages).
  - A5 When the v0 adapter is throttled or the exception is removed, the screen is read-only with a banner; the app does not
    crash (adapter swap seam, ADR-0006).
- **QA checklist:** (1) open Portfolios: list with totals. (2) Create "Brand" with a monthly cap. (3) Open it, move 3
  campaigns in from the Campaign Manager action. (4) Edit the cap to an invalid date range → blocked. (5) Remove a campaign
  from the portfolio. (6) Verify History shows each change. (7) Mock 429 → banner, no crash. Measure: calls per bulk move.

### S10 — Search terms

- **Goal:** show an ad group's search terms with performance and let the user turn them into keywords or negatives by hand.
- **SCOPE IDs:** ADS-07 · **module:** `ads` · **key:** `search-terms`
- **wave:** 4 · **depends_on:** S01, S02, S07 (tab slot, target commands) · **size:** M · **effort:** high (writes)

```owned
modules/ads/src/{routes,handlers,service,repository,sync}/search-terms/**
modules/ads/src/permissions/search-terms.permissions.ts
modules/ads/src/public/search-terms.ts
modules/ads/migrations/*_ads_search-terms_*.sql
modules/ads/test/search-terms/**
contracts/modules/ads/search-terms.yaml
apps/web/features/ads/search-terms/**
apps/web/messages/*/ads.search-terms.json
packages/testing/fixtures/**/search-terms--*
e2e/search-terms/**
docs/modules/S10.md
docs/reports/P4-S10.md
```

- **Amazon APIs:** v1 report `AdsApiv1CreateReport` with search-term level fields (`catalog/ads/reports.json`; coverage of
  sales / purchases / units is **unconfirmed — D57 a**: columns the report lacks are nullable and hidden); writes reuse S07's
  `ads.target.create` and `ads.target.add-negative`.
- **Tables / migrations:** `facts.ads_sp_search_term_daily` (`06_facts_ads.sql`, monthly partitions).
- **Sync definitions:** `ads.sp-report-search-term` (daily, newest-first backfill, overlap window, retention per D64).
- **API:** `GET /ads/ad-groups/{adGroupId}/search-terms` (grid: term, match source, spend, clicks, orders, sales, ACOS …,
  flags `isKeyword`, `isNegative`; `from/to/compare`, `sort`, `filter`), `GET /ads/ad-groups/{adGroupId}/search-terms/export`.
- **Screens:** a "Search terms" tab registered on `ads.ad-group-detail.tabs` with row actions "Add as keyword (Broad /
  Phrase / Exact)", "Add as negative (Exact / Phrase)", "Add as product target" (ASIN-shaped terms); actions go through the
  command pipeline.
- **Needs from packages:** search-term report definition in `packages/amazon-ads` report helper (P3-CLIENTS).
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 Terms are normalised (case, whitespace) before the natural key so one term appears once per day / ad group / match
    source; ASIN-shaped terms are classified as product terms.
  - A2 `isKeyword` / `isNegative` are computed against the **current** target mirror and update after an action without a page
    reload.
  - A3 Actions are manual only (no automation here): adding a term that already exists as a target is blocked with a
    message naming the existing target.
  - A4 A report missing sales columns still renders terms with clicks / spend and hides sales-based metrics; a note names the
    missing coverage (D57).
  - A5 5 million rows per month load into the partitioned table within the job time budget (batch upserts), and the grid
    query stays under 1 s p95 with the covering index.
- **QA checklist:** (1) open an ad group → Search terms tab: terms with metrics. (2) Sort by spend; filter clicks ≥ 10, no
  orders. (3) Add a term as Exact keyword → confirmation → drawer success; the row flag changes to "keyword". (4) Add a
  term as negative Phrase. (5) Try to add an existing keyword → blocked. (6) Replay a report without sales → sales columns
  hidden. (7) Export CSV → equals filtered count. Measure: grid p95 on a seeded 2M-row month.

### S11 — Create SP campaign

- **Goal:** create a complete Sponsored Products campaign tree (campaign → ad groups → product ads → targets) on one page,
  with per-item error reporting and no double submission.
- **SCOPE IDs:** ADS-08 · **module:** `ads` · **key:** `campaign-create`
- **wave:** 4 · **depends_on:** S01, S02, S05, S06 (product picker), S07, S09 (portfolio picker) · **size:** XL ·
  **effort:** high (writes)

```owned
modules/ads/src/{routes,handlers,service,repository,commands}/campaign-create/**
modules/ads/src/permissions/campaign-create.permissions.ts
modules/ads/src/public/campaign-create.ts
modules/ads/test/campaign-create/**
contracts/modules/ads/campaign-create.yaml
apps/web/app/(app)/ads/campaigns/new/**
apps/web/features/ads/campaign-create/**
apps/web/messages/*/ads.campaign-create.json
packages/testing/fixtures/**/campaign-create--*
e2e/campaign-create/**
docs/modules/S11.md
docs/reports/P4-S11.md
```

- **Amazon APIs:** v1 `SPCreateCampaign`, `SPCreateAdGroup`, `SPCreateAd`, `SPCreateTarget` (207);
  EX-TARGETING-RECS (keyword, bid, product, category recommendations) and EX-TARGETING-DISCOVERY (category tree, product
  counts, brand search) — v0 named exceptions, interactive lookups, not mirrored. Validation and tooltips come from
  `catalog/legacy/web-ux-rules.json` (UX-14..UX-16), v1 contracts and `ref.ads_limits` as data (D59: second console pass
  still pending — keep them in message files / data, not logic).
- **Tables / migrations:** none (ADS-15 drafts are v1; the form state lives in the browser session only).
- **Command kind:** `ads.campaign.create-tree` — ordered steps in one command; a failed step stops later steps and the
  result states exactly which entities exist on Amazon; "retry failed" continues without re-creating what exists; "archive
  created" is offered (ADR-0011 tree commands).
- **API:** `POST /ads/lookups/products/check` (paste / upload of SKUs or ASINs → per-item eligibility and errors),
  `GET /ads/lookups/products?q=` (search the listings mirror via `listings` public entry), `GET /ads/lookups/keyword-suggestions`,
  `GET /ads/lookups/category-tree`, `GET /ads/lookups/category-product-count`, `GET /ads/lookups/brand-search`; creation via
  S02 `POST /commands`.
- **Screens:** `/ads/campaigns/new` — one page like the console: settings (name, dates, daily budget, portfolio, bidding
  strategy, placements), products, targeting type **Auto** (bids per target group) / **Manual keyword** (suggested Broad /
  Phrase / Exact) / **Manual product** (category + ASIN), negatives, review & launch; creation result view with
  per-step status. Registers a "Create campaign" action on `ads.campaigns.toolbar`.
- **Needs from packages:** `SPCreate*` ports, EX-TARGETING-RECS and EX-TARGETING-DISCOVERY adapters (P3-CLIENTS).
- **New deps:** `papaparse` (CSV upload of SKUs / ASINs) — added in wave prep.
- **Acceptance (beyond C1–C9):**
  - A1 Name rules, start date ≥ today and end-date ceiling are computed in the marketplace time zone on the server (UX-17);
    budget and bids validated against `ref.ads_limits` (UX-14); errors reference the field path.
  - A2 Step ordering: if ad-group creation fails, no ads / targets are attempted; the result lists created entity ids and
    the failed step; retry-failed completes the tree without duplicates (idempotent by command item id).
  - A3 A paste / upload of 200 SKUs / ASINs returns per-row status (ok / ineligible / not found / duplicate) and the launch
    includes only the ok ones, with a count.
  - A4 Auto targeting requires bids for each group within bounds; manual keyword requires ≥ 1 keyword; manual product
    requires ≥ 1 category or ASIN; duplicates inside the form are merged with a notice.
  - A5 Double click on "Launch" or reload during creation never creates two campaigns (`Idempotency-Key`; the page resumes
    showing the running command).
  - A6 Lookups degrade independently (suggestions 429 → "suggestions unavailable", manual entry works).
  - A7 A 200-keyword, 5-ad-group tree is sent in ≤ ceil(items / batchMax) calls per step.
  - A8 After success the created campaign appears in the Campaign Manager without waiting for the next sync (mirror refresh).
- **QA checklist:** (1) Campaign Manager → Create campaign. (2) Fill settings with a past start date → inline error. (3)
  Paste 20 SKUs incl. 3 bad → 17 accepted, 3 listed with reasons. (4) Choose Manual keyword, accept suggested keywords,
  edit a bid below min → blocked. (5) Launch → progress view; force a failure at the ad-group step in the mock → result
  says "campaign created, ad group failed", retry completes. (6) Double click Launch → one campaign. (7) Auto targeting
  path creates targets for the four groups. (8) Verify History lists every created entity. Measure: total Amazon calls for
  the standard tree; time to launch.

### S12 — Orders (no PII)

- **Goal:** keep an order mirror without any buyer data and show an order list and detail.
- **SCOPE IDs:** ORD-02 · **module:** `orders` (owner) · **key:** `orders`
- **wave:** 4 · **depends_on:** P3 (all) · **size:** L · **effort:** medium (read-only)

```owned
modules/orders/{package.json,tsconfig.json,README.md}
modules/orders/src/index.ts
modules/orders/src/{routes,handlers,service,repository,sync}/orders/**
modules/orders/src/permissions/orders.permissions.ts
modules/orders/src/public/orders.ts
modules/orders/migrations/*_orders_orders_*.sql
modules/orders/seed/orders.seed.ts
modules/orders/test/orders/**
contracts/modules/orders/orders.yaml
apps/web/app/(app)/orders/**
apps/web/features/orders/orders/**
apps/web/messages/*/orders.orders.json
packages/testing/fixtures/**/orders--*
e2e/orders/**
docs/modules/S12.md
docs/reports/P4-S12.md
```

- **Amazon APIs:** report `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL` (backfill and rolling updates),
  `orders@2026-01-01.searchOrders` (0.0056 rps ≈ 1 call / 3 min) and `getOrder` for incremental fills — all from
  `catalog/spapi/operations.json` / `reports.json`; restricted operations are refused by the client (D11).
- **Tables / migrations** (`10_orders.sql`): `orders.orders`, `orders.order_items` (coarse geography only: country /
  state / postal prefix if the model marks it non-restricted).
- **Sync definitions:** `orders.report-backfill` (windows, newest-first), `orders.search-incremental` (last-updated cursor,
  yields on the limiter).
- **API:** `GET /orders` (grid: date, status, channel FBA / MFN, marketplace, total, items count; filters), 
  `GET /orders/{orderId}` (items, status history as stored, charges summary).
- **Screens:** `/orders` (grid), `/orders/[orderId]` (detail). Menu entry `Orders`.
- **Needs from packages:** `reports` + `orders@2026-01-01` clients in `packages/amazon-sp`; the restricted-call guard
  (P3-CLIENTS).
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 **No PII**: a fixture whose report contains buyer name, address, phone, email columns is ingested; none of those
    values is stored, logged, returned by the API or present in the raw landing copy (test scans DB and logs).
  - A2 Backfill is resumable and newest-first; re-running a window converges (upsert by Amazon order id + item id).
  - A3 With `searchOrders` at ~1 call / 3 minutes, a sync run never blocks other jobs: it yields, records `throttled`
    counts in the job run and continues on the next tick.
  - A4 Order updates (status, cancellation, quantity) overwrite the previous row and keep `last_update_date`; orders
    unseen in the latest window are not deleted.
  - A5 Money is decimal + currency; mixed currencies are never summed.
  - A6 Restricted operations (buyer info, address) are not callable: unit test asserts the client rejects them.
- **QA checklist:** (1) Orders list shows the seeded window; filter status = Shipped and channel = FBA. (2) Open an order →
  items, no buyer fields anywhere (inspect network response). (3) Replay the PII fixture → list unchanged, DB scan clean.
  (4) Throttle the mock → sync-health shows throttled, UI shows "updated at". (5) Other tenant → 404. Measure: backfill rows
  per minute; calls per day vs limit.

### S13 — Listings screen

- **Goal:** one screen that joins each SKU's listing status and issues with its FBA stock and whether ads are running.
- **SCOPE IDs:** CAT-02 · **module:** `listings` · **key:** `screen`
- **wave:** 5 · **depends_on:** S01 (`adsStatusBySku` public), S06, S08 (`inventoryBySku` public) · **size:** M · **effort:** medium

```owned
modules/listings/src/{routes,handlers,service,repository}/screen/**
modules/listings/src/permissions/screen.permissions.ts
modules/listings/src/public/screen.ts
modules/listings/test/screen/**
contracts/modules/listings/screen.yaml
apps/web/app/(app)/listings/**
apps/web/features/listings/screen/**
apps/web/messages/*/listings.screen.json
packages/testing/fixtures/**/screen--*
e2e/listings-screen/**
docs/modules/S13.md
docs/reports/P4-S13.md
```

- **Amazon APIs:** none (reads the DB mirrors of S06, S08, S01).
- **Tables / migrations:** none (read model / views through repositories; if a materialised view is needed, a migration
  `*_listings_screen_*.sql` is owned here).
- **API:** `GET /listings` (grid: SKU, ASIN, title, image, status, issue count / worst severity, price, FBA fulfillable,
  `adsRunning`; filters `q`, `status`, `hasIssues`, `adsRunning`, `lowStock`), `GET /listings/{listingId}` (issues detail).
- **Screens:** `/listings` (grid, issue drawer, links to the Campaign Manager filtered by ASIN). Menu entry `Listings`.
- **Needs from packages:** none.
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 The join is by `(seller_account_id, sku)` through other modules' **public entries** only (lint-checked); no N+1:
    one page = a constant number of queries (test counts queries).
  - A2 `adsRunning` = at least one ENABLED product ad of that SKU inside an ENABLED campaign of the same seller account.
  - A3 SKUs without inventory data show "n/a"; MFN-only SKUs show "—" for FBA fields, not 0.
  - A4 Issues show Amazon's severity and message; fixing is out of scope (no writes).
  - A5 100k SKUs: `GET /listings` p95 < 1 s with filters; image URLs are rendered through the CSP-approved Amazon image host
    only.
- **QA checklist:** (1) open Listings: columns populated for seeded SKUs. (2) Filter "has issues" → only those; open the
  drawer. (3) Filter "ads running" → matches Product ads in the Campaign Manager. (4) Filter low stock. (5) Account with
  listings but no inventory sync → "n/a". (6) Other tenant → 404. Measure: queries per page; p95 at 100k.

### S14 — Sales overview + TACoS

- **Goal:** show sales by day / week and marketplace, ASIN or SKU, and a first TACoS (ad spend ÷ total sales).
- **SCOPE IDs:** ORD-01 · **module:** `orders` · **key:** `sales-overview`
- **wave:** 5 · **depends_on:** S01 (ads facts through a public entry), S12 (module skeleton) · **size:** S · **effort:** medium

```owned
modules/orders/src/{routes,handlers,service,repository,sync}/sales-overview/**
modules/orders/src/permissions/sales-overview.permissions.ts
modules/orders/src/public/sales-overview.ts
modules/orders/migrations/*_orders_sales-overview_*.sql
modules/orders/test/sales-overview/**
contracts/modules/orders/sales-overview.yaml
apps/web/app/(app)/sales/**
apps/web/features/orders/sales-overview/**
apps/web/messages/*/orders.sales-overview.json
packages/metrics/src/sales/**
packages/testing/fixtures/**/sales-overview--*
e2e/sales-overview/**
docs/modules/S14.md
docs/reports/P4-S14.md
```

- **Amazon APIs:** `sales.getOrderMetrics` (0.5 rps; interval and `granularityTimeZone` in the marketplace zone) —
  `catalog/spapi/operations.json`.
- **Tables / migrations:** `facts.sales_daily` (`12_facts_ops.sql`).
- **Sync definitions:** `orders.order-metrics` (daily; re-pulls the last 14 days because of restatements).
- **API:** `GET /sales/overview` (series by day / week, totals, TACoS, `freshness`), `GET /sales/by-product` (ASIN / SKU grid).
- **Screens:** `/sales` — KPI cards (sales, units, orders, ad spend, TACoS), chart, product grid. Menu entry `Sales`.
  TACoS is defined once in `packages/metrics/src/sales`.
- **Needs from packages:** `sales.getOrderMetrics` client (P3-CLIENTS); S01 public `adSpendByDay()`.
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 TACoS = ad spend ÷ total sales, from decimal sums, `null` when sales = 0; ad spend and sales are only combined when
    their currency matches, otherwise shown separately with a note.
  - A2 Day boundaries use the marketplace time zone; week alignment follows the API's granularity; a day not yet complete is
    marked "partial".
  - A3 Missing days are gaps in the chart, not zeros; restated days overwrite on re-pull.
  - A4 The slice reads ads spend only through S01's public entry (no cross-module table access).
- **QA checklist:** (1) open Sales for last 30 days: cards + chart + grid. (2) Switch to weekly. (3) Pick a marketplace with
  no ads → TACoS shows "—". (4) Compare ad spend with the Campaign Manager total for the same range → equal. (5) Throttle the
  mock → page shows old data with "updated at". Measure: `getOrderMetrics` calls per refresh.

### S15 — Financial transactions

- **Goal:** keep a mirror of Amazon financial transactions and show them with a fee summary by SKU and month.
- **SCOPE IDs:** FIN-01 · **module:** `finance` (owner) · **key:** `transactions`
- **wave:** 5 · **depends_on:** P3 (all) · **size:** M · **effort:** medium (read-only)

```owned
modules/finance/{package.json,tsconfig.json,README.md}
modules/finance/src/index.ts
modules/finance/src/{routes,handlers,service,repository,sync}/transactions/**
modules/finance/src/permissions/transactions.permissions.ts
modules/finance/src/public/transactions.ts
modules/finance/migrations/*_finance_transactions_*.sql
modules/finance/seed/transactions.seed.ts
modules/finance/test/transactions/**
contracts/modules/finance/transactions.yaml
apps/web/app/(app)/finance/**
apps/web/features/finance/transactions/**
apps/web/messages/*/finance.transactions.json
packages/testing/fixtures/**/transactions--*
e2e/transactions/**
docs/modules/S15.md
docs/reports/P4-S15.md
```

- **Amazon APIs:** `finances@2024-06-19.listTransactions` (0.5 rps, by posted date), `listFinancialEventGroups` (v0, settlement
  groups) — `catalog/spapi/operations.json`; role FA.
- **Tables / migrations** (`11_finance.sql`, `12_facts_ops.sql`): `finance.transactions`, `finance.transaction_lines`,
  `finance.financial_event_groups`, `facts.finance_sku_daily`.
- **Sync definitions:** `finance.transactions` (rolling posted-date windows with overlap for deferred / released changes),
  `finance.event-groups` (daily).
- **API:** `GET /finance/transactions` (grid: posted date, type, marketplace, amount, status, SKU; filters),
  `GET /finance/transactions/{transactionId}` (lines), `GET /finance/fees` (totals by SKU / month).
- **Screens:** `/finance` — tabs Transactions and Fees by SKU / month. Menu entry `Finance`.
- **Needs from packages:** `finances` client in `packages/amazon-sp` (P3-CLIENTS).
- **New deps:** none.
- **Acceptance (beyond C1–C9):**
  - A1 Transactions whose status changes (deferred → released) are upserted in place; the overlap window re-reads them.
  - A2 Tie-out: for every stored transaction the sum of its lines equals its total (test over the fixture set); a mismatch
    is flagged `data_quality` and surfaced, not hidden.
  - A3 Money is decimal + currency; months use the marketplace-local month; mixed currencies are never summed.
  - A4 Advertising charges (Sponsored Products invoices) are tagged so FIN-03 (v1) can use them; unknown transaction types
    are stored with their raw type, not dropped.
  - A5 No buyer fields are stored (D11); fixtures with PII columns prove they are dropped.
  - A6 Viewer role cannot read finance data (permission `finance.read` = Analyst+); API returns 403.
- **QA checklist:** (1) as Analyst open Finance → Transactions for last 30 days. (2) Open one → lines add up to the total.
  (3) Fees tab: pick a month, totals by SKU; export compare with the transaction filter. (4) As Viewer → 403 page.
  (5) Replay a fixture with a deferred→released change → row updates. (6) Other tenant → 404. Measure: pull time per month of
  data at 0.5 rps.

---

## 4. Waves

P3 first (PLAN: SCAFFOLD → CLIENTS ∥ DS → IDENTITY ∥ INGEST → SMOKE = G3), then:

| Wave | Slices (writers) | Starts when | Why this grouping | Wave-prep items (orchestrator) |
|---|---|---|---|---|
| **1a (L0)** | **S01** campaign-manager (L) · **S02** commands + audit (L) — 2 writers | G3 (P3 merged, P3-SMOKE done, D30 decided or "sandbox / test account only" confirmed) | The two halves of L0 that do not depend on each other: read model vs write pipeline | none beyond P3 requests listed in the entries |
| **1b (L0)** | **S03** bid-rule (L) — 1 writer | 1a merged | needs S01 facts and S02 executor; closes L0 and owns `e2e/l0/**` | — |
| **2** | **S04** bulk · **S05** campaign-detail · **S06** listings-sync — 3 writers | 1b merged (**L0 demo green**) | S04 / S05 extend the Campaign Manager through slots in different directories; S06 is the independent SP-API slice | v0 / v1 ports requested by S04, S05; `listing` clients for S06 |
| **3** | **S07** ad-group-detail · **S08** inventory · **S09** portfolios — 3 writers | 2 merged | S07 needs S04's command kinds; S08 independent; S09 independent of S07 | EX-TARGETING-RECS adapters (S07), EX-PORTFOLIOS adapter (S09) |
| **4** | **S10** search-terms · **S11** campaign-create (XL) · **S12** orders — 3 writers | 3 merged | S10 needs S07's tab slot and commands; S11 needs S05 / S06 / S07 / S09; S12 independent | `papaparse` dependency; EX-TARGETING-DISCOVERY adapter (S11) |
| **5** | **S13** listing-screen · **S14** sales-overview · **S15** finance — 3 writers | 4 merged | S13 needs S06 + S08 + S01; S14 needs S12's module skeleton; S15 independent | `getOrderMetrics` and `finances` clients |

Notes:

- Writer sessions per wave ≤ 3 (PLAN D6). P5-REVIEW (opus) and P5-QA (haiku) sessions for finished slices run alongside the
  next wave within the 6-session total.
- Waves 2–5 are ordered ads-first. Slices S06, S08, S12, S14, S15 (SP-API, independent of ads except S13 / S14 reads) may be
  pulled forward if SP-API approval (R5) arrives before Ads approval (R6); the only hard constraints are the `depends_on`
  lines (S13 after S06 + S08, S14 after S12, S11 after S06 + S09).
- A wave that has a slice with an unmet external prerequisite (e.g. D30 undecided) starts the other slices; the blocked slice
  moves to the next wave. Slices that write to Amazon never run their live check until D30 is decided.
- **L0 coverage:** PLT-01, PLT-03, PLT-04, PLT-05 are delivered by P3 tasks (table in §3); ADS-01/02/03 → S01; PLT-07,
  PLT-06 → S02; AUT-01 → S03.
- **Vendor (D60 a):** no slice blocks it. Vendor uses `account_type`, the ads `sku | asin` columns, other generated SP clients
  and its own modules (`vendor-*`) in v1 — none of the 15 slices owns a path a vendor module would need, and the generic
  command pipeline, sync registry and slots are reused as they are.

---

## 5. Overlap check

Method: the script in `docs/reports/P2-BACKLOG.md` (appendix) parses every `### Sxx` heading, its `**wave:**` bullet and its
`owned` block, expands braces, and for every pair of slices **of the same wave** intersects every pair of globs segment by
segment (`**` absorbs directories; the final segments must still be able to match the same file name). Result for this file:
**15 slices, 6 wave steps, 13 slice pairs, 5 421 glob comparisons, 0 overlaps.** A mutation test (giving S04 one of S05's
directories) is reported as an overlap, so the check does detect a clash.

How the shared modules stay disjoint inside a wave (the table to read first):

| Wave | `ads` module — directory keys per slice | Other modules touched | Web route directories |
|---|---|---|---|
| 1a | S01 `campaign-manager` (+ module skeleton) | S02 `platform-commands`, `platform-audit/*/history` | S01 `ads/layout.tsx`, `ads/campaigns/{page,loading,error,not-found}.tsx` · S02 `history/**` |
| 1b | S03 `target-bid` | S03 `automation` (new module) | S03 `automation/**` |
| 2 | S04 `bulk` · S05 `campaign-detail` | S06 `listings` (new), `platform-connections/*/sp-participations` | S05 `ads/campaigns/[campaignId]/**` · S06 `settings/marketplaces/**` |
| 3 | S07 `ad-group-detail` · S09 `portfolios` | S08 `inventory` (new) | S07 `ads/ad-groups/[adGroupId]/**` · S08 `inventory/**` · S09 `ads/portfolios/**` |
| 4 | S10 `search-terms` · S11 `campaign-create` | S12 `orders` (new) | S11 `ads/campaigns/new/**` · S12 `orders/**` · S10 none (tab slot) |
| 5 | — | S13 `listings/*/screen` · S14 `orders/*/sales-overview` · S15 `finance` (new) | S13 `listings/**` · S14 `sales/**` · S15 `finance/**` |

Per slice, the top-level path roots it owns (generated by the script; every root is shared with other slices only through
a differently named sub-directory, file infix or key-prefixed file name):

| Wave | Slice | Globs | Roots |
|---|---|---|---|
| 1a | S01 Campaign Manager read model | 27 | `modules/ads` `contracts/modules/ads` `apps/web` `packages/metrics/src/ads` `packages/testing` `e2e/campaign-manager` `docs` |
| 1a | S02 Commands + audit/History | 38 | `modules/platform-commands` `modules/platform-audit` `contracts/modules` `apps/web` `packages/testing` `e2e/{commands,history}` `docs` |
| 1b | S03 Bid rule | 31 | `modules/automation` `modules/ads` (`commands/target-bid`) `contracts/modules` `apps/web/app/(app)/automation` `packages/testing` `e2e/{bid-rule,l0}` `docs` |
| 2 | S04 Bulk | 15 | `modules/ads` `contracts/modules/ads/bulk.yaml` `apps/web/features/ads/bulk` `packages/testing` `e2e/bulk` `docs` |
| 2 | S05 Campaign detail | 19 | `modules/ads` `contracts/modules/ads/campaign-detail.yaml` `apps/web/app/(app)/ads/campaigns/[campaignId]` `packages/testing` `e2e/campaign-detail` `docs` |
| 2 | S06 SP link + listings sync | 34 | `modules/listings` `modules/platform-connections` `contracts/modules` `apps/web/app/(app)/settings/marketplaces` `packages/testing` `e2e` `docs` |
| 3 | S07 Ad group detail | 16 | `modules/ads` `contracts/modules/ads/ad-group-detail.yaml` `apps/web/app/(app)/ads/ad-groups` `packages/testing` `e2e/ad-group-detail` `docs` |
| 3 | S08 FBA inventory | 22 | `modules/inventory` `contracts/modules/inventory` `apps/web/app/(app)/inventory` `packages/testing` `e2e/fba` `docs` |
| 3 | S09 Portfolios | 17 | `modules/ads` `contracts/modules/ads/portfolios.yaml` `apps/web/app/(app)/ads/portfolios` `packages/testing` `e2e/portfolios` `docs` |
| 4 | S10 Search terms | 16 | `modules/ads` `contracts/modules/ads/search-terms.yaml` `apps/web/features/ads/search-terms` `packages/testing` `e2e/search-terms` `docs` |
| 4 | S11 Create campaign | 16 | `modules/ads` `contracts/modules/ads/campaign-create.yaml` `apps/web/app/(app)/ads/campaigns/new` `packages/testing` `e2e/campaign-create` `docs` |
| 4 | S12 Orders | 22 | `modules/orders` `contracts/modules/orders` `apps/web/app/(app)/orders` `packages/testing` `e2e/orders` `docs` |
| 5 | S13 Listings screen | 15 | `modules/listings` `contracts/modules/listings/screen.yaml` `apps/web/app/(app)/listings` `packages/testing` `e2e/listings-screen` `docs` |
| 5 | S14 Sales overview | 18 | `modules/orders` `contracts/modules/orders/sales-overview.yaml` `apps/web/app/(app)/sales` `packages/metrics/src/sales` `packages/testing` `e2e/sales-overview` `docs` |
| 5 | S15 Finance | 22 | `modules/finance` `contracts/modules/finance` `apps/web/app/(app)/finance` `packages/testing` `e2e/transactions` `docs` |

Cross-wave note: with all waves treated as one, the script reports four conservative matches, all pairs of migration
globs such as `*_ads_campaign-manager_*.sql` vs `*_ads_search-terms_*.sql` (the literal key infix makes them disjoint);
no other path is owned by two slices at all.

---

## 6. Coverage of the 23 MVP rows

| SCOPE ID | Feature | Owner |
|---|---|---|
| PLT-01 | tenant, users, BFF login, 5 roles | **P3-IDENTITY** |
| PLT-03 | connect Ads account | **P3-IDENTITY** |
| PLT-04 | seller account / marketplace switch, limits as data | **P3-IDENTITY** (+ P3-SCAFFOLD `ref` seed, P3-DS switcher) |
| PLT-05 | sync engine | **P3-INGEST** |
| ADS-01 | SP structure sync | **S01** |
| ADS-02 | daily performance reports | **S01** |
| ADS-03 | Campaign Manager (read-only in L0) | **S01** |
| PLT-07 | safe write layer | **S02** |
| AUT-01 | rule engine + one bid rule | **S03** |
| PLT-06 | audit log + History | **S02** (audit table and writer: P3-IDENTITY) |
| PLT-02 | connect SP-API; link to the same seller account | **S06** (connect flow: P3-IDENTITY) |
| CAT-01 | listings sync | **S06** |
| CAT-02 | Listings screen | **S13** |
| ADS-04 | bulk actions | **S04** |
| ADS-05 | campaign detail | **S05** |
| ADS-06 | ad group detail | **S07** |
| ADS-07 | search terms | **S10** |
| ADS-08 | create SP campaign | **S11** |
| ADS-09 | portfolios | **S09** |
| INV-01 | FBA inventory | **S08** |
| ORD-01 | sales overview + TACoS | **S14** |
| ORD-02 | orders, no PII | **S12** |
| FIN-01 | financial transactions | **S15** |

23 rows: 4 assigned to a named P3 task (PLT-01, PLT-03, PLT-04, PLT-05), 19 in exactly one slice (PLT-02 and PLT-06 are
completed by one slice each, with the P3 half named). The coverage was verified by script (see the report): every ticked
`[x]` row of `docs/SCOPE.md` appears once in the "SCOPE IDs" bullets or in this table.

---

## 7. Open items and risks (for Gate 2)

1. **D30 is OPEN.** Slices S02, S03, S04, S05, S07, S09, S10, S11 write to Amazon. Their acceptance is proven on the mock /
   replay client; live verification against an Ads test account (no performance data) and SP-API sandbox is manual and
   happens after D30. No slice may be marked "live-verified" before then.
2. **Contract-file granularity.** This backlog changes ADR-0010's "one contract file per module" to one per slice
   (`contracts/modules/<m>/<k>.yaml`) and message files to `<m>.<k>.json`; it also adds `*.job.ts` and slots to the generator.
   These need the user's / orchestrator's acceptance with the ADRs at Gate 2; without them the `ads` module (seven
   slices) cannot be built in parallel.
3. **P3 scope gaps** that slices rely on (listed in the report): `*.job.ts` registry support; v0 exception adapters
   (EX-PORTFOLIOS, EX-TARGETING-RECS, EX-TARGETING-DISCOVERY, EX-CHANGE-HISTORY, EX-BUDGET-RULES read) in `packages/amazon-ads`;
   `platform-audit` skeleton and `ops.audit_log` in P3-IDENTITY; `/v1/me` preferences endpoint for column layout; `ref`
   seeds; the web `(app)/settings/*` split between P3-IDENTITY, P3-INGEST and S06.
4. **D57 report coverage** (search-term sales, placement conversions, impression share) is unconfirmed; S01, S05 and S10 hide
   missing columns and carry fixtures for both shapes. A live pull is needed before these screens are called complete.
5. **D59 (second console pass)** is pending: S05, S07, S11 take validation and copy from ads-web rules and v1 contracts and
   keep them as data / message files so a later pass changes data, not code.
6. **ADS-05 "Budget rules (read)"** relies on the EX-BUDGET-RULES v0 read adapter; if P3-CLIENTS does not ship it, the tab is
   hidden (S05 A5) and ADS-11 (v1) delivers it.
7. **Lockfile and `package.json` contention** are handled by wave prep; if a slice discovers a dependency late it reports
   `BLOCKED` with the exact package, which delays that slice by one orchestrator step.
8. **S11 is XL** (one session, 2–4 weeks in SCOPE). If it overruns, split along `ads.campaign.create-tree` (command + API)
   and the page (`apps/web/.../campaigns/new`) — both already have disjoint paths.
