# ADR-0005 — Credential vault

Status: Accepted (Gate 2, D20, 2026-11-10) · Date: 2026-11-10 · Task: P2-ARCH

## Context

Each connected seller account stores LWA refresh tokens: one for SP-API (self-authorisation or website OAuth —
`docs/discovery/reference-patterns.md` §1.1/1.2) and one for the Ads API (`docs/discovery/ads-domains.md` §1),
per region. Later: the seller's own AWS keys for Stream v2 / notifications destinations in self-host (D58 a).
A leaked refresh token gives full API access to a seller's business. Self-host has no KMS; cloud (D21 assumption)
has AWS KMS. App-level secrets (LWA client id/secret per deployment) come from env (`.env.example`).

## Options

| Option | For | Against |
|---|---|---|
| **App-level envelope encryption**: per-credential data key (DEK, AES-256-GCM), DEK wrapped by a key-encryption key (KEK) from a `KeyProvider` — AWS KMS in cloud, a master key from env in self-host | works in both shapes; DB dump alone is useless; crypto-shredding by deleting the wrapped DEK; KEK rotation re-wraps only DEKs | we own the code (small, testable) |
| Postgres `pgcrypto` with a key passed per query | no app crypto code | key travels in SQL; appears in logs / `pg_stat_statements`; no KMS integration |
| HashiCorp Vault / OpenBao | mature, audit, dynamic secrets | another stateful service for every self-hoster (unseal, HA, backup) |
| AWS Secrets Manager per token | managed | cloud-only; cost per secret × sellers; still need a self-host path |

## Decision

1. `packages/core/crypto` implements envelope encryption; `modules/platform-connections` owns the
   `core.credentials` table: `(id, tenant_id, seller_account_id, kind, region, kek_id, wrapped_dek, iv, ciphertext,
   auth_tag, created_at, rotated_at, revoked_at)`. `kind` ∈ `spapi_refresh`, `ads_refresh`, later `aws_stream`.
2. AES-256-GCM with **AAD = `tenant_id|seller_account_id|kind|region`** so a ciphertext copied to another row fails
   to decrypt.
3. `KeyProvider`:
   - **self-host**: `SH_MASTER_KEYS` = comma list of `kid:base64(32 bytes)`, first is active; `SH_MASTER_KEY_ACTIVE`
     names it. Boot fails if absent or malformed (fail closed).
   - **cloud**: AWS KMS `GenerateDataKey` / `Decrypt` with a key per environment (per tenant optional for SaaS),
     encryption context = the AAD fields.
4. Decrypted refresh tokens exist only in worker/api memory long enough to call LWA; **access tokens** are cached in
   Redis encrypted with the same mechanism, TTL = expiry − 60 s (pattern from
   `refs/amazon/selling-partner-api-sdk/javascript/sdk/helper/LwaAuthClient.mjs`). Never logged (conventions §7).
5. **Rotation**: KEK rotation = add new kid, run the `vault.rewrap` job (re-wraps DEKs, not ciphertexts), then
   retire the old kid. Refresh tokens are re-encrypted when Amazon returns a new one. LWA client secret rotation
   (SP-API `applications.rotateApplicationClientSecret`, `catalog/spapi/operations.json`; 0.0167 rps) is an
   operator action in self-host (env change), a worker job with an audit row in SaaS.
6. **Revocation on disconnect** (user action or `invalid_grant` from LWA):
   1. stop schedules and cancel queued jobs for the seller account/kind;
   2. while the token still works, delete Amazon-side subscriptions we created (Stream v2 subscriptions,
      SP-API notification subscriptions);
   3. delete the credential row (crypto-shred: the wrapped DEK is gone);
   4. mark the connection `revoked` (user) or `needs_reauth` (`invalid_grant`), notify Owner/Admin, audit row.
   Mirrored data stays (it is the tenant's) until the tenant deletes the seller account; Amazon offers no public
   LWA revoke endpoint, so the UI tells the user to remove the app authorisation in Seller Central / Ads console.
7. Connect flows (`state` stored server-side and verified — the sample's missing CSRF check in
   `refs/amazon/selling-partner-api-samples/use-cases/website-authorization/README.md` is fixed here; `version=beta`
   only in dev) are BFF routes calling `platform-connections`.

## Consequences

- Losing `SH_MASTER_KEYS` in self-host makes all connections unrecoverable → onboarding docs (P6-DEPLOY) must say
  "back it up"; reconnecting is the recovery path.
- A DB-only breach does not expose tokens; a breach of DB + env/KMS access does.
- Tests: round-trip, AAD mismatch fails, rewrap keeps plaintext, revoked credential cannot decrypt.

## Revisit when

SaaS needs per-tenant KMS keys or customer-managed keys, or P6-SEC requires an HSM-backed self-host option.
