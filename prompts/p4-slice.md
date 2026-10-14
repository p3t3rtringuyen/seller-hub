# P4-<SLICE> — Feature slice

Model: Sonnet · checkout: worktree (commit on your branch)
Parameters from the brief: `SLICE_ID` (e.g. S03). Everything else comes from that slice's entry
in `docs/BACKLOG.md`: OWNED_PATHS, APIs, tables, endpoints, screens, acceptance criteria, QA list.

## Goal

Ship the slice end to end — data from Amazon into our tables, through the API, onto the screen —
inside your OWNED_PATHS, using the shared packages rather than re-solving their problems.

## Read first

1. Your BACKLOG entry, and the shared-file protocol at the top of `docs/BACKLOG.md`.
2. `docs/architecture/conventions.md`; the ADRs your slice touches.
3. `docs/data-model/mapping.md` rows for your tables.
4. The catalogue entries (`catalog/spapi/*`, `catalog/ads/*`) for every operation you call — rate
   limits, restricted flags, media types, 207 behaviour.
5. READMEs of `packages/amazon-*`, `packages/ingestion`, `packages/ui`, `packages/contracts`.
6. If the slice has a legacy counterpart: its entry in `catalog/legacy/web-features.json` and the
   business rules in `docs/discovery/legacy-api-domain.md`. Requirements only — do not open
   legacy source to copy.

## Build, in this order

1. **Contract** — your module's OpenAPI file; generate the client.
2. **Migrations** — your tables only, per the protocol.
3. **Sync definitions** — for the data you read; fixtures shaped from the catalogue or sandbox.
4. **API module** — repository (always tenant- and seller-account-scoped), service (business
   rules, validation with per-marketplace limits), handlers. **Writes to Amazon** go through the
   client packages, write an audit-log row and a change-history row, handle 207 partial failure
   per item, and require confirmation for bulk or destructive actions.
5. **Screens** — from `packages/ui` only; copy and option labels in a constants module; tab /
   sub-tab / modal state in the URL where the protocol says so.
6. **Tests** — service rules (unit); repositories against Postgres including a cross-tenant
   test; contract tests; sync definitions from fixtures; one Playwright happy path per screen.
7. **Docs** — `docs/modules/<slice-id>.md`: what it does, data flow, sync schedule, known limits,
   and the QA checklist from the BACKLOG, refined to what you built.

Commit in small Conventional Commits as you go (`feat(<slice-scope>): …`).

## Done when

Every acceptance criterion is met and named in your report with the test that proves it; the gate
command is green; `git diff main...HEAD --stat` shows nothing outside OWNED_PATHS.

## Stop and ask

- You need a change outside OWNED_PATHS (a shared package, another slice's table) → `BLOCKED`
  with the exact change; do not make it.
- Amazon behaves differently from the catalogue or the docs → `NEEDS_DECISION` with what you
  observed.
- An acceptance criterion is ambiguous or contradicts an ADR → `NEEDS_DECISION` with options.
