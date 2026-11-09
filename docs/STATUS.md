# STATUS

Owned by the orchestrator. Other sessions read only. Update before ending every turn.

- **Phase:** P1 — 6 of 7 discovery tasks done and committed; P1-VENDOR, then P1-SCOPE
- **Updated:** 2026-11-09
- **Waiting on user:** `tiếp` to start P1-VENDOR (needs Chrome free: close the stuck Display-builder
  tab, choose Leave); R5/R6 (own SP-API app, own Ads API LWA client); R1 Docker engine 500 (P3)

## Running

| Task | Session name | local id | Model | Checkout / branch | Ports / compose project | Started |
| --- | --- | --- | --- | --- | --- | --- |

## Done

| Task | Verified how | Merged / committed | Report |
| --- | --- | --- | --- |
| P1-SPAPI | builder re-run exit 0, catalog unchanged; 394 ops (352 seller, 42 vendor) | committed on main | docs/reports/P1-SPAPI.md |
| P1-ADS | builder re-run exit 0, catalog unchanged; 1,090 ops, 110 MCP tools / 18 groups | committed on main | docs/reports/P1-ADS.md |
| P1-CONSOLE | report read; entityId grep clean. Partial: account has SB only (SP/SD detail tabs, validation msgs, tooltips not covered) | committed on main | docs/reports/P1-CONSOLE.md |
| P1-REF | report read; competitor evidence partly secondhand (some pages blocked) | committed on main | docs/reports/P1-REF.md |
| P1-WEB | report read; 188/194 web calls match api-endpoints.json; JSON parses | committed on main | docs/reports/P1-WEB.md |
| P1-API | report read; clean-room grep 0 (yes4all/y4a/codenames); SP-API names checked vs catalog/spapi | committed on main | docs/reports/P1-API.md |

## Blocked / waiting

| Task | Waiting on | Since |
| --- | --- | --- |

## Next runnable

- P1-VENDOR (on user's `tiếp`, Chrome free), then P1-SCOPE after P1-WEB/P1-API follow-ups and P1-VENDOR.

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
