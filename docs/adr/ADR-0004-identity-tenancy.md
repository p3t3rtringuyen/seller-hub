# ADR-0004 — Identity and tenancy

Status: Accepted (Gate 2, D20, 2026-11-10) · Date: 2026-11-10 · Task: P2-ARCH

## Context

PLT-01 (L0): tenants, users, BFF login, invitations, five fixed roles scoped by seller account (D55 a). D1 c:
self-host first (often one tenant, a handful of users), SaaS later (many tenants). The legacy used Keycloak and a
corporate portal (replacement map rows 16, 18, 19 in `docs/discovery/legacy-api-domain.md`); none of that carries
over. Legacy traps 4, 5, 7, 11: unauthenticated routes, missing role checks, bypass tokens, no tenant column.
D50 b later needs delegated machine tokens for seller-hub's own MCP server.

## Options

**Identity provider**
| Option | For | Against |
|---|---|---|
| Keycloak (container) | SSO, MFA, federation, admin UI | a JVM service (≥ 1 GB RAM) in every self-host; second user store to sync with tenants/roles; its tokens must still be kept out of the browser; upgrade burden on self-hosters |
| **Built-in auth library in the API (Better Auth core: email+password, email verification, reset, TOTP 2FA, sessions in Postgres)** | one process, one database; sessions are rows (instant revocation); TypeScript; later OIDC SSO as a plugin | we own more of the security surface → covered by P6-SEC; library maturity risk |
| Hand-written (argon2 + session table) | zero dependency | reinvents reset/verification/2FA flows; more audit surface |
| Hosted IdP (Auth0, Cognito, Clerk) | outsourced security | not self-hostable; per-user cost; vendor lock |

**Tenant isolation**
| Option | For | Against |
|---|---|---|
| **Shared schema, `tenant_id` + `seller_account_id` on every row, repository `Scope` + Postgres RLS** | one migration set; cheap tenants; RLS as second line of defence | RLS needs `SET LOCAL` per transaction and a non-owner DB role |
| Schema per tenant | strong isolation | migrations × tenants; pooling and partitioning get hard |
| Database per tenant | strongest | cost; operational load for SaaS |

## Decision

1. **Identity lives in the API** (`modules/platform-auth`), on **Better Auth's core** behind our own
   `IdentityService` interface (so Keycloak/OIDC can be added later as a login method, not a rewrite). Passwords
   argon2id; TOTP optional per user, enforceable per tenant; sessions are opaque random ids (hashed at rest), 12 h
   idle / 7 d absolute, rotated on privilege change. The BFF holds the id in an httpOnly cookie (ADR-0003). No
   bypass tokens; no default admin password (first Owner is created by a one-time CLI or setup token printed once).
2. **Model** (tables designed by P2-DATA):

```
identity.users (global)            ─┐
identity.sessions                   │
core.tenants                        │
core.memberships (tenant, user, status)
core.role_grants (membership, role, seller_account_id NULL = all, marketplace_id NULL = all)
core.invitations (tenant, email, role, seller_account_id?, token_hash, expires_at, invited_by)
core.seller_accounts (tenant, region NA|EU|FE, account_type seller|vendor, selling_partner_id?, name)
core.seller_account_marketplaces (seller_account, marketplace_id, ads_profile_id?)
```

   A **seller account** is one Amazon selling partner in one region (SP-API authorises per region —
   `docs/discovery/spapi-domains.md` cross-cutting rule 4) with its marketplaces; each marketplace may link one Ads
   profile (`docs/discovery/ads-domains.md` §1).
3. **Roles (D55 a, fixed)** and permissions:

| Permission | Owner | Admin | Manager | Analyst | Viewer |
|---|---|---|---|---|---|
| `tenant.manage` (billing later, delete tenant, transfer ownership) | ✓ | | | | |
| `members.manage`, `connections.manage`, `automation.caps` (D63) | ✓ | ✓ | | | |
| `ads.write`, `automation.manage`, `commands.approve` | ✓ | ✓ | ✓ | | |
| `reports.run`, `history.read`, `export.run` | ✓ | ✓ | ✓ | ✓ | |
| `*.read` | ✓ | ✓ | ✓ | ✓ | ✓ |

   Grants are scoped by seller account (D55); `marketplace_id` narrowing is a **schema seam** (nullable, not
   exposed in MVP UI). Effective permission = union of grants for the scope. The permission table lives in code
   (`modules/platform-tenancy/src/permissions.ts`) and is the single source for API guards and the UI's `/v1/me`.
4. **Invitations**: Owner/Admin invites email + role + scope → token (32 random bytes, stored hashed, 7-day
   expiry, single use) → email (SMTP from env; if unset, the inviter copies the link) → accept: sign in or sign
   up with that email → membership + grants created in one transaction → audit row.
5. **Isolation**: shared schema; every seller-data row has `tenant_id` and `seller_account_id`; repositories take
   `Scope`; **RLS policies** on every tenant table check `current_setting('app.tenant_id')`, set by
   `SET LOCAL` in the transaction helper of `packages/db`. The app connects as a non-owner role without `BYPASSRLS`;
   migrations and maintenance use a separate owner role. Workers set the scope from the job payload.
6. **Machine tokens (seam for D50 b / AI-04)**: `identity.api_tokens` (hashed, tenant-scoped, permission subset,
   expiry). Not exposed in MVP UI; the guard already accepts the token kind.

## Consequences

- One P3-IDENTITY slice delivers sign-up/sign-in, setup token, invitations, roles, `/v1/me`, tenant switcher.
- RLS adds a per-transaction `SET LOCAL`; pooled connections must not leak scope (helper resets; test).
- Each repository test proves cross-tenant invisibility with RLS on (CLAUDE.md tenancy rule).
- SSO (SAML/OIDC) is a later plugin; SaaS signup and tenant billing are out of MVP.

## Revisit when

A customer requires enterprise SSO/SCIM, or a security review (P6-SEC) finds the library inadequate — then add
Keycloak (or a hosted IdP) as an OIDC login method behind `IdentityService`.
