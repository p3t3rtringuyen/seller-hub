# P3-IDENTITY — review (P5-REVIEW-P3-IDENTITY)

Reviewer: Opus 5.5, main checkout, read-only. Branch `refs/heads/claude/p3-identity-8a0f9d` at `657c756` (11 commits,
107 files, +10 275 / −149). Reviewed against `docs/PLAN.md` (P3-IDENTITY row), `docs/DECISIONS.md` (D30, D55, D66),
ADR-0003/0004/0005, the task report `docs/reports/P3-IDENTITY.md` (on the branch).

## Verdict: **MERGE-AFTER-FIXES** (prompt wording: CHANGES_REQUIRED)

0 blockers · 4 major (must fix before merge) · 9 minor (2 cheap ones recommended now, the rest are BACKLOG follow-ups).

The security design is sound and mostly well executed: opaque 32-byte tokens hashed at rest, httpOnly `__Host-` cookies
behind https, Origin + double-submit CSRF with constant-time compare, `x-sh-*` and `Set-Cookie` stripped in the BFF,
OAuth `state` hashed, bound to tenant + user + seller account, single use, 10 min, redirect URI fixed server-side
(not client-supplied, so no allow-list is needed), `SH_AMAZON_MODE` unset = replay, AES-256-GCM envelope vault with
AAD and fail-closed key loading, atomic single-use setup token, invitation token hashed and carried in the URL
fragment, last-owner rule, sessions revoked on role change and removal. No SSRF regression: the BFF still goes through
the unchanged `bffTarget()` and sends a fresh header whitelist upstream.

What blocks the merge is one availability defect that affects the whole API, a weak sign-in throttle, and two
functional defects in the flows this task delivers (re-invitation and seller-account-scoped Admins).

## Must fix before merge

### M1 — major · argon2 blocks the API's event loop (unauthenticated DoS)
`modules/platform-auth/src/crypto.ts:8-25` (`hashPassword`, `verifyPassword`, `dummyHash`).
hash-wasm runs argon2id synchronously inside its promise. Measured on this branch's `hash-wasm` with the same params
(19 MiB, t=2, p=1): **10 hashes = 999 ms with 0 ticks of a 1 ms timer**, so ~100 ms per hash with the event loop frozen.
`POST /v1/auth/sign-in` is `x-scope: none` and always verifies a hash (the dummy hash for unknown e-mails, by design).
Failure scenario: 10 sign-in requests per second with random e-mails keep the single API process ~100 % blocked —
every other request (`/readyz` included, so the container may be restarted) stalls. Cloudflare Access shields the D66
staging, but this ships to every later deployment.
Fix: run argon2 off the main thread (a small `worker_threads` pool, or `@node-rs/argon2` marked `external` in tsup and
shipped next to the bundle) and cap concurrent hashes with a semaphore that answers 429/503 when the queue is full.

### M2 — major · sign-in throttle can be bypassed three ways
`modules/platform-auth/src/service/platform-auth/login-limiter.ts:135-156`, `identity-service.ts:179-195`,
`apps/web/lib/bff-security.ts:107`.
1. **No per-IP limit by default.** `clientIp()` returns null unless `SH_TRUST_PROXY=1` (default `0`); the API then
   skips the IP counter entirely (`if (ip)`). Only the per-e-mail counter remains, so password spraying (one password
   × many e-mails) is unlimited.
2. **Global reset.** When either map exceeds 10 000 keys it is `clear()`ed (lines 151-152). An attacker who records
   10 000 failures with distinct e-mails (trivial without an IP limit, see 1) wipes every counter, the target's
   included, and continues guessing.
3. **Check-then-record race.** `retryAfterMs()` runs before the awaits (DB lookup, ~100 ms argon2) and `failure()` only
   after them, so N parallel requests for one e-mail all pass the check: 200 concurrent guesses against
   `owner@tenant` are all evaluated although the budget is 8.
Fix: record the attempt (reserve the slot) before verifying and clear it on success; evict oldest entries instead of
`clear()`; fall back to a global (or socket-address) bucket when no client IP is known. The Redis-backed limiter can
stay a P6-SEC follow-up, but these three are cheap.

### M3 — major · a user without an active membership can never accept an invitation; failed registration leaves an orphan
`identity-service.ts:203-209` with `apps/web/features/platform-auth/platform-auth/AcceptInvitation.tsx:52-53`;
`identity-service.ts:291-312`.
The accept page signs an existing account in first (`POST /v1/auth/sign-in`), and `signIn` refuses with
`no_active_membership` when the user has no active tenant. `registerWithInvitation` refuses because the account exists.
Failure scenario: an Owner removes Bob (his only tenant) and later re-invites him → Bob opens the link, enters his
password → 403 `no_active_membership`; he cannot register either (`account_exists`). Permanent lockout of that e-mail.
Same end state when `acceptInvitationNewUser` fails after `createCredentialUser` (invitation revoked/expired in the
~100 ms hashing window, DB error): the user row stays, unlike `setup()` which deletes it on failure.
Fix: give the accept page one operation that verifies the password and accepts the invitation in the same call (no
membership needed beforehand), and create the user + membership in one transaction (or delete the user on failure, as
`setup()` does). Add an API test for "removed member re-invited".

