# STATUS

Owned by the orchestrator. Other sessions read only. Update before ending every turn.

- **Phase:** P3 — foundation; P3-SCAFFOLD fixing review findings
- **Updated:** 2026-11-11
- **Waiting on user:** R1 start Docker Desktop again (engine down 2026-11-11; DB part of the gate needs it); R5/R6 and D30 before G3; D59 (optional)

## Running

| Task | Session name | local id | Model | Checkout / branch | Ports / compose project | Started |
| --- | --- | --- | --- | --- | --- | --- |
| P3-SCAFFOLD (fixing review: B1–B4, S1–S8) | p3-scaffold | local_faa2e3a4-0e32-46b1-b8d5-7b06859c7c93 | sonnet / high | wt / claude/p3-scaffold-f31648 | stacks down | 2026-11-10 |

## Done

| Task | Verified how | Merged / committed | Report |
| --- | --- | --- | --- |
| P1-SPAPI | builder re-run exit 0, catalog unchanged; 394 ops (352 seller, 42 vendor) | committed on main | docs/reports/P1-SPAPI.md |
| P1-ADS | builder re-run exit 0, catalog unchanged; 1,090 ops, 110 MCP tools / 18 groups | committed on main | docs/reports/P1-ADS.md |
| P1-CONSOLE | report read; entityId grep clean. Partial: account has SB only (SP/SD detail tabs, validation msgs, tooltips not covered) | committed on main | docs/reports/P1-CONSOLE.md |
| P1-REF | report read; competitor evidence partly secondhand (some pages blocked) | committed on main | docs/reports/P1-REF.md |
| P1-WEB | report read; 188/194 web calls match api-endpoints.json; JSON parses | committed on main | docs/reports/P1-WEB.md |
| P1-VENDOR | report read; 24 entries parse; no ids/ASINs; all tabs closed. Partial: CA DF account, promo wizard steps 2–3, Personalized/Points, Invoices/Payments unreachable | committed on main | docs/reports/P1-VENDOR.md |
| P2-BACKLOG | BACKLOG.md read (15 slices S01–S15, waves 1a/1b/2–5, coverage of 23 rows, overlap table); clean-room grep 0; overlap/coverage scripts per its report (not re-run) | committed on main | docs/reports/P2-BACKLOG.md |
| P2-DATA | 14 DDL files / 57 tables listed; clean-room grep 0; report: applied on PG 16.4 (PGlite) + RLS smoke test. Docker apply run by orchestrator 2026-11-10: all 14 files rc=0 on PostgreSQL 16.15, 0 tenant tables without RLS | committed on main | docs/reports/P2-DATA.md |
| P2-ARCH | 14 ADRs + overview + conventions read (statuses, decisions); clean-room grep 0; mermaid not rendered | committed on main | docs/reports/P2-ARCH.md |
| P1-SCOPE | SCOPE.md read: 102 rows with MVP? boxes (10 L0, 13 MVP, 39 v1, 30 later, 10 out/dropped); legacy mapping present; clean-room grep 0; D57–D63 added | committed on main | docs/reports/P1-SCOPE.md |
| P1-API | report read; clean-room grep 0 (yes4all/y4a/codenames); SP-API names checked vs catalog/spapi | committed on main | docs/reports/P1-API.md |

## Blocked / waiting

| Task | Waiting on | Since |
| --- | --- | --- |

## Next runnable

- After P3-SCAFFOLD: P5-REVIEW (+ gate re-run), merge, then P3-CLIENTS ∥ P3-DS.

## Log

- 2026-10-14 — kit created.
- 2026-10-14 — R4 done: `refs/amazon-ads` mirrored (223 specs incl. 18 Ads MCP tool groups, 807
  docs pages, 0 failures). Added P1-CONSOLE (Amazon Ads console as feature reference, D51), the
  ads-api → Amazon call map in P1-API (D52), the MCP doc in P1-ADS (D50), D53 (v0 vs v1).
- 2026-10-14 — User decided D50 = c, D53 = v1 (v0 only as named exceptions). Prompts P1-ADS,
  P1-API, P2-ARCH updated.
- 2026-10-14 — Kit committed on `main` and pushed to `origin` (D7). P0 steps 1–2 are done; P0
  still runs `fetch-refs.ps1` (refs/amazon is not fetched yet) and the legacy-path check.
- 2026-11-02 — PO/Lead Architect brief received (Devin session). Inventory done: refs/amazon not
  fetched, Docker Desktop off, stray empty `seller-hub/` folder. Wrote `docs/ANALYSIS.md`; added
  D54–D56 (FE test stack, RBAC model, market-product benchmark). Gate 0 still OPEN; asked user.
- 2026-11-02 — User rule: table loading skeletons must match the real table shape per entity tab
  (columns, widths, row height, row count = pageSize, toolbar/totals/pagination), not just row
  height. Recorded in `prompts/p3-design-system.md` (scope + done-when). P1-WEB already inventories
  the legacy skeleton rule.
- 2026-11-09 — Orchestrator now runs in Claude desktop on Opus 5.5 (resolves ANALYSIS risk 5).
  User accepted the orchestrator's picks: D0 a, D1 c, D2 a, D3 a (TS), D4/D6/D8 default, D5
  **Seller + Vendor**, D9 no, D54 a, D55 a, D56 yes. G0 passed (R1 Docker deferred to P3; R3
  checked; R11 given: Ads console Campaign Builder URL + Vendor Central Promotion Central URL).
