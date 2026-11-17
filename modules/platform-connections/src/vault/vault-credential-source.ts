import {
  type ApiFamily,
  type CredentialRef,
  type CredentialSource,
  type LwaAppCredential,
  type Region,
} from "@seller-hub/amazon-core";
import type { Database } from "@seller-hub/db";
import type { AuditWriter } from "@seller-hub/mod-platform-audit";
import { connectionsRepository } from "../repository/platform-connections/connections-repository";
import type { LwaAppConfig } from "../amazon/amazon-port";
import { open, type KeyProvider } from "./envelope";

// The vault side of `CredentialSource` (packages/amazon-core/src/credentials.ts): the clients ask for a seller account's
// credential, this decrypts the stored refresh token (ADR-0005) and pairs it with the deployment's LWA app credentials.
// A decrypted refresh token lives in memory only for the duration of the LWA call. Nothing here logs a token.

export interface VaultCredentialSourceDeps {
  db: Database;
  keys: KeyProvider;
  app: LwaAppConfig;
  audit: AuditWriter;
}

const KIND: Record<ApiFamily, "spapi_refresh" | "ads_refresh"> = {
  sp: "spapi_refresh",
  ads: "ads_refresh",
};
const API: Record<ApiFamily, "spapi" | "ads"> = { sp: "spapi", ads: "ads" };

export const toDbRegion = (r: Region): string => r.toUpperCase();
export const toAmazonRegion = (r: string): Region => r.toLowerCase() as Region;

export class NoCredentialError extends Error {
  constructor(ref: CredentialRef) {
    super(`no active ${ref.api} credential for seller account ${ref.sellerAccountId}`);
    this.name = "NoCredentialError";
  }
}

export function vaultCredentialSource(deps: VaultCredentialSourceDeps): CredentialSource {
  const repo = connectionsRepository(deps.db);
  const appFor = (api: ApiFamily): LwaAppCredential => {
    const c = api === "sp" ? deps.app.sp : deps.app.ads;
    if (!c) throw new Error(`the ${api} application credentials are not configured`);
    return c;
  };

  return {
    async getCredential(ref) {
      const scope = { tenantId: ref.tenantId, sellerAccountId: ref.sellerAccountId };
      const stored = await repo.getSealedCredential(scope, API[ref.api]);
      if (!stored) throw new NoCredentialError(ref);
      const refreshToken = await open(
        deps.keys,
        {
          tenantId: ref.tenantId,
          sellerAccountId: ref.sellerAccountId,
          kind: stored.kind,
          region: stored.regionCode,
        },
        stored.sealed,
      );
      const app = appFor(ref.api);
      return { clientId: app.clientId, clientSecret: app.clientSecret, refreshToken };
    },

    async getAppCredential(api) {
      return appFor(api);
    },

    /** LWA said `invalid_grant`: flag the connection so schedules pause and the UI asks to reconnect (ADR-0005 step 6). */
    async markNeedsReauth(ref) {
      const scope = { tenantId: ref.tenantId, sellerAccountId: ref.sellerAccountId };
      await repo.markStatus(scope, API[ref.api], "needs_reauth", "invalid_grant");
      await deps.audit
        .write(scope, {
          action: "connection.needs_reauth",
          actorType: "system",
          targetType: "connection",
          targetId: API[ref.api],
          outcome: "failure",
          details: { api: API[ref.api], reason: "invalid_grant" },
        })
        .catch(() => undefined);
    },
  };
}

export { KIND as CREDENTIAL_KIND, API as CONNECTION_API };