### M4 — major · seller-account-scoped Admins can start the Ads connection but not finish it
`contracts/modules/platform-connections/platform-connections.yaml:71-75` (`completeAdsAuthorization`: `x-scope: tenant`,
`x-permission: connections.manage`), `modules/platform-tenancy/src/access.ts:24-30`.
At tenant scope a member who holds only seller-account grants gets the `viewer` floor, which lacks
`connections.manage`. D55 scopes roles per seller account. Failure scenario: Carol is Admin of seller account S only →
`POST /seller-accounts/S/connections/ads/authorize` succeeds (seller-account scope), Amazon redirects back, the callback
POST answers **403** and the state is never consumed; Carol cannot connect Ads for the account she administers. The
e2e and API tests only cover a tenant-wide Owner/Admin.
Fix: keep the route at tenant scope with a read permission (`session.read`) and, after `consumeState`, check in the
service that the caller holds `connections.manage` on `consumed.sellerAccountId` (`tenancy.access(...)` + matrix),
answering 404/403 as for the other account routes. Add the scoped-admin case to `apps/api/test/identity.test.ts`.

## Minor — recommended now (one-line fixes)

### m1 — invitation acceptance does not re-check that the invitation is still open
`modules/platform-tenancy/src/repository/platform-tenancy/tenancy-repository.ts:342-343`. `markInvitationAccepted`
updates by id only and ignores the row count; `findOpenInvitation` ran earlier, outside the transaction. Scenario: an
Admin revokes a leaked link while its holder submits → the membership is created anyway and the revoked invitation is
marked accepted. Fix: `and accepted_at is null and revoked_at is null and expires_at > now()`, throw
`invitation_invalid` when 0 rows.

### m2 — last-owner rule races between two concurrent changes
`tenancy-service.ts:203` and `:229` (`countOwners` after the change, READ COMMITTED). Two Owners demoting each other at
the same time each count one remaining owner and both commit → tenant with zero owners. Fix: lock the tenant row
(`select … from core.tenants where id = $1 for update`) at the start of both transactions.

## Minor — may fix later (BACKLOG follow-ups)

- **m3 · forwarded-IP trust** — `apps/web/lib/bff-security.ts:107-111`. With `SH_TRUST_PROXY=1` the leftmost
  `X-Forwarded-For` is used when `CF-Connecting-IP` is missing; both are client-controlled if the web port is reachable
  without the tunnel → forged audit IPs and per-IP throttle evasion. Use only the header of the configured proxy;
  P3-STAGING must bind web to the tunnel only.
- **m4 · API trusts `x-sh-client-ip` / `x-sh-user-agent` from any caller** — `auth-handlers.ts:26-32` (file lines).
  Safe only while the API is reachable by the BFF alone. In compose the API must listen on `0.0.0.0` inside the private
  network for the web container, so the docker network is the only boundary: P3-STAGING must not publish the API port.
  Later: a shared BFF→API secret.
- **m5 · production does not require an https public URL** — `packages/config/src/env.ts:110`. With `NODE_ENV=production`
  and `SH_WEB_PUBLIC_URL` unset, cookies lose `Secure`/`__Host-`, invitation links and the Ads redirect URI point at
  `http://127.0.0.1` (writes fail the Origin check, so it fails closed, but only by accident). Require `SH_WEB_PUBLIC_URL` starting with `https://` in production.
- **m6 · dev master key accepted through the key ring** — `env.ts` production check covers `SH_MASTER_KEY` only;
  `SH_MASTER_KEYS=k1:<dev placeholder>` passes in production (`modules/platform-connections/src/vault/envelope.ts:104-115`).
  Reject DEV_ONLY values in `envKeyProvider` too.
- **m7 · seller-account-only members can list every member of the tenant** — `members.read` at tenant scope + the
  `viewer` floor (`access.ts:29`): an Analyst scoped to one account sees all members' e-mails and grants. Confirm
  against D55 or filter by visible accounts.
- **m8 · SP-API token not bound to the seller account's identity** — `connections-service.ts:187-221`. Any valid
  refresh token is stored on any seller account; `selling_partner_id` is neither checked nor recorded. Data-integrity
  follow-up for when live mode (D30) arrives.
