# P5-REVIEW — Code review gate

Model: Opus · checkout: main, **read-only** (do not edit code, do not commit)
Parameters from the brief: `TASK` (the reviewed task id), `BRANCH`.
OWNED_PATHS: `docs/reports/<TASK>-review.md` only

## Goal

Decide whether `BRANCH` may merge. Find what is wrong, show how it fails, rank it. You are the last
reader before main.

## Read

- `git diff main...<BRANCH>` and `git log main..<BRANCH>`.
- The task's report `docs/reports/<TASK>.md` (on the branch: `git show <BRANCH>:docs/reports/<TASK>.md`),
  its BACKLOG entry or PLAN row (OWNED_PATHS, acceptance criteria), the ADRs and conventions it
  touches, and the catalogue entries for the Amazon operations it calls.

## Check

1. **Acceptance** — each criterion met, and proven by a test that would fail without the code.
2. **Ownership** — no file outside OWNED_PATHS.
3. **Tenancy** — every query scoped by tenant and seller account; the cross-tenant test exists
   and is real.
4. **Secrets and PII** — no token, credential or buyer data in logs, errors, fixtures or commits;
   restricted operations only through the RDT path and only if D11 allows.
5. **Amazon usage** — rate limits respected through the shared limiter; retries only where
   idempotent; pagination tokens followed to the end; 207 partial failures surfaced per item;
   report and stream data keyed to the marketplace-local date; region routing.
6. **Data** — migrations reversible or explicitly forward-only with a reason; indexes for the list
   queries; upserts on the natural key; no N+1 on list endpoints.
7. **Contract** — handlers match the OpenAPI; HTTP status is the real one.
8. **UI** — built from `packages/ui`; the UX rules (cells, skeletons, numeric fields, URL state).
9. **Tests and gate** — run the gate command yourself in the task's worktree (find it with
   `git worktree list`) and report the result.

## Output

`docs/reports/<TASK>-review.md`: verdict `APPROVE` or `CHANGES_REQUIRED`; findings ranked most
severe first — `file:line`, the problem, a concrete failure scenario (input → wrong result), the
fix in one or two sentences. Separate "must fix" from "may fix later" (the latter become BACKLOG
follow-ups). No style nitpicks a linter would catch.

First line of your final message:
`TASK P5-REVIEW-<TASK>: DONE — APPROVE` or `… — CHANGES_REQUIRED (<n> must-fix)`.
