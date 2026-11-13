# P3-IDENTITY — identity, tenancy, seller connections

Branch `claude/p3-identity-8a0f9d`, cut from `main` at `2bc895e`. Commits are small and Conventional (`git log main..HEAD`); nothing is pushed.
Model: Sonnet 5.5, worktree session. No live Amazon call was made: every Amazon interaction runs on the replay/mock transport (D30 is OPEN).

## What a person can now do

1. An operator runs `pnpm auth:setup-token` → a one-time token (24 h, single use, stored hashed) is printed once.
2. The first Owner opens `/setup`, pastes the token and creates a tenant (**no default admin, no open sign-up**).
3. The Owner creates a seller account (one Amazon selling partner in one region), invites people by e-mail+role (link shown once, 7 days, single use), and
   assigns the five fixed roles of D55 (Owner, Admin, Manager, Analyst, Viewer), per tenant or per seller account.
4. An Owner/Admin connects **SP-API** (self-authorized refresh token, checked with `getMarketplaceParticipations` _before_ it is stored) and the
   **Ads API** (LWA authorization-code flow, scope `advertising::campaign_management`, `state` hashed server-side, single use, 10 min), lists the Ads profiles,
   links a profile to a marketplace, refreshes, reconnects and disconnects (credential deleted = crypto-shred).
5. Everything is audited in `ops.audit_log` (sign-in, sign-out, failed sign-in, tenant created, member invited/joined/role changed/removed/invitation revoked,
   seller account created, connection connected/failed/needs-reauth/disconnected, Ads profiles synced/linked/unlinked). No secret, token, code or password is ever in an audit row.

## Delivered (by OWNED_PATHS)

| Area | Contents |
| --- | --- |
| `modules/platform-audit` | `AuditWriter` (`write`, `writeIn(trx)`), secret-key redaction in `details`; no routes, no migration (`ops.audit_log` already exists in platform migration 07). |
| `modules/platform-tenancy` | Permission table (`session.read members.read accounts.read connections.read ref.read` for all roles; `members.manage connections.manage` Owner+Admin; `tenant.manage` Owner), pure access rules (`access.ts`), repositories (tenants, memberships, grants, invitations, seller accounts, preferences, `ref.*`), service (who may change whom, last-owner rule, invitation lifecycle, seller accounts, `/v1/me`, preferences), 16 operations. |
| `modules/platform-auth` | `IdentityService` (setup, sign-in, sign-out, session resolve, tenant switch with token rotation, invitation accept for new/existing users), argon2id passwords, opaque sessions hashed at rest (12 h idle / 7 d absolute), sign-in throttle, `Authenticator` for the API, CLI `bin/setup-token.ts`, 7 operations. |
| `modules/platform-connections` | Envelope-encryption vault (AES-256-GCM, AAD = `tenant\|seller account\|kind\|region`, KEK ring from env, `rewrap`, fail-closed `envKeyProvider`), `CredentialSource` for `packages/amazon-*`, Amazon port (LWA code exchange, SP token validation, Ads profile list) with replay fixtures, connections service, 9 operations. |
| `contracts/modules/platform-{auth,tenancy,connections}` | 3 OpenAPI files (32 operations; with the 5 existing ones the bundle has 37). `platform-audit` has no contract (no routes). |
| `apps/web` | `(auth)/{sign-in,setup,accept-invitation}`, `(app)/settings/{members,connections}` (+ `connections/ads/callback`), nav entries, message catalogues, header slot (user + sign out), BFF session/CSRF pipeline, shell session provider backed by `/v1/me`. |
| `/v1/me` preferences | `GET/PUT/DELETE /v1/me/preferences/{prefKey}` (per user and tenant, JSON object ≤ 16 KiB, key `^[a-z0-9][a-z0-9._-]{0,79}$`; for example `ads.campaigns.grid`). |
| `ref.*` read endpoints | `GET /v1/ref/marketplaces`, `GET /v1/ref/ads-limits[?marketplaceId=]`, and `GET /v1/seller-accounts/{id}/marketplaces` (time zone, currency, linked Ads profile). |

## Security design (D66: staging goes up right after this merges)