- **m9 · `SH_AMAZON_MODE=sandbox` is partly live** — the Ads base URL ignores sandbox and LWA is always live
  (`packages/amazon-core/src/regions.ts:68-72`, P3-CLIENTS code, used by this task's flows). Staging must stay on replay
  (unset); document it in the P3-STAGING brief.

## Ownership (files outside the PLAN row)

All are listed in the task report and each is justified; none is gratuitous:
`apps/api/src/main.ts` (composition root; BACKLOG §1.3 names this task), `apps/api/test/{identity,api}.test.ts`
(scaffold guard test narrowed to example/system operations — acceptable because `identity.test.ts` covers the platform
operations over HTTP), `apps/web/app/bff/**` + `apps/web/lib/{bff-security,bff-server,api-client,copy}.ts` (the real
BFF the scaffold left to this task; `copy.ts` is missing from the report's shared-file table), `app/(shell)/session.tsx`,
`shell.test.tsx`, `vitest.config.ts`, `next.config.ts` (security headers), `apps/web/features/**` and
`apps/web/messages/**` (the layout CLAUDE.md prescribes for slice UI), `playwright.config.ts`, `e2e/global-setup.ts`,
`e2e/smoke/smoke.spec.ts`, `packages/config/src/env.ts`, `.env.example`, `package.json`, `pnpm-workspace.yaml`,
`pnpm-lock.yaml` (hash-wasm catalog entry + 4 workspace packages). Style note: `apps/api/src/main.ts` imports
`../../../modules/*/src/public/*` by relative path instead of the package names.

## Decisions for the orchestrator (not defects)

1. **Better Auth not used** (report item 1). ADR-0004 decision 1 explicitly chose Better Auth over "hand-written argon2
   + session table". The hand-written code is small and competent, but this is an ADR amendment the user/orchestrator
   must take; if accepted, P6-SEC review of the in-house identity code becomes mandatory and e-mail verification,
   reset and TOTP (ADR-0004: "TOTP optional per user, enforceable per tenant") are open work. `tenants.require_two_factor`
   is exposed in `/v1/me` but enforced nowhere.
2. Report items 2–5 (vault location, env names, service container, permission names) look reasonable.

## Checks

| Check | Result |
| --- | --- |
| Static review of the full diff (`git diff main...<branch>`), auth, tenancy, connections, audit, BFF, contracts | done |
| `npx vitest run test/vault.test.ts` (platform-connections) | 12 passed |
| `npx vitest run test/access.test.ts` (platform-tenancy) | 10 passed |
| `npx vitest run lib/bff-security.test.ts` (apps/web) | 10 passed (the report says 11) |
| argon2 event-loop probe (hash-wasm 4.12.0, task params, 10 parallel hashes) | 999 ms, 0 timer ticks |
| `pnpm gate`, DB tests, `pnpm e2e` | **skipped** — the brief forbids starting a stack (others are running); the task report claims a green gate with `SH_REQUIRE_DB=1` and 6 e2e passes. The P5-QA session running on this branch can confirm. |

## Follow-ups for BACKLOG

m3–m9 above; Redis-backed throttle; session purge job; CSP; 2FA / reset / verification per the ADR-0004 decision;
bundle-safe `loadFixtureDir` (task follow-up 4).

---

## Re-review 1 — branch tip `66ca5a2` (fix round 1: `e44b53f`, `e469946`, `739b17d`, `595456e`, `66ca5a2`)

### Verdict: **MERGE**

All four majors and the five minors scheduled for this round (m1, m2, m4, m5, m6) are fixed correctly and each has a test
aimed at the defect. The four QA fixes look right. No regression found that blocks the merge. Five new remarks below,
all minor or informational; they can go to the BACKLOG or into the P3-STAGING brief. Deferred on purpose and not
re-checked: m3, m7, m8, m9, the ADR-0004 question.

### Items checked

| Item | Verdict | Notes |
| --- | --- | --- |
| M1 argon2 on the event loop | fixed | `crypto.ts`: `node:crypto.argon2` (async, libuv pool; parameter names match Node's API) behind a semaphore (4 running, 32 queued, then `server_busy`). The slot is handed to the next waiter without decrementing, which is correct. Stored PHC strings from hash-wasm still verify; costs in a stored string are capped; tags compared with `timingSafeEqual`. `crypto.test.ts` asserts the timer ticks during hashing. See r1 for the fallback. |
| M2 throttle bypasses | fixed | `reserve()` counts the attempt before any await (parallel guesses count); an IP bucket always exists (`unknown`, 200/15 min); LRU eviction (entry deleted and re-inserted on each attempt) instead of `clear()`, so a spray evicts the target only after 10 000 newer keys, and the per-IP budget makes that expensive. Success clears only the e-mail counter. See r2. |
| M3 re-invited user locked out / orphan | fixed | New public op `acceptInvitationWithPassword` (contract + route + UI): the invitation is previewed, the password is checked through the same throttled `checkCredentials`, the user joins and gets a session, and no membership is needed beforehand. `acceptInvitationNewUser` deletes the user it created when acceptance fails. API test "removed member re-invited". |
| M4 scoped Admin cannot finish Ads | fixed | Callback is now `session.read` at tenant scope; after `consumeState` (already bound to the user), `tenancy.can(user, tenant, state.sellerAccountId, "connections.manage")` answers 404 otherwise. Tenant-wide Admins/Owners still pass because tenant-wide grants apply to every account. The state is burnt on denial, which is fine. API test covers the scoped Admin (own account only). |
| m1 invitation re-check | fixed | `markInvitationAccepted` guards `accepted_at/revoked_at/expires_at`, 0 rows → `invitation_invalid`, transaction rolls back the membership. Test for revocation during submission. |
| m2 last-owner race | fixed | `select … for update` on the tenant row at the start of `setMemberRoles` and `removeMember`. Concurrency test (exactly one demotion wins). |
| m4 forged client headers | fixed | API honours `x-sh-client-ip`/`x-sh-user-agent` only with a matching `x-sh-bff-secret` (constant-time); without a configured secret it trusts only outside production. The BFF sends the secret. API test. |
| m5 https in production | fixed | `loadConfig` refuses production without an `https://` `SH_WEB_PUBLIC_URL` and without `SH_BFF_SECRET` (≥ 32 chars). Test. |
| m6 dev key in the ring | fixed | `envKeyProvider` refuses any ring key equal to a DEV_ONLY value in production. Test. |
| QA: `main` landmark | fixed | `AuthCard` renders `<main>`. |
| QA: localhost vs 127.0.0.1 | fixed, acceptable | In plain-http mode only, the request's own origin is also accepted (see r4); behind https only `SH_WEB_PUBLIC_URL`. The double-submit token is still required. The 403 now explains which address to open. |
| QA: ContextSwitcher hydration | fixed, plausible | Stable ids on the three selects. `packages/ui/src/shell/ContextSwitcher.tsx` is a P3-DS file outside the row; the change is minimal and justified. Verified only by the e2e console assertion, as the report itself says. |
| QA: sign-in keeps the old session | hardened | `issueSession` revokes the caller's bearer token (`previousToken`) after the new session exists. Double revocation in `switchTenant`/`acceptInvitationSignedIn` is harmless. API test. |

### New remarks (non-blocking)

- **r1 · minor — the silent hash-wasm fallback brings M1 back on Node 24.0–24.6.** `crypto.ts` falls back to the
  blocking WebAssembly argon2 when `node:crypto.argon2` is missing, while `package.json` `engines` says `node >=24`.
  Fix: `engines: ">=24.7"` and/or log loudly (or refuse in production) at boot when the native function is absent.
  P3-STAGING must pin a Node image ≥ 24.7.
- **r2 · minor — the shared `unknown` IP bucket lets anyone lock out all sign-ins.** When the API knows no client IP,
  every attempt shares one 200/15 min bucket, so 200 bad attempts block sign-in for everyone for 15 minutes. This
  happens when `SH_TRUST_PROXY=0` in production, or when the API has `SH_BFF_SECRET` and the web app does not (or has a
  different value). The web app never runs `loadConfig`, so nothing catches the mismatch. For P3-STAGING: set
  `SH_TRUST_PROXY=1` and the same `SH_BFF_SECRET` on web and api. Later: validate the web env at boot.
- **r3 · nit — misplaced doc comment.** `packages/config/src/env.ts`: the `SH_TRUST_PROXY` doc comment now sits above
  `SH_BFF_SECRET` (two stacked comments), so `SH_TRUST_PROXY` lost its own.
- **r4 · info — in plain-http mode the accepted origin comes from the Host header.** A DNS-rebinding page can pass the
  Origin check, but the real app's cookies are host-bound and the double-submit token is still required, so it can act
  only unauthenticated. Production cannot be plain http any more (m5), so this is dev-only.
- **r5 · info — flaky test, not from this task.** `packages/config/test/eslint.test.ts` failed once in my first run
  (machine under load from other stacks) and passed twice in a row afterwards.

### Checks (re-review)

| Check | Result |
| --- | --- |
| Static review of `git diff 657c756 66ca5a2` (29 files, +840/−101) | done |
| `vitest run test/crypto.test.ts` (platform-auth) | 4 passed |
| `vitest run test/vault.test.ts` (platform-connections) | 13 passed |
| `vitest run` (packages/config) | 11 passed on 2 of 3 runs (r5) |
| `vitest run lib/bff-security.test.ts` (apps/web) | 11 passed |
| `pnpm gate`, DB/API tests, e2e | **skipped**: no stack, per brief. The task report states gate exit 0 with `SH_REQUIRE_DB=1` and 7 e2e passed. |
