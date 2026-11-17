import { randomBytes } from "node:crypto";
import { ConnectionNeedsReauth } from "@seller-hub/amazon-core";
import { createTestRuntime, jsonResponse } from "@seller-hub/amazon-core/testing";
import { createSpClient } from "@seller-hub/amazon-sp";
import { withScope } from "@seller-hub/db";
import { createDbSellerDirectory, scopesFor, definePagedPull } from "@seller-hub/ingestion";
import { connectionsRepository, envKeyProvider, seal } from "@seller-hub/mod-platform-connections";
import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkerCredentials } from "../src/credentials";

// The vault wired into the worker (P3-IDENTITY): refresh tokens come from `core.credentials`, and LWA `invalid_grant`
// flags the connection `needs_reauth`, which the ingestion directory turns into a pause (M4). Mock transport only (D30).

const t = await tryCreateTestDb();
const A = { tenantId: FIXTURE.tenantId, sellerAccountId: FIXTURE.sellerAccountId };
const TOKEN = "Atzr|vault-stored-refresh-token-0123456789";
const ENV = {
  SH_MASTER_KEY: randomBytes(32).toString("base64"),
  SPAPI_LWA_CLIENT_ID: "amzn1.application-oa2-client.test",
  SPAPI_LWA_CLIENT_SECRET: "test-secret",
};

describe.skipIf(!t)("vault credential source in the worker", () => {
  beforeAll(async () => {
    await seedFixtures(t!);
    const repo = connectionsRepository(t!.app.db);
    const sealed = await seal(
      envKeyProvider(ENV),
      {
        tenantId: A.tenantId,
        sellerAccountId: A.sellerAccountId,
        kind: "spapi_refresh",
        region: "NA",
      },
      TOKEN,
    );
    await withScope(t!.app.db, A, async (trx) => {
      const id = await repo.upsertActive(
        A,
        {
          api: "spapi",
          regionCode: "NA",
          authMethod: "self_authorization",
          scopes: [],
          connectedBy: null,
        },
        trx,
      );
      await repo.replaceCredential(
        A,
        { connectionId: id, kind: "spapi_refresh", regionCode: "NA", sealed },
        trx,
      );
    });
  });
  afterAll(async () => {
    await t?.drop();
  });

  const scope = { tenantId: A.tenantId, sellerAccountId: A.sellerAccountId, region: "na" as const };

  it("a call by the ingestion clients exchanges the refresh token stored in the vault", async () => {
    const credentials = createWorkerCredentials({ env: ENV, db: t!.app.db, mode: "production" });
    const rt = createTestRuntime({ overrides: { credentials } });
    rt.transport.route(
      { path: "/sellers/v1/marketplaceParticipations" },
      jsonResponse(200, { payload: [] }),
    );
    await createSpClient(rt.runtime.client).sellers.getMarketplaceParticipations(scope);
    const lwa = rt.transport.callsTo({ method: "POST", path: "/auth/o2/token" })[0];
    expect(lwa?.bodyText).toContain("refresh_token=Atzr");
    expect(lwa?.bodyText).toContain("client_id=amzn1.application-oa2-client.test");
  });

  it("another seller account has no credential: the call fails instead of borrowing one", async () => {
    const credentials = createWorkerCredentials({ env: ENV, db: t!.app.db, mode: "production" });
    const rt = createTestRuntime({ overrides: { credentials } });
    await expect(
      createSpClient(rt.runtime.client).sellers.getMarketplaceParticipations({
        tenantId: FIXTURE.otherTenantId,
        sellerAccountId: FIXTURE.otherSellerAccountId,
        region: "na",
      }),
    ).rejects.toThrow(/no active sp credential/);
  });

  it("LWA invalid_grant marks the connection needs_reauth and the directory pauses the account's SP syncs", async () => {
    const directory = createDbSellerDirectory(t!.owner.db);
    const def = definePagedPull<unknown>({
      key: "x.sp",
      family: "paged-pull",
      fetchPage: async () => ({ rows: [] }),
      upsert: async () => {},
    });
    const before = await directory.getTarget(A);
    expect(before?.connected?.sp).toBe(true);
    expect(before?.paused.sp).toBeUndefined();
    expect(scopesFor(def as never, before!)).toEqual([""]);

    const credentials = createWorkerCredentials({ env: ENV, db: t!.app.db, mode: "production" });
    const rt = createTestRuntime({ overrides: { credentials } });
    rt.transport.route(
      { method: "POST", path: "/auth/o2/token" },
      jsonResponse(400, { error: "invalid_grant" }),
    );
    await expect(
      createSpClient(rt.runtime.client).sellers.getMarketplaceParticipations(scope),
    ).rejects.toBeInstanceOf(ConnectionNeedsReauth);

    const row = await sql<{ status: string }>`select status from core.connections
      where seller_account_id = ${A.sellerAccountId} and api = 'spapi'`.execute(t!.owner.db);
    expect(row.rows[0]?.status).toBe("needs_reauth");
    const after = await directory.getTarget(A);
    expect(after?.paused.sp).toBe("needs_reauth");
    expect(scopesFor(def as never, after!)).toEqual([]);
  });
});