- **Tokens never reach the browser (ADR-0003).** The API returns the session token only in the response _headers_ `x-sh-session` / `x-sh-session-max-age` to the BFF;
  the BFF turns it into an **httpOnly, SameSite=Lax** cookie and strips every `x-sh-*` header and `Set-Cookie` from what it forwards. The browser sends the cookie; the BFF
  adds `Authorization: Bearer`. Amazon refresh tokens exist only in the request body of the connect call (entered once; never returned, never logged, never in audit) and,
  encrypted, in `core.credentials`. The OAuth `code`/`state` travel in a POST body; the callback page removes them from the address bar immediately; the invitation token
  lives in the URL _fragment_ (never sent to a server).
- **Secure by default behind HTTPS.** `SH_WEB_PUBLIC_URL=https://…` ⇒ cookies get `Secure` and the `__Host-` prefix (no Domain, Path=/); with `http://` (dev) they do not.
  Forwarded headers (`CF-Connecting-IP`, `X-Forwarded-For`) are believed **only** when `SH_TRUST_PROXY=1`; otherwise the client IP is unknown (null in audit/sessions) rather than spoofable.
- **CSRF.** Every BFF write needs a same-origin `Origin` (= `SH_WEB_PUBLIC_URL`; a browser request without Origin must not be cross-site) **and** the double-submit token
  (`x-csrf-token` = csrf cookie, constant-time compare). The csrf cookie is rotated at every sign-in. Reads are unaffected.
- **No default credentials.** First Owner = setup token. `SH_MASTER_KEY` is **required**: `composeAmazon()` throws at API boot when it is missing or malformed (messages carry names, never key material);
  the dev placeholder in `.env.example` is rejected by `loadConfig()` with `NODE_ENV=production` (added to `DEV_ONLY_VALUES`).
