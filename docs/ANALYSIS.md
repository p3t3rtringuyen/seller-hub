# ANALYSIS — repo state vs. product goal (2026-11-02)

Written by the PO / Lead Architect session. One page; superseded by `docs/SCOPE.md` (P1) and
`docs/architecture/**` (P2) once they exist.

## 1. Current state

| Area | State |
| --- | --- |
| Kit | `CLAUDE.md`, `docs/{PLAN,DECISIONS,RESOURCES,STATUS}.md`, 22 prompts in `prompts/`, 3 scripts. Committed (`36574af`). Working tree clean. |
| Phase | P0, waiting for Gate 0. D7, D50–D53 decided; D0–D6, D8, D9 OPEN. |
| Refs | `refs/amazon-ads/` mirrored (223 specs incl. Ads API v1 + 18 MCP tool groups, 807 docs). `refs/amazon/` (SP-API models) **not fetched** — P0 step 3 pending. |
| Legacy (R3) | `ads-web`, `ads-api` (Go), `ads-redesign` readable; declared in `.claude/settings.json` with `.env*` deny rules. |
| Tools (R1) | git 2.51, node 26.12 (kit asks 22 LTS — acceptable), pnpm 10.12, go 1.24.3. **Docker Desktop not running.** |
| Product code | None. `apps/`, `packages/`, `contracts/`, `catalog/`, `db/` do not exist yet (P3). Stray empty folder `seller-hub/` at repo root. |

## 2. Gaps between the new brief and the kit

| # | Brief says | Kit says | Resolution |
| --- | --- | --- | --- |
| 1 | Backend in **Go**, Postgres, Docker | D3 default (a) = TypeScript everywhere; (b) = Go | Decide D3 (brief implies (b)). P3 OWNED_PATHS (`apps/api/src/modules/…`) and `packages/amazon-*` become Go modules if (b). |
| 2 | **Sellers and Vendors** | D5 default = Sellers only | Decide D5. Vendor adds `vendor-*` SP-API roles, Vendor Central auth, different Ads account type. |
| 3 | Multi-tenant SaaS, many partners | D1 default (c) = multi-tenant schema, self-host first, public app after P6-SEC | (c) fits. Public developer approval (Amazon DPP audit) is the long pole for true SaaS. |
| 4 | Feature benchmark Pacvue/Perpetua, Adtomic, Skai | P1-REF has generic "reference patterns" | Add the three products as named inputs to P1-REF; output feeds `docs/SCOPE.md`. |
| 5 | Rule-based bidding, dayparting, keyword harvesting, budget pacing, inventory join, AI analytics | Not in PLAN; MVP scope is D10 (after P1) | Ensure P1-SCOPE lists them as candidate slices; add P4 slice families + a `rules` worker module to PLAN after G1. |
| 6 | Full RBAC, atomic design, Storybook + Vitest + Playwright | P3-DS/P3-IDENTITY prompts do not fix the test stack or role model | New decisions D54 (UI test stack), D55 (RBAC role model). |
| 7 | "Use every Ads API endpoint and MCP tool" | D53 = v1 default, v0 only as named exceptions; D50 = MCP client after MVP | Keep D53/D50. "Every" is a catalog goal (P1-ADS), not an MVP goal. |

## 3. Risks

1. **Amazon approvals gate reality.** Ads API access (R6) and SP-API app (R5) can take days–weeks;
   a public SaaS app needs Amazon's Data Protection review. Start R5/R6 now; nothing in P1–P3
   needs them.
2. **Go vs. TS cost.** With Go there is no official Amazon SDK: LWA, rate limiting (token bucket
   per operation), RDT, report polling and v1 client must be generated/written (oapi-codegen from
   the mirrored specs is viable). TS/Go split also means two type systems joined only by OpenAPI
   codegen — contract-first discipline becomes mandatory.
3. **Ads API v1 is new.** Some domains (portfolios, budget rules, …) are v0-only; every exception
   must be named (D53) or the data model drifts.
4. **Scope breadth.** The three benchmark products together are years of work. Without a thin
   end-to-end slice first (connect → sync campaigns → show → one bid rule), P4 waves will stall.
5. **Operational.** This session (Devin) has no `mcp__ccd_session__*` tools; it cannot start
   Claude-desktop sessions as `prompts/00-orchestrator.md` assumes. Options: the user runs the
   orchestrator in Claude desktop with this brief, or this session runs role tasks as subagents
   on git worktrees. Needs the user's choice.
6. **Environment.** Docker Desktop is off; `refs/amazon` not fetched; empty `seller-hub/` folder
   should be removed before P3-SCAFFOLD.

## 4. Immediate next steps

1. User answers Gate 0 (D0–D6, D8, D9) + D54–D56; confirms R1 (start Docker) and R11.
2. Orchestrator finishes P0 (fetch `refs/amazon`, legacy-path check, remove stray folder), then
   starts the P1 group (6 sessions in parallel; P1-CONSOLE drives Chrome).
3. After G1, update PLAN with the automation/rules slice families and Go/TS layout per D3.
