# ADR-0011 — Writes to Amazon: commands, audit, confirmation, rule engine safety

Status: Accepted (Gate 2, D20, 2026-11-10) · Date: 2026-11-10 · Task: P2-ARCH

## Context

PLT-07 (L0): batch writes, 207 mapping by `index`, retry only failed items, outbox + reconcile, full record when
the API replaces, per-row results for the UI. PLT-06 (L0): audit of every write. AUT-01 (L0): one bid rule with
preview, approval or auto-run within caps (D63 a: default preview + approve; `rule+cap` only when Owner/Admin set
caps — max % change/day, bid floor/ceiling). ADS-04: bulk up to 300 campaigns / 100 children (UX-11).
Sources: `docs/discovery/ads-domains.md` §2 (207, `batchMax`, v0 `Prefer: return=representation`);
`catalog/ads/operations.json` (`multiStatus207`, `batchMax`); `catalog/legacy/web-ux-rules.json` UX-13/UX-14
(200 is untrusted; send the full record on replace); legacy traps 8 (handlers calling Amazon), 9 (dual-write
without outbox); D62 a (refresh after write).

## Options

| Option | For | Against |
|---|---|---|
| Synchronous call to Amazon inside the API request | simple; immediate result | request times out on big batches and throttling; crash mid-way leaves no record of intent (trap 9); rules need a separate path |
| **Command pattern: persist intent (command + items) and an outbox row in one transaction; worker executes; per-item results stored; mirror refreshed** | crash-safe; one path for users, rules and the assistant; natural audit; retries per item; UI can wait or poll | asynchronous UX (mitigated with `waitMs` and SSE) |
| Event-sourced entities | full history | far more machinery than needed; Amazon remains the source of truth anyway |

**Rule auto-run safety**
| Option | For | Against |
|---|---|---|
| Rules write directly when conditions match | simplest | one bad threshold changes thousands of bids |
| **Rules produce proposals (commands in `proposed` state); auto-approve only inside caps set by Owner/Admin; kill switches; dry-run** | D63 a; every rule action is reviewable, bounded and undoable | more states to build |

## Decision

1. **Model** (`ops` schema, P2-DATA designs columns):
   - `ops.commands`: id, tenant, seller account, `kind` (`ads.update-targets`, `ads.create-campaign-tree`,
     `ads.update-portfolios`, …), `source` ∈ `user | rule | assistant`, actor (user id or rule id), status
     (`proposed → approved → queued → running → succeeded | partially_succeeded | failed | cancelled | expired`),
     `dry_run`, `confirmation_hash`, `parent_command_id` (undo / retry), timestamps, `trace_id`.
   - `ops.command_items`: index, entity type + id (ours and Amazon's), `before` (snapshot from mirror at intent
     time), `desired` (patch), `sent` (actual payload), `after` (Amazon's returned / re-read state), status, error
     code/message, attempts.
   - `ops.audit_log`: append-only, one row per user-visible action (login, invite, connect, command created /
     approved / executed, rule changed, caps changed); who, what, when, scope, trace id; no secrets, no PII.
   - `ops.change_history`: one row per entity field change with `source` ∈ `user | rule | assistant | amazon`
     (`amazon` = changes seen by sync: v1 query diff or EX-CHANGE-HISTORY `getHistory`), feeding the History screen.
2. **Flow**: API validates (shape, permissions, marketplace limits from `ref`), snapshots `before`, inserts command
   + items + outbox in **one transaction**, returns **202**; an outbox relay enqueues `amazon-write` jobs (at-least-
   once; the executor is idempotent by command id + item status). With `waitMs` the API waits for completion up to
   that bound.
3. **Executor** (worker, per command kind a handler in `modules/<m>/src/commands/*.command.ts`):
   - chunks items by the operation's `batchMax`;
   - for **replace** semantics (v0 PUT, placement arrays as whole sets) builds the full record from a **fresh read**
     plus the patch (UX-14), never from a possibly stale mirror alone;
   - v1 update payloads carry only changed fields where the contract is a partial update;
   - calls through `amazon-core`; maps 207 by `index` to items; **retries only retryable failed items**
     (throttling, transient) with backoff; non-retryable errors are final per item;
   - on timeout / 5xx for a write, does **not** resend blindly: re-reads the entities and compares with `desired`
     (reconcile) — applied items are marked succeeded, others retried once;
   - writes `after`, statuses, `change_history` rows and an audit row; enqueues interactive refresh of touched
     entities (D62 a);
   - tree commands (ADS-08 create campaign → ad groups → ads → targets) run as ordered steps in one command; a failed
     step stops later steps and reports which entities exist on Amazon (no silent rollback; the UI offers "retry
     failed" or "archive created").
4. **Confirmation** (API): destructive kinds (archive = delete on Amazon, UX legacy "archive = DELETE"), and any
   command over a threshold (default > 20 items or budget change > 50 %) require a two-step call: `POST …/commands?
   dryRun=true` returns preview + `confirmationToken` (HMAC of the normalised payload, 10-min expiry); the real call
   without a matching token gets **428**. Double-submit protection: `Idempotency-Key` header required on command
   creation (409 on reuse with a different payload).
5. **Rule engine** (`modules/automation`, AUT-01):
   - rule definition: scope (seller account, campaigns/ad groups or all), condition (e.g. ACOS > X % over N days with
     clicks ≥ M — computed from `facts` only, only on complete days in the marketplace zone), action (decrease bid
     by Y %, floor Z), schedule, mode `preview_approve` (default) or `auto_within_caps`;
   - evaluator job → **rule run** → a command with `source=rule`, status `proposed`, items with before/desired and
     the metric evidence per item; nothing is sent in **dry-run** runs;
   - `auto_within_caps` is selectable only if Owner/Admin has set caps for that seller account (`automation.caps`):
     max % change per entity per day, bid floor and ceiling, max items per run, max runs per day. Items outside caps
     are clipped or left `proposed` for manual approval — never auto-sent;
   - **cooldown**: an entity changed by a user or another rule in the last 24 h (configurable) is skipped;
   - **kill switches**: per rule (disable), per seller account (`automation_paused`), per tenant, and global env
     `SH_AUTOMATION_DISABLED`; the executor checks them again right before sending;
   - **undo**: a command can be reverted by an inverse command built from item `before` values (for fields not
     changed since), itself audited.
6. **Permissions**: `ads.write` to create user commands; `commands.approve` to approve proposals; `automation.caps`
   (Owner/Admin) to enable auto-run; Viewer/Analyst never see write controls (UX-12/19).

## Consequences

- One write path for UI, bulk, rules and (later) the assistant; audit and history are a by-product.
- The UI shows a command result drawer: succeeded / failed / skipped per row, with "retry failed".
- Load on Amazon is bounded by the limiter and `batchMax`; rules cannot exceed caps even if misconfigured.
- P2-DATA must model `ops.*`; P4 write slices implement only their command handlers.

## Revisit when

Amazon adds idempotency keys to writes (simplifies reconcile), or automation needs cross-entity transactions
(e.g. budget moves between campaigns, AUT-05) — extend tree commands with compensation steps.
