import {
  createAesGcmCipher,
  createAmazonRuntime,
  createFetchTransport,
  parseAmazonMode,
  type AmazonMode,
  type AmazonRuntime,
  type HttpTransport,
} from "@seller-hub/amazon-core";
import { createReplayTransport, type Fixture } from "@seller-hub/amazon-core/testing";
import { adsFixtures } from "@seller-hub/amazon-ads/testing";
import { spFixtures } from "@seller-hub/amazon-sp/testing";
import type { Logger } from "@seller-hub/core";
import type { Database } from "@seller-hub/db";
import type { AuditWriter } from "@seller-hub/mod-platform-audit";
import type { Redis } from "ioredis";
import { envKeyProvider, type KeyProvider } from "../vault/envelope";
import { vaultCredentialSource } from "../vault/vault-credential-source";
import { createAmazonPort, type AmazonPort, type LwaAppConfig } from "./amazon-port";

// Composition of the Amazon side for the API (and later the worker): vault-backed credential source -> runtime ->
// port. `SH_AMAZON_MODE` unset means `replay` (D30 is OPEN): every Amazon call is answered by fixtures, nothing reaches a
// live account. The app credentials (LWA client id/secret) are the deployment's, from env; in replay mode obviously fake
// ones are used when none are set so the flow can be exercised end to end.

// The two read operations the connect flows use, embedded as data. `apps/api` is bundled into one dist/main.js (tsup), where
// the fixture directories of packages/amazon-* (read from disk, relative to their source file) do not exist - and the staging
// preview runs that bundle in replay mode (D30). Shapes follow packages/amazon-{ads,sp}/fixtures (themselves shaped from
// Amazon's models: profiles-3-0 `Profile`, sellers@v1 `MarketplaceParticipation`).
const EMBEDDED_READ_FIXTURES: Fixture[] = [
  {
    name: "listProfiles (embedded)",
    match: { method: "GET", path: "/v2/profiles" },
    response: {
      status: 200,
      json: [
        {
          profileId: 1234567890,
          countryCode: "US",
          currencyCode: "USD",
          dailyBudget: 0,
          timezone: "America/Los_Angeles",
          accountInfo: {
            marketplaceStringId: "ATVPDKIKX0DER",
            id: "ENTITY1ABC",
            type: "seller",
            name: "Fixture Seller",
            validPaymentMethod: true,
          },
        },
      ],
    },
  },
  {
    name: "sellers.getMarketplaceParticipations (embedded)",
    match: { method: "GET", path: "/sellers/v1/marketplaceParticipations" },
    response: {
      status: 200,
      headers: { "x-amzn-RequestId": "fixture-req-1" },
      json: {
        payload: [
          {
            marketplace: {
              id: "ATVPDKIKX0DER",
              countryCode: "US",
              name: "Amazon.com",
              defaultCurrencyCode: "USD",
              defaultLanguageCode: "en_US",
              domainName: "www.amazon.com",
            },
            participation: { isParticipating: true, hasSuspendedListings: false },
          },
          {
            marketplace: {
              id: "A2EUQ1WTGCTBG2",
              countryCode: "CA",
              name: "Amazon.ca",
              defaultCurrencyCode: "CAD",
              defaultLanguageCode: "en_CA",
              domainName: "www.amazon.ca",
            },
            participation: { isParticipating: true, hasSuspendedListings: false },
          },
        ],
      },
    },
  },
];

/** Fixtures from the packages' directories when they exist on disk (dev, tests); nothing when bundled. */
function diskFixtures(load: () => Fixture[]): Fixture[] {
  try {
    return load();
  } catch {
    return [];
  }
}

export const MOCK_AUTH_CODE = "mock-authorization-code";
export const MOCK_ADS_REFRESH_TOKEN = "Atzr|mock-ads-refresh-token-not-real";

/** Extra replay fixtures this module needs: the LWA authorization-code exchange. */
export function connectionsReplayFixtures(): Fixture[] {
  return [
    {
      name: "lwa authorization_code (mock)",
      match: { method: "POST", path: "/auth/o2/token", bodyIncludes: `code=${MOCK_AUTH_CODE}` },
      response: {
        status: 200,
        json: {
          access_token: "Atza|mock-access-token",
          refresh_token: MOCK_ADS_REFRESH_TOKEN,
          token_type: "bearer",
          expires_in: 3600,
        },
      },
    },
    {
      name: "lwa authorization_code rejected (mock)",
      match: {
        method: "POST",
        path: "/auth/o2/token",
        bodyIncludes: "grant_type=authorization_code",
      },
      response: { status: 400, json: { error: "invalid_grant", error_description: "mock" } },
    },
    {
      name: "lwa refresh_token rejected (mock, token containing 'invalid')",
      match: { method: "POST", path: "/auth/o2/token", bodyIncludes: "invalid-refresh-token" },
      response: { status: 400, json: { error: "invalid_grant", error_description: "mock" } },
    },
  ];
}

const FAKE_APP = {
  clientId: "amzn1.application-oa2-client.mock0000000000000000000000000000",
  clientSecret: "mock-client-secret-not-real",
};

export function appConfigFromEnv(
  env: Record<string, string | undefined>,
  mode: AmazonMode,
): LwaAppConfig {
  const read = (p: "SPAPI" | "ADS") => {
    const clientId = env[`${p}_LWA_CLIENT_ID`];
    const clientSecret = env[`${p}_LWA_CLIENT_SECRET`];
    if (clientId && clientSecret) return { clientId, clientSecret };
    return mode === "replay" ? FAKE_APP : undefined;
  };
  const sp = read("SPAPI");
  const ads = read("ADS");
  return { ...(sp ? { sp } : {}), ...(ads ? { ads } : {}) };
}

export interface AmazonStack {
  keys: KeyProvider;
  runtime: AmazonRuntime;
  port: AmazonPort;
  mode: AmazonMode;
  transport: HttpTransport;
}

export function composeAmazon(opts: {
  env: Record<string, string | undefined>;
  db: Database;
  audit: AuditWriter;
  logger?: Logger;
  redis?: Redis;
  /** Tests inject a transport (a MockTransport); production uses fetch, replay mode uses the fixtures. */
  transport?: HttpTransport;
  mode?: AmazonMode;
}): AmazonStack {
  const keys = envKeyProvider(opts.env); // fails closed when no key is configured
  const mode = opts.mode ?? parseAmazonMode(opts.env.SH_AMAZON_MODE);
  const app = appConfigFromEnv(opts.env, mode);
  const transport =
    opts.transport ??
    (mode === "replay"
      ? createReplayTransport({
          fixtures: [
            ...connectionsReplayFixtures(),
            ...EMBEDDED_READ_FIXTURES,
            ...diskFixtures(adsFixtures),
            ...diskFixtures(spFixtures),
          ],
        })
      : createFetchTransport());
  const credentials = vaultCredentialSource({ db: opts.db, keys, app, audit: opts.audit });
  const runtime = createAmazonRuntime({
    credentials,
    mode,
    transport,
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(opts.redis
      ? { redis: opts.redis, cipher: createAesGcmCipher(keys.derive("amazon-token-cache")) }
      : {}),
  });
  const port = createAmazonPort({ runtime, transport, mode, app });
  return { keys, runtime, port, mode, transport };
}
