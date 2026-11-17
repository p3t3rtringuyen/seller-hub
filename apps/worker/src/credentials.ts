import type { AmazonMode, CredentialSource } from "@seller-hub/amazon-core";
import type { Database } from "@seller-hub/db";
import { createAuditWriter } from "@seller-hub/mod-platform-audit";
import { envKeyProvider, vaultCredentialSource } from "@seller-hub/mod-platform-connections";

// The worker's credential source: the vault (ADR-0005, P3-IDENTITY). The clients ask it for a seller account's refresh
// token; on LWA `invalid_grant` they call `markNeedsReauth`, which flags `core.connections` as `needs_reauth`. The
// ingestion directory reads that status, so the next tick pauses the account's syncs for that API (M4).
//
// Fails closed like the API: no master key (SH_MASTER_KEY / SH_MASTER_KEYS) means the worker does not start.

const FAKE_APP = {
  clientId: "amzn1.application-oa2-client.replay-fixture",
  clientSecret: "replay-fixture-secret-not-real",
};

/** LWA application credentials of the deployment (names in `.env.example`); fixtures stand in under `replay`. */
export function lwaAppFromEnv(
  env: Record<string, string | undefined>,
  mode: AmazonMode,
): {
  sp?: { clientId: string; clientSecret: string };
  ads?: { clientId: string; clientSecret: string };
} {
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

export function createWorkerCredentials(o: {
  env: Record<string, string | undefined>;
  /** `sh_app` connection: credentials are read under RLS, one seller account at a time. */
  db: Database;
  mode: AmazonMode;
}): CredentialSource {
  return vaultCredentialSource({
    db: o.db,
    keys: envKeyProvider(o.env),
    app: lwaAppFromEnv(o.env, o.mode),
    audit: createAuditWriter(o.db),
  });
}
