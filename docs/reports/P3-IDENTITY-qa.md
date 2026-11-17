# P5-QA-P3-IDENTITY — QA run of the P3-IDENTITY branch

Task: P5-QA-P3-IDENTITY · Model: Haiku 5.5 · Checkout: worktree `p5-qa-p3-identity-822883` (branch `claude/p5-qa-p3-identity-822883`, HEAD `657c756`, which holds the P3-IDENTITY commits and its report; the brief named `claude/p3-identity-8a0f9d`, which is not a local ref here).
Stack: `COMPOSE_PROJECT_NAME=sellerhub_qaidentity`, `SH_PORT_OFFSET=300` (Postgres 55732, Redis 56679, API 4400, web 3400). `SH_ENV_FILE=.env.example`, `SH_AMAZON_MODE` unset (replay/mock; nothing called live Amazon). `ads-api-cache-1` not touched. No code changed, nothing committed.

## Verdict

**FAIL (4 items).** Unit and Playwright suites are green. Four browser items fail: missing `<main>` landmark on the auth screens, a localhost-origin write failure, a dev hydration error, and one unreproduced session-cookie anomaly. Details below.

## Suites

| Suite | Command | Result |
| --- | --- | --- |
| Unit + DB integration (all 18 workspace packages + `tools/`) | `pnpm test:integration` (`SH_REQUIRE_DB=1`, Postgres up) | exit 0. **477 tests passed, 0 failed, 0 skipped.** Per package: contracts 4, core 9, metrics 3, db 2, amazon-core 82, amazon-ads 32, worker 7, amazon-sp 24, config 10, web 24, testing 7, mod-platform-auth 15, mod-platform-tenancy 29, mod-example 9, mod-platform-connections 23, mod-platform-audit 4, api 29, ui 141, tools 23. |
| Playwright | `pnpm e2e` | exit 0. **6 passed** (2.1 min): identity happy path (setup → SP-API → Ads → profile link → sign out/in), invited viewer roles, CSRF refusal, 3 smoke specs. |

## Checklist

Status: PASS / FAIL / NOT RUN. Evidence is what was measured in the run (dev servers on `http://127.0.0.1:3400`, API on 4400, DB queries read-only unless noted).

