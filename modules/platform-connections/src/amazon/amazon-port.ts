import {
  AmazonAuthError,
  ConnectionNeedsReauth,
  createAmazonRuntime,
  encodeText,
  jsonOf,
  lwaTokenUrl,
  type AmazonMode,
  type AmazonRuntime,
  type ApiFamily,
  type CredentialRef,
  type CredentialSource,
  type HttpTransport,
  type LwaAppCredential,
  type Region,
} from "@seller-hub/amazon-core";
import { createAdsClient, createProfilesPort } from "@seller-hub/amazon-ads";
import { createSpClient } from "@seller-hub/amazon-sp";
import { DomainError } from "@seller-hub/core";

// The only place this module talks to Amazon, always through packages/amazon-* (conventions §11): the LWA authorization-
// code exchange, a read-only validation call with a candidate SP-API token, and the Ads profile listing. Everything is
// injected, so tests and mock mode run on the same transport seam as production. Nothing here logs or throws a token,
// a code or an LWA body.

export interface LwaAppConfig {
  sp?: LwaAppCredential;
  ads?: LwaAppCredential;
}

export interface ParticipationSummary {
  marketplaceId: string;
  name: string;
  countryCode: string;
  isParticipating: boolean;
}

export interface AdsProfileSummary {
  profileId: string;
  countryCode: string;
  currencyCode: string | null;
  timezone: string;
  accountType: "seller" | "vendor" | "agency";
  accountName: string | null;
  accountInfoId: string | null;
  marketplaceStringId: string | null;
  validPaymentMethod: boolean | null;
}

export interface AmazonPort {
  readonly mode: AmazonMode;
  /** Authorization code -> refresh token (Ads website flow). */
  exchangeAuthorizationCode(input: {
    api: ApiFamily;
    region: Region;
    code: string;
    redirectUri: string;
  }): Promise<string>;
  /** Proves an SP-API self-authorization refresh token with `sellers.getMarketplaceParticipations` (read-only). */
  validateSpapiRefreshToken(input: {
    tenantId: string;
    sellerAccountId: string;
    region: Region;
    refreshToken: string;
  }): Promise<ParticipationSummary[]>;
  /** Lists the Ads profiles visible to the stored credential (EX-PROFILES). */
  listAdsProfiles(ref: {
    tenantId: string;
    sellerAccountId: string;
    region: Region;
  }): Promise<AdsProfileSummary[]>;
  /** App credential of this deployment, or throws a 502 DomainError when it is not configured. */
  appCredential(api: ApiFamily): LwaAppCredential;
}

export interface AmazonPortDeps {
  runtime: AmazonRuntime;
  transport: HttpTransport;
  mode: AmazonMode;
  app: LwaAppConfig;
}

const notConfigured = (api: ApiFamily) =>
  new DomainError(
    "upstream_failed",
    "amazon_app_not_configured",
    `The Amazon ${api === "sp" ? "SP-API" : "Ads API"} application credentials are not configured on this server`,
  );

export function createAmazonPort(deps: AmazonPortDeps): AmazonPort {
  const appCredential = (api: ApiFamily): LwaAppCredential => {
    const c = api === "sp" ? deps.app.sp : deps.app.ads;
    if (!c?.clientId || !c.clientSecret) throw notConfigured(api);
    return c;
  };

  return {
    mode: deps.mode,
    appCredential,

    async exchangeAuthorizationCode({ api, region, code, redirectUri }) {
      const app = appCredential(api);
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: app.clientId,
        client_secret: app.clientSecret,
      }).toString();
      let status: number;
      let parsed: { refresh_token?: string; error?: string } | undefined;
      try {
        const res = await deps.transport.send({
          method: "POST",
          url: lwaTokenUrl(region, api),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: encodeText(body),
          timeoutMs: 15_000,
        });
        status = res.status;
        parsed = jsonOf(res) as typeof parsed;
      } catch {
        throw new DomainError(
          "upstream_failed",
          "amazon_unreachable",
          "Login with Amazon could not be reached",
        );
      }
      if (status === 200 && parsed?.refresh_token) return parsed.refresh_token;
      if (status === 400 || status === 401)
        throw new DomainError(
          "validation",
          "authorization_code_invalid",
          "Amazon rejected the authorization code. Start the connection again.",
          [],
          { amazonError: parsed?.error ?? "unknown" },
        );
      throw new DomainError(
        "upstream_failed",
        "amazon_error",
        `Login with Amazon answered ${status}`,
      );
    },

    async validateSpapiRefreshToken({ tenantId, sellerAccountId, region, refreshToken }) {
      const app = appCredential("sp");
      // A throw-away runtime whose credential source returns the candidate token: it is never stored before it works.
      const candidate: CredentialSource = {
        async getCredential() {
          return { clientId: app.clientId, clientSecret: app.clientSecret, refreshToken };
        },
      };
      const { client } = createAmazonRuntime({
        credentials: candidate,
        mode: deps.mode,
        transport: deps.transport,
      });
      try {
        const res = await createSpClient(client).sellers.getMarketplaceParticipations({
          tenantId,
          sellerAccountId,
          region,
        });
        return (res.body?.payload ?? []).map((p) => ({
          marketplaceId: p.marketplace.id,
          name: p.marketplace.name,
          countryCode: p.marketplace.countryCode,
          isParticipating: p.participation.isParticipating,
        }));
      } catch (e) {
        throw mapAmazonError(e);
      }
    },

    async listAdsProfiles({ tenantId, sellerAccountId, region }) {
      try {
        const list = await createProfilesPort(createAdsClient(deps.runtime.client)).list({
          tenantId,
          sellerAccountId,
          region,
        });
        return (list ?? []).map((p) => ({
          profileId: String(p.profileId),
          countryCode: String(p.countryCode),
          currencyCode: p.currencyCode ? String(p.currencyCode) : null,
          timezone: String(p.timezone),
          accountType: (p.accountInfo?.type as AdsProfileSummary["accountType"]) ?? "seller",
          accountName: p.accountInfo?.name ?? null,
          accountInfoId: p.accountInfo?.id ?? null,
          marketplaceStringId: p.accountInfo?.marketplaceStringId ?? null,
          validPaymentMethod: p.accountInfo?.validPaymentMethod ?? null,
        }));
      } catch (e) {
        throw mapAmazonError(e);
      }
    },
  };
}

/** Maps client-layer failures to our codes at the boundary; the Amazon body never reaches the response. */
export function mapAmazonError(e: unknown): DomainError {
  if (e instanceof DomainError) return e;
  if (e instanceof ConnectionNeedsReauth)
    return new DomainError(
      "validation",
      "refresh_token_invalid",
      "Amazon no longer accepts this authorization. Reconnect the account.",
    );
  if (e instanceof AmazonAuthError)
    return new DomainError(
      "validation",
      "refresh_token_invalid",
      "Amazon rejected this authorization. Check the token and try again.",
    );
  const status = (e as { context?: { status?: number } })?.context?.status;
  if (status === 429)
    return new DomainError(
      "upstream_throttled",
      "amazon_throttled",
      "Amazon is throttling requests. Try again shortly.",
    );
  return new DomainError(
    "upstream_failed",
    "amazon_error",
    "Amazon could not be reached or answered with an error",
  );
}

/** The CredentialRef a stored credential is addressed by (region in amazon-core's lower-case form). */
export const credentialRef = (
  tenantId: string,
  sellerAccountId: string,
  api: ApiFamily,
  region: Region,
): CredentialRef => ({ tenantId, sellerAccountId, api, region });
