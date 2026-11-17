import { randomBytes } from "node:crypto";
import { jsonResponse, MockTransport } from "@seller-hub/amazon-core/testing";
import { uuidv7 } from "@seller-hub/core";
import { withScope } from "@seller-hub/db";
import { createAuditWriter } from "@seller-hub/mod-platform-audit";
import { tenancyRepository, tenancyService } from "@seller-hub/mod-platform-tenancy";
import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import permissions from "../../platform-tenancy/src/permissions/platform-tenancy.permissions";
import { composeAmazon, MOCK_ADS_REFRESH_TOKEN } from "../src/amazon/compose";
import { connectionsRepository } from "../src/repository/platform-connections/connections-repository";
import { connectionsService } from "../src/service/platform-connections/connections-service";
import { open } from "../src/vault/envelope";
import { vaultCredentialSource } from "../src/vault/vault-credential-source";

const t = await tryCreateTestDb();
const matrix = new Map(permissions.map((p) => [p.permission, new Set(p.roles)]));
const ENV = { SH_MASTER_KEY: randomBytes(32).toString("base64"), SH_AMAZON_MODE: "replay" };
const SP_TOKEN = "Atzr|self-authorized-sp-refresh-token-0123456789";

// Cross-tenant fixtures: tenant A (+ seller account) and tenant B (+ seller account) from the platform seed.
const A = { tenantId: FIXTURE.tenantId, sellerAccountId: FIXTURE.sellerAccountId };
const B = { tenantId: FIXTURE.otherTenantId, sellerAccountId: FIXTURE.otherSellerAccountId };