- 2026-11-09 — P0 done: `refs/amazon` fetched (6 repos, see VERSIONS.txt; 57 SP-API models incl.
  10 `vendor-*`), legacy dirs readable (listed only), stray `seller-hub/` removed. Added P1-VENDOR
  (`prompts/p1-vendor-console.md`) for D5; runs after P1-CONSOLE (one Chrome driver).
- 2026-11-09 — User asked to reuse SP-API credentials from ads-api's env: refused (CLAUDE.md
  forbids opening legacy `.env*`; Yes4All credentials need written consent, D30).
- 2026-11-09 — Started P1 group (6 sessions). User touched P1-CONSOLE's tab; session recovered,
  nothing saved. User says that Ads profile is a test account where creating is allowed —
  candidate for D30 write tests at G3 (to confirm then).
- 2026-11-09 — All six P1 sessions reported DONE. Verification: both catalog builders re-run clean
  with no diff. Clean-room grep found ~480 Yes4All-specific names (proxy headers, schema/table and
  rule-engine codenames) in `catalog/legacy/**` → sent back to P1-API to neutralise; P1-WEB sent to
  cross-check endpoints now that P1-API's catalog exists. Nothing committed yet (waits for those).
- 2026-11-09 — P1-API neutralised internal names (grep 0); P1-WEB cross-check: 188/194 calls match,
  5 go to other services, 95 backend routes unused by any screen. Committed all six P1 outputs.
- 2026-11-09 — P1-VENDOR done (CA Direct Fulfillment account). Vendor promotions/coupons are
  console-only (no SP-API); vendor API surface = POs, shipments, invoices, transaction status, DF
  (RDT-restricted), 8 GET_VENDOR_* reports. Open questions passed to P1-SCOPE. Committed.
- 2026-11-10 — P1-SCOPE's first turn stopped on the 5-hour usage limit before writing any file;
  resumed in the same session (told to write SCOPE.md section by section). P1-API also showed a
  limit error, but its outputs were already verified and committed (36e7aa6) — no action.
- 2026-11-10 — P1-SCOPE done on its second turn: `docs/SCOPE.md` (102 feature rows, slice L0 +
  proposed MVP, legacy/console mapping, risks, SP-API roles) and D57–D63 (OPEN). Committed. G1 open.
- 2026-11-10 — User: `duyệt` with the proposed answers. D10 = 23 rows ticked in SCOPE.md (L0 + MVP),
  D11 no, D57–D63 = a (D59 a pending an account with SP/SD campaigns). G1 passed. Started P2-ARCH.
- 2026-11-10 — P2-ARCH reported NEEDS_DECISION: overview, conventions, ADR-0001…0014 written
  (Fastify 5, pnpm + Turborepo, Better Auth core in the API, envelope-encrypted credential vault,
  generated types + own transport for Amazon, BullMQ, REST/OpenAPI 3.1 contract-first). New D64
  (retention); ADR-0014 Proposed until D21. Committed. Asked user for D21, D64.
- 2026-11-10 — User: defaults for D21 (compose self-host + AWS cloud) and D64 a (retention).
  ADR-0014 status set to Accepted, pending Gate 2. Started P2-DATA; Docker engine not running, so
  its Postgres apply check may be SKIPPED and re-run by the orchestrator later.
- 2026-11-10 — D65: Vendor Central is read-only for every session (user rule); added to CLAUDE.md.
- 2026-11-10 — P2-DATA done: `db/design/*.sql` (57 tables, L0 first), `docs/data-model/**`.
  Docker was off, so the native apply check is still owed; substitute check on PGlite 16.4 passed
  per its report (not re-run by the orchestrator). Committed.
- 2026-11-10 — User: `tiếp`. Started P2-BACKLOG. Docker still off.
- 2026-11-10 — P2-BACKLOG done: 15 slices in 5 waves (1a S01∥S02, 1b S03 = L0; then 2–5), 0 path
  overlaps per its checker. Committed. G2 open. Docker still off.
- 2026-11-10 — User: `duyệt`. G2 passed (D20). ADR-0001…0014 Accepted; Gate 2 amendments appended to
  ADR-0001/0002/0003/0008/0010 and conventions; PLAN.md (P3 OWNED_PATHS, P4 waves), CLAUDE.md layout,
  prompts p3-amazon-clients / p3-ingestion-engine (no Reporting v3) / p4-slice updated per P2-BACKLOG.
- 2026-11-10 — Docker up (28.0.1). Owed check done: `db/design/*.sql` applied in order on a throwaway
  postgres:16 container (16.15), every file rc=0; container removed. Note: legacy container
  `ads-api-cache-1` holds host port 6379 — seller-hub compose must not use default ports.
- 2026-11-10 — Started P3-SCAFFOLD (worktree, branch p3-scaffold).
- 2026-11-11 — P3-SCAFFOLD reported DONE on `claude/p3-scaffold-f31648` (3 commits, 150 files; `pnpm gate`
  green from a fresh clone per its report). Started P5-REVIEW (opus). QA skipped for this task (no feature UI).
- 2026-11-11 — P5-REVIEW-P3-SCAFFOLD: MERGE-AFTER-FIXES. Blockers: BFF SSRF (B1), ESLint import fences
  overwritten (B2), cross-slice `$ref` rejected (B3), migration order across parallel merges (B4 → option a).
  Sent B1–B4 + S1–S8 back to p3-scaffold; S3 decided: keep DEV-ONLY placeholders, fail closed in production.
  `scripts/stack.ts` and dev-setup.md added to the P3-SCAFFOLD PLAN row. Reviewer gate exit 0 but DB part
  SKIPPED (Docker down again).