| # | Item | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 1 | Setup token → first Owner (`/setup`) | FAIL (attempt on localhost; succeeded on 127.0.0.1) | `pnpm auth:setup-token` printed a token; `POST /bff/v1/auth/setup` → 201 on the 2nd attempt; redirected to `/settings/connections`. Re-using the same token later → 422 (see 9). | Attempt 1 was on `http://localhost:3400` and failed (see FAIL-2). |
| 2 | Sign-in with correct password | PASS | `POST /bff/v1/auth/sign-in` 200; `/v1/me` → owner, tenant "QA Tenant A", role `owner`. | |
| 3 | Bad password error | PASS | Page shows "E-mail or password is incorrect." in a `role="alert"`; API 401 `invalid_credentials`. | |
| 4 | Unknown e-mail gives the same answer | PASS | `nobody@qa.test` → 401, same `invalid_credentials` code and detail. | Matches the design (no account enumeration). |
| 5 | Sign-in throttle | PASS | 9 wrong sign-ins for one e-mail: 8×401, then **429** on the 9th. | In-process limiter (documented). |
| 6 | Sign-out | PASS | `POST /bff/v1/auth/sign-out` 204; UI returns to `/sign-in`; `ops.audit_log` `auth.logout` recorded. | |
| 7 | Session expiry (idle) | PASS | Idle expiry forced in the QA DB (`identity.sessions.idle_expires_at` set to the past on the live session). Next navigation to `/settings/members` → `/sign-in`. | Absolute 7-day expiry NOT RUN (would need a clock change). The redirect shows no "session expired" message (observation, not a checklist requirement). |
| 8 | Session cookie is httpOnly; no token in the browser | PASS | `document.cookie` shows only `sh_csrf`; the session cookie is absent from JS. Page text contains no session or Amazon token. | |
| 9 | Setup token is single use | PASS | Second `POST /bff/v1/auth/setup` with the same token → 422; no second tenant created (`core.tenants` unchanged). | |
| 10 | Invitation create (role, link shown once) | PASS | Owner creates `viewer.b@qa.test` as Viewer → 201; the link `…/accept-invitation#token=…` is shown once with "It works once, for 7 days". Members table shows "Invitations: Accepted" after acceptance. | No SMTP: the link is copied by hand (by design, ADR-0004). |
| 11 | Invitation accept via one-time link (new user) | PASS | Opened the link in a second tab: token removed from the address bar (`location.hash` empty after load); name and password form; "Create your account" → signed in as `viewer.b@qa.test`, role Viewer. | Name left empty in the run (name field allowed empty). |
| 12 | Invitation reuse rejected | PASS | Same link opened again → "This invitation is invalid or has expired. Ask for a new one." (no form). | Message does not tell "used" from "expired" (by design). |
| 13 | Invitation to an existing user in another tenant | PASS | Owner of QA Tenant A invites `owner-1794796613008@example.test` (member of "E2E Tenant"); the link asks "An account already exists for this e-mail. Sign in to accept."; accepting as that user adds QA Tenant A to their tenants and makes it active. | Used to exercise tenant switching. |
| 14 | Members list | PASS | Owner view: table E-mail / Name / Role / Access with Role select and Remove per row, "Create invitation" form. | |
| 15 | Role change (D55) | PASS | Owner changes `viewer.b` Viewer → Analyst in the UI; table shows Analyst. `ops.audit_log` `member.roles_changed` = 1. `identity.sessions` for viewer.b: the session open at change time has `revoked_at` set (role change revokes sessions). | |
| 16 | Viewer cannot reach admin actions | PASS | Viewer (fetch from the signed-in page, with CSRF header): `POST /bff/v1/invitations` → 403 `forbidden`; `POST …/connections/spapi/self-authorization` → 403. Viewer connections page has no Connect/Disconnect buttons. | |
| 17 | Analyst (D55) reads, cannot write | PASS | Analyst: `GET …/connections` 200, `GET /bff/v1/members` 200; `POST invitations` 403, SP-API connect 403, Ads authorize 403, `POST seller-accounts` 403. | Analyst disconnect not separately run (no 403 measured for that call). |
| 18 | Create seller account | PASS | "Create your first seller account" form → 201; `QA Store NA` (region North America) appears in the seller switcher; audit `seller_account.created`. | |
| 19 | SP-API connect (mock transport) | PASS | Dialog "Connect SP-API", refresh token typed once → `POST …/spapi/self-authorization` 200; status "Connected", "This token can see 2 marketplace(s): Amazon.com, Amazon.ca". Token is not echoed; audit contains no token value. | Replay fixture token (the e2e value). |
| 20 | Ads connect via LWA redirect (mock) | PASS | `POST …/ads/authorization` 200 → callback `GET /settings/connections/ads/callback?code=…&state=…` 200 → back to `/settings/connections` with the query string removed (`location.search` empty); status "Connected". | |
| 21 | Ads profiles list and link | PASS | Profiles table: US · Fixture Seller · seller · USD · America/Los_Angeles · Available; "Link" to Amazon.com → `PUT …/ads/profiles/1234567890/link` 200; row shows "Linked to Amazon.com" and "Unlink". | |
| 22 | Reconnect | NOT RUN | Button present ("Reconnect") on both cards; not clicked. | |
| 23 | Disconnect SP-API | PASS | Confirm dialog "Disconnect Selling Partner API (SP-API)?" → Disconnect → `DELETE …/connections/spapi` 200; status "Disconnected"; `core.credentials` no longer holds the SP-API row for QA Store NA; `connection.disconnected` audit row. | Credential deleted (crypto-shred), connection row `revoked`. |
| 24 | Disconnect Ads | PASS | Same flow → `DELETE …/connections/ads` 200; "Disconnected"; QA Store NA has no credential rows left (checked by seller account). | |
| 25 | Connections screen accessibility (landmarks) | PASS | `/settings/connections` and `/settings/members`: `nav` "Main navigation", `header` (banner), `main`, breadcrumbs `nav`, skip link `#main-content`. | |
| 26 | Auth screens landmarks (`/sign-in`, `/setup`, `/accept-invitation`) | **FAIL** | JS on `/sign-in`: `main` 0, `nav` 0, `header` 0; the `<h1>` "Sign in" is present. Same on `/setup` (read_page: only generic containers). | See FAIL-1. |
| 27 | Keyboard use of the sign-in form | PASS | Tab from e-mail to password, Return submits; sign-in succeeded from the keyboard alone. | Browser pane was hidden for part of the run, so screenshots of focus rings were not possible. |
| 28 | Visible focus ring | NOT RUN (visual) | Theme rule present: `packages/ui/src/theme.tsx:52` draws the ring on `:focus-visible` for `a/button/[tabindex]`. Not confirmed on screen. | |
| 29 | Target size | PASS (AA) | Primary buttons measure 29 px high (≥ 24 px, WCAG 2.2 2.5.8 AA). | Below the 44 px touch size some guides suggest; note only. |
| 30 | Tenant switch isolation | PASS | User `owner-1794796613008` (in "E2E Tenant" and "QA Tenant A") → after accept, active tenant "QA Tenant A", sees only `QA Store NA`; UI switch to "E2E Tenant" → sees only `E2E Seller US`, role owner. | Only one user with two memberships; tested with that user. |
| 31 | Cross-tenant probe (API) | PASS | Signed in as the E2E tenant owner, calls against QA Store NA: connections, marketplaces, ads/profiles → 404; link PUT → 404; SP-API connect POST → 404; disconnect DELETE → 404. Members list shows only the E2E tenant's user. | |
| 32 | Audit log | PASS | `ops.audit_log` actions seen: `auth.login` 9, `auth.login_failed` 2, `auth.logout` 3, `member.invited` 2, `member.joined` 2, `member.roles_changed` 1, `seller_account.created` 3, `connection.authorization_started` 2, `connection.connected` 4, `connection.disconnected` 2, `ads_profiles.synced` 2, `ads_profile.linked` 2, `tenant.created` 3. Secret scan of `details`: no `Atzr`, `e2e-self`, or `mock-authorization-code` value (0 hits). Key-name matches only (`regionCode`). | |
| 33 | Empty states | PASS | Members with no invitations: "No invitations." Connections with no seller account: "Create your first seller account". | |
| 34 | Console errors (dev build) | **FAIL** | Console: React hydration mismatch in the context switcher (MUI select `id`/`htmlFor` differ between server and client); Next dev overlay "1 Issue" on members/connections. Also 401s from `/v1/me` and `/v1/members` before sign-in (expected). | See FAIL-3. |
| 35 | Session cookie after sign-in while already signed in | **FAIL (unreproduced)** | One sign-in attempt made while the browser was already signed in as the owner: the API created the new session (`identity.sessions` row, 200) but the browser kept sending the previous session (`/v1/me` still returned the owner; an invitation was created as the owner). Repeated from a signed-out state: correct (`/v1/me` = analyst). Repeated via `fetch` while signed in: correct. | See FAIL-4. |