- **Sign-in.** argon2id via hash-wasm (19 MiB, t=2, p=1); identical answer and cost for unknown e-mail and wrong password (dummy-hash verify); throttle 8 failures / 15 min per e-mail and 40 per IP
  (in-process — see limits); disabled users and removed members stop working immediately (sessions are looked up per request; role changes and removals revoke the member's sessions).
- **Headers.** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, minimal `Permissions-Policy` (`apps/web/next.config.ts`). A CSP is P6-SEC work.
- **API exposure.** The API trusts `x-sh-client-ip`/`x-sh-user-agent` from the BFF and is meant to be reachable by the BFF only: it binds `SH_API_HOST=127.0.0.1` by default. In compose, do not publish its port to the internet.

### Environment variables for staging (names only)

| Variable | Role | Staging value |
| --- | --- | --- |
| `SH_WEB_PUBLIC_URL` | public origin; drives cookie `Secure`/`__Host-`, the CSRF Origin check, invitation links, the Ads redirect URI (`<url>/settings/connections/ads/callback`) | `https://<staging domain>` |
| `SH_TRUST_PROXY` | `1` when Cloudflare Tunnel/Access (or any trusted proxy) sits in front | `1` |
| `SH_MASTER_KEY` _(or `SH_MASTER_KEYS` + `SH_MASTER_KEY_ACTIVE`)_ | vault key, 32 bytes base64, **required**; back it up | generate (`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`) |
| `SH_AMAZON_MODE` | unset/`replay` = fixtures only (no live call); `sandbox`; `production` | leave unset (D30 open) |
| `SH_API_URL`, `SH_API_HOST` | where the BFF reaches the API (server side only) | private network / `127.0.0.1` |
| `SPAPI_LWA_CLIENT_ID/SECRET`, `ADS_LWA_CLIENT_ID/SECRET` | the deployment's Amazon app credentials (not per seller) | unset in replay mode (fake ones are used); real ones only after D30 |
| `SH_PG_*`, `SH_REDIS_URL`, `NODE_ENV=production` | unchanged from the scaffold | non-dev passwords (checked) |

First Owner on a fresh server: `pnpm auth:setup-token` (needs `SH_PG_*`), open `https://<domain>/setup`. Cloudflare Access in front is the outer gate; this app's own sign-in is the inner one.

## Decisions taken / deviations (please confirm or record)

1. **No Better Auth library — `IdentityService` is implemented directly (ADR-0004 deviation).** The accepted design in `db/design/02_identity.sql` (hashed opaque session tokens, uuid keys, generated e-mail column,
   `active_tenant_id`) does not map onto Better Auth's stock tables (it stores raw session tokens and drives its own HTTP handler, which does not fit contract-first operation binding). Using it would have meant
   overriding most of its model. What ADR-0004 actually asks for is delivered: argon2id, opaque sessions hashed at rest, 12 h / 7 d, rotation on privilege change, no bypass tokens, no default admin, the
   `IdentityService` seam for a later OIDC/Keycloak method. **Not built (outside the Done criteria):** e-mail verification, password reset, TOTP 2FA (`require_two_factor` and `identity.two_factor_secrets` are untouched seams).
   If the library choice is binding, this is a `NEEDS_DECISION` for the orchestrator — the service interface is small, so swapping is contained.
2. **Vault code lives in `modules/platform-connections/src/vault`, not `packages/core/crypto`** (ADR-0005 decision 1): `packages/core` is a shared file. Exported through the module's public entry for the worker; moving it later is a rename.
3. **Env names**: ADR-0005 says `SH_MASTER_KEYS`/`SH_MASTER_KEY_ACTIVE`; the scaffold had `SH_MASTER_KEY`. Both are supported (`SH_MASTER_KEYS` wins).
4. **Service container**: the scaffold left "a service container defined by P3-IDENTITY". Each module has a tiny `provide…Services()` holder; `apps/api/src/main.ts` provides them after `buildApp()` (routes resolve services lazily per request).
5. **Permission names**: the registry requires `<area>.<action>` with no hyphen in the area, so `accounts.read` (not `seller-accounts.read`).
6. **Roles at tenant level** (`x-scope: tenant`) = the member's tenant-wide grants; a member with _only_ seller-account grants gets a `viewer` floor so `/v1/me` works, and sees only their accounts. A seller-account id the caller cannot see is **404**, not 403 (conventions §3). Marketplace-narrowed grants (`marketplace_id` not null) confer nothing in the MVP (schema seam).
7. **Invitations**: SMTP is not wired (ADR-0004: "if unset, the inviter copies the link"); the link (`/accept-invitation#token=…`) is returned once. Admin may invite any role except Owner; only an Owner may grant, keep or remove owner access; a tenant always keeps ≥ 1 Owner.
8. **Mock mode of the Ads flow**: with `SH_AMAZON_MODE` unset/`replay`, `startAdsAuthorization` returns our own callback URL with a fake code instead of Amazon's consent URL, and the LWA exchange is answered by a fixture (`connectionsReplayFixtures()`); the same code path runs with real URLs in `sandbox`/`production`.
9. **Argon2 dependency**: `hash-wasm` 4.12.0 added to the `catalog:` (argon2id in WebAssembly — a native add-on cannot be bundled into `apps/api`'s single `dist/main.js`; 4.12.0 rather than the newest 4.13.0, which is a week old).

## Shared files touched (each is minimal; please review)

| File | Change | Why |
| --- | --- | --- |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | catalog entry `hash-wasm`; lockfile for the 4 new workspace packages | password hashing |
| `package.json` | script `auth:setup-token` | operator CLI |
| `.env.example` | real dev-only `SH_MASTER_KEY` placeholder (flagged DEV-ONLY), `SH_MASTER_KEYS`/`SH_MASTER_KEY_ACTIVE` (commented), `SH_TRUST_PROXY=0`, `SH_AMAZON_MODE` (commented, documented) | vault, staging, P3-CLIENTS follow-up #2 |
| `packages/config/src/env.ts` | optional `SH_MASTER_KEYS`, `SH_MASTER_KEY_ACTIVE`, `SH_TRUST_PROXY`, `SPAPI_/ADS_LWA_CLIENT_ID/SECRET`; `SH_MASTER_KEY` + dev placeholder added to the production refusal list | config validation |
| `apps/api/src/main.ts` | wires audit writer, Amazon stack, authenticator and the module services (BACKLOG §1.3 names P3-IDENTITY owner of auth plugin/main) | composition root |
| `apps/api/test/identity.test.ts` (new), `apps/api/test/api.test.ts` | new HTTP-level identity test; the scaffold guard test now binds only the example/system operations (the contract holds the platform operations too) | evidence |
| `apps/web/app/bff/[...path]/route.ts` (+ `lib/bff-*.ts`, `app/bff/csrf/route.ts`) | the placeholder BFF becomes the real one | scaffold follow-up #3 |
| `apps/web/app/(shell)/session.ts` → `session.tsx`; `app/(app)/layout.tsx` | the typed stub becomes the provider backed by `/v1/me`; the layout wraps `AppFrame` with it | scaffold/P3-DS said P3-IDENTITY implements it |
| `apps/web/app/(shell)/shell.test.tsx` | mocks `./session` (the frame no longer fabricates a session); the example-link assertion looks the entry up by id | consequence of the line above |
| `apps/web/vitest.config.ts` | `@/` alias (same as tsconfig) | tests import `@/lib/...` |
| `apps/web/next.config.ts` | baseline security headers | OAuth code must not leak via Referer |
| `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/smoke/smoke.spec.ts` | API started next to web; routes warmed once; smoke spec: writes now answer 403 `csrf_failed` (was 501), `/example` now needs a session | the BFF is real |

Nothing outside these and OWNED_PATHS was edited. `apps/worker/**`, `packages/ingestion/**`, `apps/web/app/(app)/settings/sync/**` untouched.

## Commands run and results

Environment: Windows 11, Node v26.12.1, pnpm 10.12.1, Docker Desktop. Stack: `COMPOSE_PROJECT_NAME=sellerhub_p3identity SH_PORT_OFFSET=100 SH_ENV_FILE=.env.example SH_REQUIRE_DB=1`
(Postgres 55532, Redis 56479, API 4200, web 3200). The legacy `ads-api-cache-1` container was not touched.

| Command | Result |
| --- | --- |
| `pnpm stack:up`, `pnpm db:migrate` | stack healthy; 15 migrations applied (14 platform + example). **No new migration was needed**: every table (`identity.*`, `core.*`, `ops.audit_log`, `ref.*`) already exists in the frozen design. |
| `pnpm gate` (= `gen` → `lint` → `typecheck` → `test` → `build`) with the stack up and `SH_REQUIRE_DB=1` | **exit 0**. lint 19/19 tasks + root eslint + `prettier --check .`; typecheck 19/19 + root `tsc`; test 19/19 + `vitest --root tools` (23); build 19/19 (tsup for api/worker, `next build`). Nothing skipped: the DB tests ran on the real Postgres (the gate fails instead of skipping when it is unreachable). |
| Test counts (from that run) | platform-audit 4, platform-tenancy 29, platform-auth 15, platform-connections 23, api 29 (13 scaffold + 16 identity over HTTP), web 24, ui 141, amazon-core 82, amazon-sp 24, amazon-ads 32, config 10, core 9, mod-example 9, worker 7, testing 7, contracts 4, metrics 3, db 2, tools 23 |
| `pnpm e2e` (starts API + web; replay transport) | **6 passed**: sign-in → connect happy path (setup token, SP-API, Ads redirect round trip, profile linked, sign out/in), invited-viewer roles, CSRF, and the 3 smoke specs (smoke updated, see above) |
| Bundled API check | `apps/api` → `node dist/main.js` boots (`/readyz` database+redis ok) and `POST /v1/auth/setup` answers 201 with `x-sh-session-max-age` and no token in the body (this caught two bundle problems, below) |

Earlier gate runs failed and were fixed (the final one is green): `prettier --check` on four files; the scaffold's `apps/api/test/api.test.ts` booting with only the example routes while the contract now holds the platform operations;
and two problems found only by building and running the bundle: (1) `@node-rs/argon2` is a native add-on and `apps/api` bundles everything into one `dist/main.js` → replaced by **`hash-wasm` 4.12.0** (WebAssembly, `catalog:`);
(2) the replay fixtures of `packages/amazon-{ads,sp}` are read from directories next to their source files and do not exist in the bundle → the two read operations the connect flows use are **embedded** in `modules/platform-connections/src/amazon/compose.ts`
(the on-disk fixtures are still merged in dev/tests). **Follow-up for P3-CLIENTS/orchestrator:** make `loadFixtureDir` bundle-safe before P4 slices rely on replay mode in the staging bundle.

## Tests that prove the Done criteria

| Criterion | Test |
| --- | --- |
| Cross-tenant test for **every repository** | `platform-audit/test/audit-writer.test.ts`; `platform-tenancy/test/tenancy-isolation.test.ts` (`tenancyRepository`: tenant, members, grants, invitations, seller accounts, marketplaces, preferences, memberships-of-user; RLS-alone unfiltered query; WITH CHECK write rejected); `platform-connections/test/connections.test.ts` (`connectionsRepository`: connections, sealed credentials, profiles, connect states + service-level 404s + RLS-alone counts); `refRepository` is global read-only reference data (no tenant data; covered by the service test) and `authRepository` is the global `identity.*` store (no tenant column; covered by `platform-auth/test/identity.test.ts`) |
| Member of tenant A cannot read or act on tenant B's accounts (API level) | `apps/api/test/identity.test.ts` "tenant isolation over HTTP": 9 routes × 404, both directions, members list isolation, Ads callback with another tenant's state refused |
| Roles of D55 enforced in the API | same file: viewer reads / 403 on 6 write routes; manager 403 on members/connections; admin may invite but not touch an Owner (`owner_required`); last owner protected; seller-account-scoped grant reaches only that account; role change revokes sessions |
| Refresh token envelope-encrypted, never logged/returned | `platform-connections/test/vault.test.ts` (round trip, AAD mismatch × 4, tamper, rewrap, fail-closed keys), `connections.test.ts` (ciphertext does not contain the token, responses/audit do not), `apps/api/test/identity.test.ts` (every secret seen in the run is absent from all log lines and audit rows) |
| Sign-in audit + membership audit | `platform-auth/test/identity.test.ts`, `platform-tenancy/test/tenancy-isolation.test.ts`, `apps/api/test/identity.test.ts` |
| Playwright happy path with the mock Amazon transport | `e2e/platform-identity/identity.spec.ts`: setup token → owner → seller account → SP-API connect → Ads connect via the redirect → profile listed and linked → sign out/in; invited viewer sees no manage controls and gets 403 from the API; CSRF refusal |
| BFF cookie/CSRF rules | `apps/web/lib/bff-security.test.ts` (11 tests) + the e2e CSRF test |

## Not done / limits (honest list)

- **Public SP-API app (website authorization) flow** (D1 b, behind a flag) is **not built**: only the private-app self-authorization the task asks for. `core.connect_states` and the state machinery are in place for it.
- E-mail verification, password reset, TOTP 2FA, SMTP delivery of invitations, machine tokens (`identity.api_tokens` is a seam; the authenticator accepts session bearers only), SSO.
- Sign-in throttle is **in-process** (each API replica has its own budget); a Redis-backed limiter is a P6-SEC follow-up. Sessions older than 30 days are not purged yet (maintenance job, ADR-0009).
- ADR-0005 decision 6 steps 1–2 on disconnect (stop schedules / cancel queued jobs, delete Amazon-side subscriptions) have no hook yet because nothing schedules or subscribes yet: disconnect deletes the credential and sets `revoked`; **P3-INGEST/S06 must treat `core.connections.status <> 'active'` as "do not run"**. The `vault.rewrap` job is not built (the `rewrap()` function and its test are).
- The connections screen shows connection status and timestamps, but "last sync" is a placeholder line until P3-INGEST's sync state exists.
- The settings screens have no Storybook stories or component tests (the happy path is covered end to end).
- Not run on Node 24 (local Node is 26); not run in CI. Windows only. The e2e specs rely on `next dev` and take ~2 minutes (route warm-up in `e2e/global-setup.ts`).
- No live Amazon call (no credentials, D30 open). `listProfiles`/`getMarketplaceParticipations` shapes come from the P3-CLIENTS fixtures.

## Follow-ups

1. Orchestrator: decide on the Better Auth deviation (item 1) and record it as an ADR-0004 amendment; record items 2–5.
2. P3-STAGING: put `SH_WEB_PUBLIC_URL`, `SH_TRUST_PROXY=1`, `SH_MASTER_KEY` in the staging compose env; publish only the web port through the tunnel; run `pnpm auth:setup-token` once.
3. P3-INGEST/S06: honour connection status; use `composeAmazon` / `vaultCredentialSource` (public entry of `@seller-hub/mod-platform-connections`) from the worker composition root.
4. P3-CLIENTS/orchestrator: bundle-safe `loadFixtureDir` (see above).
5. P6-SEC: CSP, Redis-backed login throttle, 2FA, session purge, review of the in-house identity code.
6. Next wave: slices add permissions in their own `*.permissions.ts`; `/v1/me` already returns the union per seller account for the UI.
