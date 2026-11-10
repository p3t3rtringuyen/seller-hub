# P1-SCOPE report — scope synthesis

Status: DONE. Main checkout, nothing committed (per CLAUDE.md). Model: Opus.

## What I did

Read CLAUDE.md, `prompts/p1-scope-synthesis.md`, `docs/DECISIONS.md`, `docs/ANALYSIS.md`, all nine
`docs/discovery/*.md`, all seven `docs/reports/P1-*.md`, the P1-API hand-over note, and the legacy / console /
vendor catalogues (`catalog/legacy/*.json`, `catalog/console/console-features.json`,
`catalog/vendor/vendor-features.json`) for the mapping. SP-API roles of the operations and report types cited
for the MVP were checked against `catalog/spapi/operations.json` and `catalog/spapi/roles.json`.

Wrote `docs/SCOPE.md` (Vietnamese, IDs and API names in English):

1. Tóm tắt (≤ 15 lines): coverage, relation to ads-web, proposed MVP and what it proves, top risks.
2. Feature matrix: **102 rows** with the requested columns and an `MVP? [ ]` checkbox, ordered by tier then
   dependency — `MVP·L0` 10, `MVP` 13, `v1` 34 + 5 vendor rows marked "v1 (ứng viên MVP)", `sau` 30,
   `ngoài` 7, `bỏ` 3.
   - **Lát 0 (ANALYSIS risk 4):** PLT-01 tenant/RBAC → PLT-03 Ads connect → PLT-04 marketplace context →
     PLT-05 ingestion → ADS-01 SP structure sync → ADS-02 v1 daily reports → ADS-03 Campaign Manager (read) →
     PLT-07 safe 207 write layer → AUT-01 one bid rule (preview+approve, caps, undo) → PLT-06 audit.
   - Rest of MVP: SP-API connect → listings sync + listing screen; SP ads parity (bulk, builder, campaign/ad
     group detail, search terms, portfolios); FBA inventory, sales metrics, orders without PII, finance
     transactions.
   - D56 benchmark ideas are v1 slices (AUT-02…09, FIN-03, INV-02, ORD-03); D50 → AI-01/02 v1, AI-04 own MCP
     server later; D5 vendor → VEN-01…06 + ADS-20 v1 (MVP candidates), VEN-07 promotions read-only roadmap,
     VEN-09 Direct Fulfillment out (RDT/D11).
3. Legacy mapping: all 26 ads-web screens + 12 non-feature routes, all external endpoint groups (212 routes)
   and internal groups (39 routes), all 25 jobs/consumers → feature ID or "bỏ (internal)" / "bỏ" with reason.
3b. Console mapping with "ads-web có?" column and parity conclusion. 3c. AI/MCP table with prerequisites.
4. Condensed replacement map and the gaps Amazon cannot fill (COGS, caps, owners, automation decisions,
   vendor promotions, B2B placement).
5. 17 risks/constraints. 6. SP-API roles for the MVP (PL, AF, IOT, FA; BA in v1; restricted roles not
   requested) + Ads scope. 7. Gate 1 questions D10, D11, D57–D63.

Appended **D57–D63** (OPEN) to "Phát sinh trong lúc làm" in `docs/DECISIONS.md`: v1 report coverage, Stream
v2/AWS, console second pass (SP/SD), vendor in MVP, vendor promotions, data freshness (replaces legacy
"real-time mode"), automation level of the MVP rule.

## Files

- Created: `docs/SCOPE.md`, `docs/reports/P1-SCOPE.md`.
- Changed: `docs/DECISIONS.md` (append only, D57–D63).
- `docs/STATUS.md` shows as modified in git status — not touched by me (orchestrator).

## Commands and results

- Node queries on `catalog/legacy/*.json` (route groups, 26 web entries, 12 non-feature routes, 25 jobs),
  `catalog/spapi/operations.json` / `roles.json` (roles of cited ops and report types) — read only.
- ID consistency: every feature ID referenced anywhere in SCOPE.md is defined in a matrix row (script:
  referenced − defined = empty); 102 distinct IDs, 102 checkbox cells.
- Clean-room grep on SCOPE.md for the legacy company and codenames → 0 matches.
- No build exists yet (pre-P3), so no gate commands.

## Checks skipped / limits

- Sizes (S/M/L/XL) are judgement, not estimates from a backlog (P2-BACKLOG will size slices).
- v1 report field coverage, Stream v2 account support, vendor Ads profiles and `alternateIds` were not verified
  live (no credentials, D30 open) — raised as D57/D58/D60 and in §5.
- Endpoint mapping is per route group (first path segment, sub-routes named where they map differently), not
  per individual route; every group is mapped.
- Discrepancy noted, not re-checked against raw specs: P1-REF lists SP keywords/negatives as v0; P1-ADS
  (domain-map) shows v1 Targets fold them in. SCOPE follows P1-ADS.

## Open questions

D10, D11, D57–D63 (SCOPE §7).

## Follow-ups

- After G1: update `docs/PLAN.md` with the AUT (rules) slice family and a `rules` worker module (ANALYSIS gap 5).
- P2 ADR: named v0 exceptions used by the MVP (EX-PORTFOLIOS, EX-EXPORTS, EX-TARGETING-RECS, EX-TARGETING-DISCOVERY,
  EX-PROFILES, EX-CHANGE-HISTORY).
- If D59 = a: second P1-CONSOLE pass on an account with SP/SD campaigns before P2-DATA.