## Failures and steps to reproduce

**FAIL-1 (item 26): auth screens have no `<main>` landmark.**
1. Sign out. Open `http://127.0.0.1:3400/sign-in`.
2. In the page, run `document.querySelector('main')` → `null`. Same for `/setup` and `/accept-invitation`.
3. Expected: a `main` landmark on the screen (checklist: landmarks on new screens). Authenticated screens have one.

**FAIL-2 (item 1, first attempt): writes fail on `http://localhost:3400` with "Your session check failed."**
1. Open `http://localhost:3400/setup` (not `127.0.0.1`) and submit the form.
2. The BFF returns 403 `csrf_failed` (`origin_mismatch`): with `SH_WEB_PUBLIC_URL` empty the expected origin is `http://127.0.0.1:<web port>` (`apps/web/lib/bff-server.ts:21`, `bff-security.ts:87`).
3. Expected: either the app works on any origin it is served from, or the page explains which address to use. The generic message gives no hint. Documenting `SH_WEB_PUBLIC_URL` for local use would also close this.

**FAIL-3 (item 34): hydration mismatch in the context switcher (dev build).**
1. Sign in, open `/settings/members`, read the console (`read_console_messages`, onlyErrors).
2. "A tree hydrated but some attributes ... didn't match": `ContextSwitcher` TextField `htmlFor` / `id` differ (`_R_2kpn…` on the server vs `_R_l6dq…` on the client).
3. Expected: no hydration warnings. Fix probably needs stable ids (`useId` consistent across server and client, or a client-only render for the MUI select).

**FAIL-4 (item 35): browser kept the old session after a sign-in made while already signed in (not reproduced).**
1. Sign in as owner (`owner.a@qa.test`) in the browser pane.
2. Without signing out, submit the sign-in form as `viewer.b@qa.test` (correct password).
3. The DB shows the new session (`identity.sessions`, not revoked, created at the sign-in time), and the API returned 200.
4. Immediately after, `/bff/v1/me` and a POST to `/bff/v1/invitations` acted as the **owner**.
5. The same sign-in from a signed-out state works (`/v1/me` = analyst). Not reproduced in the second run from the same starting state, so the cause is open. Suspected: `Set-Cookie` from the sign-in response not applied before the next navigation, or the sign-in page reusing a stale request. Needs a targeted check with the browser's network log (`read_network_requests`) on the sign-in response.

## Checks skipped and why

- Absolute session expiry (7 days): would need a clock change; idle expiry was tested.
- Reconnect (item 22): not clicked in this run.
- Visible focus ring (item 28): browser pane hidden for part of the run; the rule was checked in the code only.
- Analyst disconnect call: not measured.
- Live Amazon: none (D30 open; replay transport only).

