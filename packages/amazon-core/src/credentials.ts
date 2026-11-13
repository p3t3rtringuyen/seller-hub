import { createHash } from "node:crypto";
import type { ApiFamily, Region } from "./regions";

/**
 * Which seller account's Amazon credential a call runs as. `tenantId` + `sellerAccountId` are mandatory
 * (CLAUDE.md tenancy rule); `api` and `region` pick the LWA app and endpoint (D5: nothing here is seller-only).
 */
export interface CredentialRef {
  readonly tenantId: string;
  readonly sellerAccountId: string;
  readonly api: ApiFamily;
  readonly region: Region;
}

/** The three values LWA needs. Never logged, never serialised into errors. */
export interface LwaCredential {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/** App-level credential for grantless (client_credentials) calls: no refresh token. */
export interface LwaAppCredential {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Where credentials come from. The vault (ADR-0005, P3-IDENTITY) implements this interface; this package
 * never reads tenant credentials from the environment. `sandbox.ts` has the one env-backed implementation, for
 * the developer's own live checks.
 */
export interface CredentialSource {
  getCredential(ref: CredentialRef): Promise<LwaCredential>;
  getAppCredential?(api: ApiFamily, region: Region): Promise<LwaAppCredential>;
  /** Called when LWA answered `invalid_grant`, so the vault can flag the connection (ADR-0005 step 6). */
  markNeedsReauth?(ref: CredentialRef): Promise<void>;
}

/** Stable key for everything cached per credential. The refresh token is hashed in so a rotated token never reuses the old cache entry. */
export function credentialKey(ref: CredentialRef, credential: LwaCredential): string {
  const fingerprint = createHash("sha256")
    .update(credential.clientId)
    .update("\0")
    .update(credential.refreshToken)
    .digest("hex")
    .slice(0, 16);
  return `${ref.tenantId}:lwa:${ref.api}:${ref.region}:${ref.sellerAccountId}:${fingerprint}`;
}

/** Short, non-reversible id of the LWA application, used inside rate-limit keys (limits are per application). */
export function appFingerprint(credential: { clientId: string }): string {
  return createHash("sha256").update(credential.clientId).digest("hex").slice(0, 8);
}
