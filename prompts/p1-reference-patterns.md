# P1-REF — Amazon reference patterns and feature ideas

Model: Haiku · checkout: main · do not commit
OWNED_PATHS: `docs/discovery/reference-patterns.md`, `docs/discovery/feature-ideas.md`,
`docs/reports/P1-REF.md`

## Goal

Summarise how Amazon's own samples, SDK and agentic toolkit solve the problems seller-hub will
face, so the architects reuse proven patterns. Read and summarise; run nothing.

## Inputs (read-only — never run scripts, never install dependencies)

- `refs/amazon/selling-partner-api-samples/use-cases/*` — e.g. `website-authorization`,
  `auth-lifecycle-management`, `lwa-rotation`, `notifications`, `data-kiosk`, `listings`,
  `pricing`, `fulfillment-inbound`, `fulfillment-outbound`, `merchant-fulfillment`,
  `aplus-content-manager`, `amazon-data-kiosk-mcp-server`, `sp-api-dev-mcp`. Also `code-recipes/`
  and `labs/` (skim).
- `refs/amazon/selling-partner-api-sdk/` — root README, `docs/`, and the README of the language
  folder matching D3 (`javascript/` for TypeScript).
- `refs/amazon/selling-partner-agentic-toolkit/` — `skills/*/SKILL.md`, `commands/`, README.
- `refs/amazon/selling-partner-api-postman/` — README and collection names.

## Outputs

`docs/discovery/reference-patterns.md`, one section per pattern:
- Problem it solves; Amazon APIs used; infrastructure (AWS services); the steps in order;
  gotchas the sample calls out; the files to read (paths under `refs/`).
- Then: how seller-hub would adopt it with the D3 stack, in 2–4 lines.
- An SDK section: what the official SDK for our language gives us (LWA token handling, rate
  limiter, Restricted Data Token support, per-API packages) and what we must build ourselves.
- A Postman section: which collections are useful for manual sandbox checks.

`docs/discovery/feature-ideas.md`, one entry per toolkit skill and command (seller analytics,
month-end finance close, stockout prevention, FBA inbound management, listing troubleshooting /
issues / buyability / searchability / compliance, secondary-user invites, support cases, …):
- user story ("As a seller I want …");
- data and APIs it needs;
- which writes need a human approval step;
- whether it fits a classic screen, an AI assistant, or both.

## Done when

Every folder under `use-cases/` and every skill has a section; each cites its files.
