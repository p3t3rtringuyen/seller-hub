import { createHash, randomBytes } from "node:crypto";
import { DomainError, requireSellerScope, validationFailed, type Scope } from "@seller-hub/core";
import { withScope, type Database } from "@seller-hub/db";
import type { AuditWriter } from "@seller-hub/mod-platform-audit";
import type { TenancyService } from "@seller-hub/mod-platform-tenancy";
import type { AmazonPort } from "../../amazon/amazon-port";
import {
  connectionsRepository,
  type AdsProfileInput,
  type ApiKind,
  type ConnectionRow,
} from "../../repository/platform-connections/connections-repository";
import { seal, type KeyProvider } from "../../vault/envelope";
import { toAmazonRegion } from "../../vault/vault-credential-source";

// Connection flows (PLT-02 connect half, PLT-03):
//  - SP-API self-authorization (D1 a/c): an admin enters the refresh token once; it is validated with a harmless
//    read-only call (getMarketplaceParticipations) BEFORE it is stored, then envelope-encrypted (ADR-0005).
//  - Ads API: LWA authorization-code flow with scope advertising::campaign_management; `state` is stored hashed
//    server-side, tied to tenant, user and seller account, single use, 10 minutes (the CSRF fix of ADR-0005 decision 7).
// Refresh tokens are never returned, never logged and never put in audit details.

export const ADS_SCOPE = "advertising::campaign_management";
export const STATE_TTL_MS = 10 * 60_000;
const AUTHORIZE_URL: Record<string, string> = {
  NA: "https://www.amazon.com/ap/oa",
  EU: "https://eu.account.amazon.com/ap/oa",
  FE: "https://apac.account.amazon.com/ap/oa",
};
const sha256 = (v: string): Buffer => createHash("sha256").update(v).digest();
const API_NAME: Record<ApiKind, string> = { spapi: "SP-API", ads: "Ads API" };

export interface ConnectionsServiceDeps {
  db: Database;
  audit: AuditWriter;
  keys: KeyProvider;
  amazon: AmazonPort;
  tenancy: TenancyService;
  webPublicUrl: string;
}

export interface ActorInfo {
  scope: Scope; // { tenantId, userId[, sellerAccountId] }
  email?: string | undefined;
  traceId?: string | undefined;
}

export interface ConnectionDto {
  api: ApiKind;
  status: ConnectionRow["status"];
  authMethod: ConnectionRow["authMethod"];
  scopes: string[];
  connectedAt: string | null;
  lastTokenRefreshAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  revokedAt: string | null;
}
const toDto = (c: ConnectionRow): ConnectionDto => ({
  api: c.api,
  status: c.status,
  authMethod: c.authMethod,
  scopes: c.scopes,
  connectedAt: c.connectedAt,
  lastTokenRefreshAt: c.lastTokenRefreshAt,
  lastErrorCode: c.lastErrorCode,
  lastErrorAt: c.lastErrorAt,
  revokedAt: c.revokedAt,
});