describe.skipIf(!t)("connections (real Postgres, mock Amazon transport)", () => {
  const userA = uuidv7();
  const userB = uuidv7();
  let svc: ReturnType<typeof connectionsService>;
  let amazon: ReturnType<typeof composeAmazon>;
  let repo: ReturnType<typeof connectionsRepository>;
  const actorA = () => ({ scope: { ...A, userId: userA }, email: "a@example.test" });
  const actorB = () => ({ scope: { ...B, userId: userB }, email: "b@example.test" });

  beforeAll(async () => {
    await seedFixtures(t!);
    for (const [id, email] of [
      [userA, "a@example.test"],
      [userB, "b@example.test"],
    ] as const)
      await sql`insert into identity.users (id, email) values (${id}, ${email})`.execute(
        t!.owner.db,
      );
    // the callback checks connections.manage on the account the state names, so the actors need real grants
    const tenancyRepo = tenancyRepository(t!.app.db);
    for (const [uid, scope] of [
      [userA, A],
      [userB, B],
    ] as const) {
      const sc = { tenantId: scope.tenantId, userId: uid };
      const m = await tenancyRepo.createMembership(sc, uid);
      await tenancyRepo.replaceGrants(sc, m, [{ role: "owner", sellerAccountId: null }], null);
    }
    const audit = createAuditWriter(t!.app.db);
    amazon = composeAmazon({ env: ENV, db: t!.app.db, audit });
    const tenancy = tenancyService({
      db: t!.app.db,
      audit,
      permissionMatrix: matrix,
      webPublicUrl: "https://app.example.test",
    });
    svc = connectionsService({
      db: t!.app.db,
      audit,
      keys: amazon.keys,
      amazon: amazon.port,
      tenancy,
      webPublicUrl: "https://app.example.test",
    });
    repo = connectionsRepository(t!.app.db);
  });
  afterAll(async () => {
    await t?.drop();
  });

  const stateFrom = (url: string) => new URL(url).searchParams.get("state")!;
  const codeFrom = (url: string) => new URL(url).searchParams.get("code")!;

  it("SP-API self-authorization: validated with a read-only call, then stored encrypted; the token is never returned", async () => {
    const result = await svc.connectSpapiSelfAuthorization(actorA(), { refreshToken: SP_TOKEN });
    expect(result.connection).toMatchObject({
      api: "spapi",
      status: "active",
      authMethod: "self_authorization",
    });
    expect(result.marketplaces.map((m) => m.marketplaceId)).toContain("ATVPDKIKX0DER");
    expect(JSON.stringify(result)).not.toContain("self-authorized");

    const raw = await sql<{
      ciphertext: Buffer;
      wrapped_dek: Buffer;
      kind: string;
    }>`select ciphertext, wrapped_dek, kind from core.credentials`.execute(t!.owner.db);
    expect(raw.rows).toHaveLength(1);
    expect(raw.rows[0]!.kind).toBe("spapi_refresh");
    expect(raw.rows[0]!.ciphertext.toString("latin1")).not.toContain("self-authorized");
  });

  it("the vault CredentialSource decrypts for its own seller account only", async () => {
    const source = vaultCredentialSource({
      db: t!.app.db,
      keys: amazon.keys,
      app: { sp: { clientId: "c", clientSecret: "s" } },
      audit: createAuditWriter(t!.app.db),
    });
    expect(await source.getCredential({ ...A, api: "sp", region: "na" })).toMatchObject({
      refreshToken: SP_TOKEN,
      clientId: "c",
    });
    await expect(source.getCredential({ ...B, api: "sp", region: "na" })).rejects.toThrow(
      /no active sp credential/,
    );
  });

  it("a ciphertext copied to another seller account cannot be decrypted (AAD)", async () => {
    const stored = await repo.getSealedCredential(A, "spapi");
    await expect(
      open(
        amazon.keys,
        {
          tenantId: B.tenantId,
          sellerAccountId: B.sellerAccountId,
          kind: stored!.kind,
          region: stored!.regionCode,
        },
        stored!.sealed,
      ),
    ).rejects.toThrow();
  });

  it("an invalid token is rejected with a clear code and nothing is stored", async () => {
    const t2 = new MockTransport();
    t2.route(
      { method: "POST", path: "/auth/o2/token" },
      jsonResponse(400, { error: "invalid_grant" }),
    );
    const audit = createAuditWriter(t!.app.db);
    const stack = composeAmazon({ env: ENV, db: t!.app.db, audit, transport: t2 });
    const tenancy = tenancyService({
      db: t!.app.db,
      audit,
      permissionMatrix: matrix,
      webPublicUrl: "https://app.example.test",
    });
    const s2 = connectionsService({
      db: t!.app.db,
      audit,
      keys: stack.keys,
      amazon: stack.port,
      tenancy,
      webPublicUrl: "https://app.example.test",
    });
    await expect(
      s2.connectSpapiSelfAuthorization(
        { scope: { ...B, userId: userB } },
        { refreshToken: "Atzr|revoked-token-0123456789012345" },
      ),
    ).rejects.toMatchObject({ code: "refresh_token_invalid", kind: "validation" });
    expect(await repo.list(B)).toEqual([]);
    expect(
      (
        await sql`select 1 from core.credentials where tenant_id = ${B.tenantId}`.execute(
          t!.owner.db,
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      svc.connectSpapiSelfAuthorization(actorA(), {
        refreshToken: "has a space in it that is long enough",
      }),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("Ads: authorization-code flow with server-side state; profiles are listed and stored", async () => {
    const started = await svc.startAdsAuthorization(actorA());
    expect(started.authorizationUrl).toContain("/settings/connections/ads/callback"); // mock mode skips Amazon's consent page
    const state = stateFrom(started.authorizationUrl);
    const stored = await sql<{
      state_hash: Buffer;
    }>`select state_hash from core.connect_states`.execute(t!.owner.db);
    expect(stored.rows[0]!.state_hash.toString("utf8")).not.toContain(state); // hashed at rest

    // another user or tenant cannot complete someone else's flow
    await expect(
      svc.completeAdsAuthorization(
        { scope: { tenantId: B.tenantId, userId: userB } },
        { code: codeFrom(started.authorizationUrl), state },
      ),
    ).rejects.toMatchObject({ code: "state_invalid" });
    await expect(
      svc.completeAdsAuthorization(
        { scope: { tenantId: A.tenantId, userId: userB } },
        { code: codeFrom(started.authorizationUrl), state },
      ),
    ).rejects.toMatchObject({ code: "state_invalid" });
    await expect(
      svc.completeAdsAuthorization(actorA(), { code: "x", state: "forged-state-value" }),
    ).rejects.toMatchObject({ code: "state_invalid" });

    const done = await svc.completeAdsAuthorization(
      { scope: { tenantId: A.tenantId, userId: userA }, email: "a@example.test" },
      { code: codeFrom(started.authorizationUrl), state },
    );
    expect(done.connection).toMatchObject({
      api: "ads",
      status: "active",
      authMethod: "oauth_code",
      scopes: ["advertising::campaign_management"],
    });
    expect(done.profiles).toMatchObject({ count: 1, synced: true });
    expect(JSON.stringify(done)).not.toContain(MOCK_ADS_REFRESH_TOKEN);

    // the state is single use
    await expect(
      svc.completeAdsAuthorization(actorA(), { code: codeFrom(started.authorizationUrl), state }),
    ).rejects.toMatchObject({ code: "state_invalid" });

    const profiles = await svc.listAdsProfiles({ ...A, userId: userA });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      amazonProfileId: "1234567890",
      adsCountryCode: "US",
      currency: "USD",
      timeZone: "America/Los_Angeles",
      status: "available",
    });
  });

  it("Ads: a rejected authorization code stores nothing", async () => {
    const started = await svc.startAdsAuthorization(actorB());
    await expect(
      svc.completeAdsAuthorization(actorB(), {
        code: "some-other-code",
        state: stateFrom(started.authorizationUrl),
      }),
    ).rejects.toMatchObject({ code: "authorization_code_invalid" });
    expect(await repo.get(B, "ads")).toBeNull();
  });

  it("picks a profile: linking validates the marketplace, one profile per marketplace", async () => {
    const a = { ...actorA(), scope: { ...A, userId: userA } };
    await expect(svc.linkAdsProfile(a, "1234567890", "A2EUQ1WTGCTBG2")).rejects.toMatchObject({
      kind: "validation",
    }); // Canada vs US profile
    await expect(svc.linkAdsProfile(a, "1234567890", "A1PA6795UKMFR9")).rejects.toMatchObject({
      kind: "validation",
    }); // EU marketplace on an NA account
    await expect(svc.linkAdsProfile(a, "999", "ATVPDKIKX0DER")).rejects.toMatchObject({
      kind: "not_found",
    });
    const linked = await svc.linkAdsProfile(a, "1234567890", "ATVPDKIKX0DER");
    expect(linked).toMatchObject({ status: "linked", linkedMarketplaceId: "ATVPDKIKX0DER" });
    const row = await sql<{
      ads_profile_id: string;
    }>`select ads_profile_id from core.seller_account_marketplaces where seller_account_id = ${A.sellerAccountId}`.execute(
      t!.owner.db,
    );
    expect(row.rows[0]!.ads_profile_id).toBe(linked.id);
    await svc.unlinkAdsProfile(a, "1234567890");
    expect((await svc.listAdsProfiles({ ...A, userId: userA }))[0]).toMatchObject({
      status: "available",
      linkedMarketplaceId: null,
    });
  });

  it("tenant B cannot read, link, refresh or disconnect tenant A's connections (service and repository level)", async () => {
    expect(await repo.list(B)).toEqual([]);
    expect(await repo.get(B, "spapi")).toBeNull();
    expect(await repo.getSealedCredential(B, "spapi")).toBeNull();
    expect(await repo.listProfiles(B)).toEqual([]);
    expect(await repo.getProfile(B, "1234567890")).toBeNull();
    // addressing A's seller account from B's tenant: not found, whatever the operation
    const foreign = {
      scope: { tenantId: B.tenantId, sellerAccountId: A.sellerAccountId, userId: userB },
    };
    await expect(svc.list(foreign.scope)).rejects.toMatchObject({ kind: "not_found" });
    await expect(svc.disconnect(foreign, "spapi")).rejects.toMatchObject({ kind: "not_found" });
    await expect(svc.refreshAdsProfiles(foreign)).rejects.toMatchObject({ kind: "not_found" });
    await expect(svc.linkAdsProfile(foreign, "1234567890", "ATVPDKIKX0DER")).rejects.toMatchObject({
      kind: "not_found",
    });
    // RLS alone, unfiltered
    const counts = await withScope(t!.app.db, B, async (trx) => ({
      connections: (await sql`select 1 from core.connections`.execute(trx)).rows.length,
      credentials: (await sql`select 1 from core.credentials`.execute(trx)).rows.length,
      profiles: (await sql`select 1 from core.ads_profiles`.execute(trx)).rows.length,
    }));
    expect(counts).toEqual({ connections: 0, credentials: 0, profiles: 0 });
  });

  it("audit rows exist for connect and link events and never contain a token, code or state", async () => {
    const { rows } = await sql<{
      action: string;
      details: unknown;
    }>`select action, details from ops.audit_log where tenant_id = ${A.tenantId}`.execute(
      t!.owner.db,
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "connection.connected",
        "connection.authorization_started",
        "ads_profile.linked",
        "ads_profile.unlinked",
        "ads_profiles.synced",
      ]),
    );
    const text = JSON.stringify(rows);
    expect(text).not.toContain("self-authorized");
    expect(text).not.toContain(MOCK_ADS_REFRESH_TOKEN);
    expect(text).not.toContain("mock-authorization-code");
  });

  it("LWA invalid_grant flags the connection needs_reauth (vault markNeedsReauth)", async () => {
    const source = vaultCredentialSource({
      db: t!.app.db,
      keys: amazon.keys,
      app: {},
      audit: createAuditWriter(t!.app.db),
    });
    await source.markNeedsReauth!({ ...A, api: "sp", region: "na" });
    expect((await repo.get(A, "spapi"))?.status).toBe("needs_reauth");
    expect(await repo.getSealedCredential(A, "spapi")).toBeNull(); // no credential is handed out until reconnected
  });

  it("disconnect deletes the credential (crypto-shred) and marks the connection revoked", async () => {
    const out = await svc.disconnect(actorA(), "ads");
    expect(out).toMatchObject({ api: "ads", status: "revoked" });
    expect(out.note).toMatch(/Remove the Ads API authorization/);
    expect(await repo.getSealedCredential(A, "ads")).toBeNull();
    const left =
      await sql`select 1 from core.credentials where tenant_id = ${A.tenantId} and kind = 'ads_refresh'`.execute(
        t!.owner.db,
      );
    expect(left.rows).toHaveLength(0);
    // reconnecting works again
    const started = await svc.startAdsAuthorization(actorA());
    const again = await svc.completeAdsAuthorization(actorA(), {
      code: codeFrom(started.authorizationUrl),
      state: stateFrom(started.authorizationUrl),
    });
    expect(again.connection.status).toBe("active");
  });
});
