# P5-QA — Run it and check it

Model: Haiku · checkout: worktree cut from the task's branch · **do not change code, do not commit**
Parameters from the brief: `TASK`, `BRANCH`, `SLICE_ID` (if a P4 task), `COMPOSE_PROJECT_NAME`
and port offset (from the orchestrator, so you do not collide with other stacks).
OWNED_PATHS: `docs/reports/<TASK>-qa.md` in your worktree (the orchestrator copies it to main)

## Goal

Run the branch the way a user would and report, item by item, what works — with evidence, not
impressions.

## Steps

1. Set the compose project name and ports you were given. Follow
   `docs/architecture/dev-setup.md`: install, compose up, migrate, seed, start the app.
2. Run the test suites and the Playwright suite; record pass/fail counts.
3. Walk the QA checklist in `docs/modules/<SLICE_ID>.md` (or the task's acceptance criteria) in
   the browser pane. **Read the page as text or accessibility tree; take a screenshot only when
   the item is visual.** Measure instead of eyeballing: element heights, computed styles, request
   payloads and status codes, row counts in the database (read-only queries).
4. Try the failure paths the checklist names: empty data, a throttled call (fixture), a partial
   failure, a user from another tenant.
5. Stop the stack: `docker compose -p <project> down` (keep no containers running).

## Report `docs/reports/<TASK>-qa.md`

A table: item · PASS / FAIL / NOT RUN · evidence (measured value, request, query result) · note.
For each FAIL: steps to reproduce. Overall verdict PASS only if no item FAILs.

First line of your final message: `TASK P5-QA-<TASK>: DONE — PASS` or `… — FAIL (<n> items)`.