export function connectionsService(deps: ConnectionsServiceDeps) {
  const repo = connectionsRepository(deps.db);
  const redirectUri = `${deps.webPublicUrl.replace(/\/$/, "")}/settings/connections/ads/callback`;

  async function accountOf(scope: Scope) {
    const s = requireSellerScope(scope);
    const account = await deps.tenancy.getSellerAccount(s, s.sellerAccountId);
    return { s, account, region: toAmazonRegion(account.regionCode) };
  }

  /** Stores the credential and activates the connection in one transaction, with its audit row. */
  async function storeConnection(
    a: ActorInfo,
    input: {
      api: ApiKind;
      authMethod: "self_authorization" | "oauth_code";
      refreshToken: string;
      regionCode: string;
      scopes: string[];
    },
  ): Promise<ConnectionRow> {
    const s = requireSellerScope(a.scope);
    const kind = input.api === "ads" ? "ads_refresh" : "spapi_refresh";
    const sealed = await seal(
      deps.keys,
      { tenantId: s.tenantId, sellerAccountId: s.sellerAccountId, kind, region: input.regionCode },
      input.refreshToken,
    );
    await withScope(deps.db, s, async (trx) => {
      const connectionId = await repo.upsertActive(
        s,
        {
          api: input.api,
          regionCode: input.regionCode,
          authMethod: input.authMethod,
          scopes: input.scopes,
          connectedBy: a.scope.userId ?? null,
        },
        trx,
      );
      await repo.replaceCredential(
        s,
        { connectionId, kind, regionCode: input.regionCode, sealed },
        trx,
      );
      await deps.audit.writeIn(trx, s, {
        action: "connection.connected",
        actorLabel: a.email ?? null,
        targetType: "connection",
        targetId: input.api,
        details: { api: input.api, method: input.authMethod },
        traceId: a.traceId ?? null,
      });
    });
    return (await repo.get(s, input.api))!;
  }

  async function syncAdsProfiles(
    a: ActorInfo,
  ): Promise<{ count: number; synced: boolean; errorCode?: string }> {
    const { s, region, account } = await accountOf(a.scope);
    const conn = await repo.get(s, "ads");
    if (!conn || conn.status !== "active")
      throw new DomainError(
        "conflict",
        "not_connected",
        "The Ads API is not connected for this seller account",
      );
    let list;
    try {
      list = await deps.amazon.listAdsProfiles({
        tenantId: s.tenantId,
        sellerAccountId: s.sellerAccountId,
        region,
      });
    } catch (e) {
      const code = (e as DomainError).code ?? "amazon_error";
      if (code === "refresh_token_invalid")
        await repo.markStatus(s, "ads", "needs_reauth", "invalid_grant");
      throw e;
    }
    const markets = await repo.knownMarketplaceIds();
    const currencies = await repo.knownCurrencies();
    const inputs: AdsProfileInput[] = list.map((p) => ({
      amazonProfileId: p.profileId,
      amazonAccountInfoId: p.accountInfoId,
      accountType: p.accountType,
      accountName: p.accountName,
      adsCountryCode: p.countryCode,
      marketplaceId:
        p.marketplaceStringId && markets.has(p.marketplaceStringId) ? p.marketplaceStringId : null,
      currency: p.currencyCode && currencies.has(p.currencyCode) ? p.currencyCode : null,
      timeZone: p.timezone,
      validPaymentMethod: p.validPaymentMethod,
    }));
    await withScope(deps.db, s, async (trx) => {
      await repo.syncProfiles(s, conn.id, inputs, trx);
      await deps.audit.writeIn(trx, s, {
        action: "ads_profiles.synced",
        actorLabel: a.email ?? null,
        targetType: "connection",
        targetId: "ads",
        details: { count: inputs.length, region: account.regionCode },
        traceId: a.traceId ?? null,
      });
    });
    return { count: inputs.length, synced: true };
  }

  return {
    async list(scope: Scope): Promise<ConnectionDto[]> {
      await accountOf(scope); // 404 when the account is not in the tenant
      return (await repo.list(scope)).map(toDto);
    },

    // --- SP-API self-authorization --------------------------------------------------------------------------------
    async connectSpapiSelfAuthorization(a: ActorInfo, input: { refreshToken: string }) {
      const token = input.refreshToken.trim();
      if (token.length < 20 || token.length > 2000 || /\s/.test(token))
        throw validationFailed([{ path: "/refreshToken", code: "invalid_format" }]);
      const { s, account, region } = await accountOf(a.scope);
      let participations;
      try {
        participations = await deps.amazon.validateSpapiRefreshToken({
          tenantId: s.tenantId,
          sellerAccountId: s.sellerAccountId,
          region,
          refreshToken: token,
        });
      } catch (e) {
        await deps.audit
          .write(s, {
            action: "connection.connect_failed",
            actorLabel: a.email ?? null,
            targetType: "connection",
            targetId: "spapi",
            outcome: "failure",
            details: { api: "spapi", code: (e as DomainError).code ?? "error" },
            traceId: a.traceId ?? null,
          })
          .catch(() => undefined);
        throw e;
      }
      const connection = await storeConnection(a, {
        api: "spapi",
        authMethod: "self_authorization",
        refreshToken: token,
        regionCode: account.regionCode,
        scopes: [],
      });
      return { connection: toDto(connection), marketplaces: participations };
    },

    // --- Ads: LWA authorization-code flow --------------------------------------------------------------------------
    async startAdsAuthorization(a: ActorInfo) {
      const { s, account } = await accountOf(a.scope);
      const app = deps.amazon.appCredential("ads");
      const state = randomBytes(32).toString("base64url");
      await repo.createState(s, {
        sellerAccountId: s.sellerAccountId,
        userId: a.scope.userId!,
        api: "ads",
        regionCode: account.regionCode,
        stateHash: sha256(state),
        ttlMs: STATE_TTL_MS,
      });
      let authorizationUrl: string;
      if (deps.amazon.mode === "replay") {
        // Mock mode (D30): no consent screen exists; send the browser straight to our own callback with a fake code.
        authorizationUrl = `${redirectUri}?${new URLSearchParams({ code: "mock-authorization-code", state })}`;
      } else {
        authorizationUrl = `${AUTHORIZE_URL[account.regionCode]}?${new URLSearchParams({
          client_id: app.clientId,
          scope: ADS_SCOPE,
          response_type: "code",
          redirect_uri: redirectUri,
          state,
        })}`;
      }
      await deps.audit.write(s, {
        action: "connection.authorization_started",
        actorLabel: a.email ?? null,
        targetType: "connection",
        targetId: "ads",
        details: { api: "ads" },
        traceId: a.traceId ?? null,
      });
      return { authorizationUrl, expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString() };
    },

    /** The callback page posts `code` and `state`; the state decides the seller account, not the caller. */
    async completeAdsAuthorization(a: ActorInfo, input: { code: string; state: string }) {
      const tenantScope: Scope = {
        tenantId: a.scope.tenantId,
        ...(a.scope.userId ? { userId: a.scope.userId } : {}),
      };
      const consumed = await repo.consumeState(tenantScope, sha256(input.state), "ads");
      if (!consumed || !consumed.sellerAccountId)
        throw new DomainError(
          "validation",
          "state_invalid",
          "This connection attempt expired or was already used. Start again.",
        );
      // The route is tenant-scoped (a seller-account-scoped Admin has no tenant-level connections.manage): check the
      // permission on the account the STATE names, as for every other account route (review M4).
      if (
        !(await deps.tenancy.can(
          a.scope.userId!,
          a.scope.tenantId,
          consumed.sellerAccountId,
          "connections.manage",
        ))
      )
        throw new DomainError("not_found", "not_found", "seller account not found");
      const scope: Scope = { ...tenantScope, sellerAccountId: consumed.sellerAccountId };
      const { account, region } = await accountOf(scope);
      const refreshToken = await deps.amazon.exchangeAuthorizationCode({
        api: "ads",
        region,
        code: input.code,
        redirectUri,
      });
      const connection = await storeConnection(
        { ...a, scope },
        {
          api: "ads",
          authMethod: "oauth_code",
          refreshToken,
          regionCode: account.regionCode,
          scopes: [ADS_SCOPE],
        },
      );
      let profiles = { count: 0, synced: false } as {
        count: number;
        synced: boolean;
        errorCode?: string;
      };
      try {
        profiles = await syncAdsProfiles({ ...a, scope });
      } catch (e) {
        profiles = { count: 0, synced: false, errorCode: (e as DomainError).code ?? "error" };
      }
      return { sellerAccountId: consumed.sellerAccountId, connection: toDto(connection), profiles };
    },

    // --- disconnect -------------------------------------------------------------------------------------------------
    /** Revokes locally: deletes the credential (crypto-shred) and marks the connection revoked. Amazon has no public
     * LWA revoke, so the UI tells the user to remove the app authorization on Amazon's side (ADR-0005 decision 6). */
    async disconnect(a: ActorInfo, api: ApiKind) {
      const { s } = await accountOf(a.scope);
      const conn = await repo.get(s, api);
      if (!conn) throw new DomainError("not_found", "not_found", "connection not found");
      await withScope(deps.db, s, async (trx) => {
        await repo.deleteCredentials(s, conn.id, trx);
        await repo.markStatus(s, api, "revoked", null, trx);
        await deps.audit.writeIn(trx, s, {
          action: "connection.disconnected",
          actorLabel: a.email ?? null,
          targetType: "connection",
          targetId: api,
          details: { api },
          traceId: a.traceId ?? null,
        });
      });
      return {
        ...toDto((await repo.get(s, api))!),
        note: `Remove the ${API_NAME[api]} authorization in Seller Central / the Ads console to finish.`,
      };
    },

    // --- Ads profiles -----------------------------------------------------------------------------------------------
    async listAdsProfiles(scope: Scope) {
      await accountOf(scope);
      return repo.listProfiles(scope);
    },

    refreshAdsProfiles: syncAdsProfiles,

    async linkAdsProfile(a: ActorInfo, amazonProfileId: string, marketplaceId: string) {
      const { s, account } = await accountOf(a.scope);
      const [profile, market] = await Promise.all([
        repo.getProfile(s, amazonProfileId),
        repo.getMarketplaceRef(marketplaceId),
      ]);
      if (!profile || profile.status === "unavailable")
        throw new DomainError("not_found", "not_found", "Ads profile not found");
      if (!market || market.regionCode !== account.regionCode)
        throw validationFailed([{ path: "/marketplaceId", code: "unknown_marketplace" }]);
      if (market.adsCountryCode !== profile.adsCountryCode)
        throw validationFailed([
          {
            path: "/marketplaceId",
            code: "profile_marketplace_mismatch",
            meta: { profileCountry: profile.adsCountryCode },
          },
        ]);
      await withScope(deps.db, s, async (trx) => {
        await repo.linkProfile(s, profile.id, marketplaceId, trx);
        await deps.audit.writeIn(trx, s, {
          action: "ads_profile.linked",
          actorLabel: a.email ?? null,
          targetType: "ads_profile",
          targetId: profile.id,
          details: { marketplaceId, countryCode: profile.adsCountryCode },
          traceId: a.traceId ?? null,
        });
      });
      return (await repo.getProfile(s, amazonProfileId))!;
    },

    async unlinkAdsProfile(a: ActorInfo, amazonProfileId: string) {
      const { s } = await accountOf(a.scope);
      const profile = await repo.getProfile(s, amazonProfileId);
      if (!profile) throw new DomainError("not_found", "not_found", "Ads profile not found");
      await withScope(deps.db, s, async (trx) => {
        await repo.unlinkProfile(s, profile.id, trx);
        await deps.audit.writeIn(trx, s, {
          action: "ads_profile.unlinked",
          actorLabel: a.email ?? null,
          targetType: "ads_profile",
          targetId: profile.id,
          details: { marketplaceId: profile.linkedMarketplaceId },
          traceId: a.traceId ?? null,
        });
      });
    },
  };
}

export type ConnectionsService = ReturnType<typeof connectionsService>;
