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
          fixtures: [...connectionsReplayFixtures(), ...adsFixtures(), ...spFixtures()],
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
