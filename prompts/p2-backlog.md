# P2-BACKLOG — Slices, waves and file ownership

Model: Sonnet · checkout: main · do not commit
OWNED_PATHS: `docs/BACKLOG.md`, `docs/reports/P2-BACKLOG.md`

## Goal

Cut the MVP into slices that several sessions can build **in parallel without touching the same
files**, each shippable and testable on its own.

## Inputs

`docs/SCOPE.md` (MVP ticks), `docs/adr/*`, `docs/architecture/*`, `docs/data-model/*`,
`catalog/legacy/web-features.json`, `docs/PLAN.md`.

## `docs/BACKLOG.md`

1. **Shared-file protocol** — how a slice registers routes, menu entries, API modules, contract
   files, migrations and sync definitions **by adding files, not editing shared ones** (file-based
   routing, a generated registry, timestamped migration names, per-module contract files bundled
   by a script). List the few shared files that remain, and give each a single owner (normally
   P3-SCAFFOLD; afterwards, the orchestrator decides). This protocol is what makes parallel waves
   safe; be concrete.
2. **Slices** — one entry each:
   - `ID` (S01, S02, …), name, goal (one sentence), SCOPE feature IDs.
   - `OWNED_PATHS` — exact directories and file globs.
   - Amazon APIs / reports / notifications used (catalogue references).
   - Tables and migrations it owns.
   - API endpoints (method + path) and screens (route + purpose).
   - Acceptance criteria — testable statements, including tenant isolation and failure behaviour
     (throttling, partial failures, empty data).
   - QA checklist — what a tester clicks and measures (the P5-QA session follows it).
   - `depends_on`, `wave`, size (S/M/L), effort for the session (`medium`, or `high` if it writes
     to Amazon).
3. **Waves** — a table: wave → slices. Within a wave, no two slices share an OWNED_PATH. Wave 1 is
   the thinnest end-to-end slice (connect seller → sync listings → listing screen) if P3 does not
   already deliver it.
4. **Overlap check** — a table proving no path appears in two slices of the same wave.

## Done when

Every MVP feature ID is in exactly one slice; every slice has acceptance criteria and a QA list;
the overlap check is clean.