## Observations (not checklist failures)

- The session-expired redirect shows no message explaining why the user was signed out.
- Invitation with no SMTP: the link is copied by hand (by design). One invitation for `x2.test@qa.test` (as owner) remains open in the QA DB, created during the analyst check. The QA DB is disposable.
- Name field on invitation accept can be left empty; the member row then shows "—".
- The sign-in button text is 12 px (`fontSize` 12.07 px); the input is 14.9 px. Legibility check suggested, not a requirement.

## Environment notes

- Docker Desktop was not running at start; it was started and the stack came up healthy.
- `pnpm install` (1 min 57 s) needed no changes.
- Dev servers were started with `pnpm dev` (web 3400, API 4400, worker) for the browser run and stopped at the end.

## Re-check 1 (fix round 1, branch `claude/p3-identity-8a0f9d` tip `66ca5a2`)

Worktree fast-forwarded (`git merge --ff-only claude/p3-identity-8a0f9d`, 29 files). Same stack: `sellerhub_qaidentity`, `SH_PORT_OFFSET=300`, `SH_ENV_FILE=.env.example`, mock Amazon. Stack reused its volumes (migrate: 0 new).

**Verdict: PASS.** The four prior FAILs (items 1, 26, 34, 35) are fixed in this run. No regression found in the quick pass.

### Suites

| Suite | Result |
| --- | --- |
| `pnpm test:integration` (`SH_REQUIRE_DB=1`) | exit 0. **495 passed, 0 failed, 0 skipped**: 472 in the 18 workspace packages + 23 in `tools/`. |
| `pnpm e2e` | exit 0. **7 passed** (was 6): the identity spec now has one more test. |

### Items re-checked

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Setup on **localhost:3400** | PASS | Setup token → `POST /bff/v1/auth/setup` 201; signed in as `owner.b@qa.test`, tenant "QA Tenant B", redirected to `/settings/connections`. The form submitted with no origin error. |
| 1 | Setup on **127.0.0.1:3400** | PASS | New token → 201; signed in as `owner.c@qa.test`, tenant "QA Tenant C". |
| 26 | Landmarks on auth screens | PASS | `/sign-in`: `main` 1, `h1` "Sign in". `/setup`: `main` present. `/accept-invitation`: `main` 1; token removed from the address bar (`location.hash` empty). |
| 34 | Hydration error in ContextSwitcher | PASS | Selects now render with stable ids (`context-seller-account`, `context-marketplace`). A fresh tab on `/settings/members` shows no hydration error in the console (only 404/403 network entries, the 403 being my deliberate viewer-invite probe). The same tab's older buffer still held the pre-fix message, so only the fresh tab is evidence. |
| 35 | Sign-in while already signed in | PASS | Signed in as `owner.c`, then `POST /bff/v1/auth/sign-in` as `owner.a` → 200; `/v1/me` = `owner.a`, tenant "QA Tenant A" (the browser follows the new session). DB: `owner.c` session `revoked_at` set at the sign-in time. Not reproduced as a failure. |

### Regression pass

| Area | Status | Evidence |
| --- | --- | --- |
| Sign-in / sign-out | PASS | Sign-in 200; sign-out 204 and redirect to `/sign-in`. |
| Invitations | PASS | Owner creates invitation → 201 (link with `#token=`). Accept as a new user with name and password → "Create your account" → signed in as `viewer.d` with role viewer in "QA Tenant C". Viewer `POST /bff/v1/invitations` → 403. |
| Connections | PASS | Owner: SP-API `self-authorization` 200; Ads `authorization` 200 with the mock callback URL. Viewer: no Connect/Disconnect buttons. Disconnect not re-run in this pass (the e2e suite covers connect). |
| Tenant isolation | PASS (in e2e) | `e2e` identity spec covers the invited viewer; the earlier 404 probes were not repeated. |

### Not re-run

Reconnect, the visual focus ring, absolute session expiry, and the analyst disconnect call, as in the original run.

### Observations (new, for the orchestrator)

- A setup token creates a **new tenant** even when tenants already exist (`owner.b` and `owner.c` were both created this way). The report says "first Owner"; confirm this is intended for operator-issued tokens.
- The localhost origin is now accepted in plain-http dev (`requestOrigin`), so `SH_WEB_PUBLIC_URL` is no longer needed for local use.

### Stack

Dev servers stopped; `pnpm stack:down` run; leftover Node listeners on ports 3400/4400 killed. `ads-api-cache-1` untouched.
