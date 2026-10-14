# P3-IDENTITY — Identity, tenancy, seller connections

Model: Sonnet · checkout: worktree (commit on your branch)
OWNED_PATHS: `apps/api/src/modules/{auth,tenancy,connections}/**`, `apps/web/app/(auth)/**`,
`apps/web/app/settings/**`, migrations for the `core` schema, `docs/reports/P3-IDENTITY.md`

## Goal

A person signs in, belongs to a tenant, and connects that tenant's Amazon seller and advertising
accounts — with credentials stored safely.

## Inputs

ADRs on identity/tenancy, credential vault and the BFF; `docs/data-model/*` (core schema);
`docs/discovery/reference-patterns.md` (`website-authorization`, `auth-lifecycle-management`,
`lwa-rotation`); `packages/amazon-core` (credential-provider interface); D1, D11.

## Build

- Sign-in per the ADR; BFF session in an httpOnly cookie; CSRF protection; **no identity or Amazon
  token in the browser**.
- Tenants, memberships, roles; permissions per seller account and marketplace; invitations.
- Credential vault implementing the provider interface: envelope encryption, rotation, revoke.
- SP-API connection:
  - private app (D1 a/c): an admin enters the self-authorized refresh token once; it is
    validated with a harmless call (marketplace participations) and stored encrypted;
  - public app (D1 b/c, behind a flag): the website authorization OAuth flow — consent URL with
    app id and `state`, callback exchanging the code for a refresh token, state verified.
- Ads API connection: LWA OAuth with scope `advertising::campaign_management`, list profiles,
  choose which to link to which seller account / marketplace.
- Settings screens: connections with status, last sync, reconnect, disconnect (revokes and
  deletes the stored credential).
- Audit log for sign-in, membership and connection events.

## Done when

Gate command green; tests prove a member of tenant A cannot read or act on tenant B's accounts
(API and repository level); connection flows tested with mocked Amazon endpoints.
