import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { createLogger } from "@seller-hub/core";
import { tryCreateTestDb } from "@seller-hub/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditWriter } from "../../../modules/platform-audit/src/public/platform-audit";
import {
  authenticate,
  authService,
  revokeSessionsOf,
} from "../../../modules/platform-auth/src/public/platform-auth";
import {
  composeAmazon,
  provideConnectionsServices,
} from "../../../modules/platform-connections/src/public/platform-connections";
import { provideTenancyServices } from "../../../modules/platform-tenancy/src/public/platform-tenancy";
import { buildApp, type BuiltApp } from "../src/app";

// The real thing end to end at the HTTP layer: generated route registry, real authenticator (opaque sessions), real
// guard, real Postgres with RLS, mock Amazon transport. Proves D55 roles are enforced in the API and that a member of
// tenant A can neither read nor act on tenant B's accounts.
const t = await tryCreateTestDb();
const PASSWORD = "correct horse battery staple";
const SP_TOKEN = "Atzr|self-authorized-sp-refresh-token-0123456789";

const logLines: string[] = [];
const logger = createLogger({
  name: "test",
  level: "debug",
  stream: new Writable({
    write(chunk, _enc, cb) {
      logLines.push(String(chunk));
      cb();
    },
  }),
});

interface Session {
  token: string;
  tenantId: string;
  userId: string;
}

describe.skipIf(!t)("identity over HTTP (real Postgres, mock Amazon)", () => {
  let built: BuiltApp;
  const bearer = (s: Session) => ({ authorization: `Bearer ${s.token}` });
  const secretsSeen: string[] = [];

  async function call(
    method: string,
    url: string,
    opts: { session?: Session; body?: unknown; headers?: Record<string, string> } = {},
  ) {
    const res = await built.app.inject({
      method: method as "GET",
      url,
      headers: { ...(opts.session ? bearer(opts.session) : {}), ...opts.headers },
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
    const text = res.body;
    return {
      status: res.statusCode,
      headers: res.headers,
      text,
      json: text ? safeJson(text) : null,
    };
  }
  const safeJson = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  async function setupTenant(email: string, tenantName: string): Promise<Session> {
    const { token: setupToken } = await authService().createSetupToken();
    const r = await call("POST", "/v1/auth/setup", {
      body: { setupToken, email, password: PASSWORD, tenantName },
    });
    expect(r.status).toBe(201);
    const token = String(r.headers["x-sh-session"]);
    secretsSeen.push(token, setupToken);
    return { token, tenantId: r.json.tenantId, userId: r.json.user.id };
  }

  async function signIn(email: string): Promise<Session> {
    const r = await call("POST", "/v1/auth/sign-in", { body: { email, password: PASSWORD } });
    expect(r.status).toBe(200);
    const token = String(r.headers["x-sh-session"]);
    secretsSeen.push(token);
    return { token, tenantId: r.json.tenantId, userId: r.json.user.id };
  }

  beforeAll(async () => {
    const audit = createAuditWriter(t!.app.db);
    const amazon = composeAmazon({
      env: { SH_MASTER_KEY: randomBytes(32).toString("base64") },
      db: t!.app.db,
      audit,
    });
    built = await buildApp({ logger, authenticator: authenticate });
    provideTenancyServices({
      db: t!.app.db,
      audit,
      permissionMatrix: built.permissionMatrix,
      webPublicUrl: "https://app.example.test",
      onPrivilegeChange: revokeSessionsOf,
    });
    provideConnectionsServices({ keys: amazon.keys, amazon: amazon.port });
  });
  afterAll(async () => {
    await built?.app.close();
    await t?.drop();
  });

  let alice: Session; // owner of tenant A
  let bob: Session; // owner of tenant B
  let accountA = "";
  let accountB = "";

  it("default-deny: no session, a malformed token and an unknown token are all 401 problem+json", async () => {
    for (const headers of [
      {},
      { authorization: "Bearer nope" },
      { authorization: `Bearer ${"a".repeat(43)}` },
    ]) {
      const r = await call("GET", "/v1/me", { headers });
      expect(r.status).toBe(401);
      expect(r.headers["content-type"]).toContain("application/problem+json");
      expect(r.json.code).toBe("unauthenticated");
    }
    expect((await call("GET", "/v1/members")).status).toBe(401);
  });

  it("setup: the first owner is created with a one-time token; the session token is a header, never in the body", async () => {
    alice = await setupTenant("alice@example.test", "Tenant A");
    const again = await call("POST", "/v1/auth/setup", {
      body: {
        setupToken: "x".repeat(43),
        email: "x@example.test",
        password: PASSWORD,
        tenantName: "Nope",
      },
    });
    expect(again.status).toBe(403);
    expect(again.json.code).toBe("setup_token_invalid");
    const r = await call("POST", "/v1/auth/sign-in", {
      body: { email: "alice@example.test", password: PASSWORD },
    });
    expect(r.text).not.toContain(String(r.headers["x-sh-session"]));
    expect(r.headers["x-sh-session-max-age"]).toBe(String(7 * 24 * 3600));
  });

  it("sign-in: wrong password is a 401 with the same body as an unknown e-mail", async () => {
    const wrong = await call("POST", "/v1/auth/sign-in", {
      body: { email: "alice@example.test", password: "wrong password here" },
    });
    const unknown = await call("POST", "/v1/auth/sign-in", {
      body: { email: "nobody@example.test", password: "wrong password here" },
    });
    expect(wrong.status).toBe(401);
    expect({ ...wrong.json, traceId: "" }).toEqual({ ...unknown.json, traceId: "" });
  });

  it("/v1/me returns the profile, tenant, roles and the permission list the UI uses", async () => {
    const r = await call("GET", "/v1/me", { session: alice });
    expect(r.status).toBe(200);
    expect(r.json.user.email).toBe("alice@example.test");
    expect(r.json.tenant.name).toBe("Tenant A");
    expect(r.json.roles).toEqual(["owner"]);
    expect(r.json.permissions).toEqual(
      expect.arrayContaining([
        "members.manage",
        "connections.manage",
        "tenant.manage",
        "session.read",
      ]),
    );
    expect(r.json.sellerAccounts).toEqual([]);
  });

  it("seller accounts: an owner creates one; input is validated against the contract and business rules", async () => {
    expect(
      (
        await call("POST", "/v1/seller-accounts", {
          session: alice,
          body: { name: "", regionCode: "NA" },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("POST", "/v1/seller-accounts", {
          session: alice,
          body: { name: "X", regionCode: "XX" },
        })
      ).status,
    ).toBe(422);
    expect(
      (await call("POST", "/v1/seller-accounts", { session: alice, body: { regionCode: "NA" } }))
        .status,
    ).toBe(400);
    const r = await call("POST", "/v1/seller-accounts", {
      session: alice,
      body: { name: "Acme US", regionCode: "NA" },
    });
    expect(r.status).toBe(201);
    accountA = r.json.id;
    const list = await call("GET", "/v1/seller-accounts", { session: alice });
    expect(list.json.items.map((a: { id: string }) => a.id)).toEqual([accountA]);
    const m = await call("GET", `/v1/seller-accounts/${accountA}/marketplaces`, { session: alice });
    expect(m.json.items.map((x: { marketplaceId: string }) => x.marketplaceId)).toEqual([
      "ATVPDKIKX0DER",
    ]);
  });

  it("tenant isolation over HTTP: tenant B's owner sees nothing of tenant A and gets 404 for every A id", async () => {
    bob = await setupTenant("bob@example.test", "Tenant B");
    const mine = await call("POST", "/v1/seller-accounts", {
      session: bob,
      body: { name: "Beta EU", regionCode: "EU" },
    });
    accountB = mine.json.id;
    expect(
      (await call("GET", "/v1/seller-accounts", { session: bob })).json.items.map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual([accountB]);
    expect(
      (await call("GET", "/v1/seller-accounts", { session: alice })).json.items.map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual([accountA]);

    const probes: [string, string, unknown?][] = [
      ["GET", `/v1/seller-accounts/${accountA}`],
      ["GET", `/v1/seller-accounts/${accountA}/marketplaces`],
      ["GET", `/v1/seller-accounts/${accountA}/connections`],
      ["GET", `/v1/seller-accounts/${accountA}/ads/profiles`],
      [
        "POST",
        `/v1/seller-accounts/${accountA}/connections/spapi/self-authorization`,
        { refreshToken: SP_TOKEN },
      ],
      ["POST", `/v1/seller-accounts/${accountA}/connections/ads/authorization`],
      ["POST", `/v1/seller-accounts/${accountA}/ads/profiles/refresh`],
      [
        "PUT",
        `/v1/seller-accounts/${accountA}/ads/profiles/1234567890/link`,
        { marketplaceId: "ATVPDKIKX0DER" },
      ],
      ["DELETE", `/v1/seller-accounts/${accountA}/connections/ads`],
    ];
    for (const [method, url, body] of probes) {
      const r = await call(method, url, { session: bob, ...(body ? { body } : {}) });
      expect(r.status, `${method} ${url}`).toBe(404);
      expect(r.json.code).toBe("not_found");
    }
    // and the other way round
    expect((await call("GET", `/v1/seller-accounts/${accountB}`, { session: alice })).status).toBe(
      404,
    );
    // members of A are invisible to B
    expect(
      (await call("GET", "/v1/members", { session: bob })).json.items.map(
        (m: { email: string }) => m.email,
      ),
    ).toEqual(["bob@example.test"]);
  });

  it("connect SP-API as owner over HTTP: the refresh token is validated, stored encrypted and never echoed or logged", async () => {
    const r = await call(
      "POST",
      `/v1/seller-accounts/${accountA}/connections/spapi/self-authorization`,
      { session: alice, body: { refreshToken: SP_TOKEN } },
    );
    expect(r.status).toBe(200);
    expect(r.json.connection).toMatchObject({ api: "spapi", status: "active" });
    expect(r.text).not.toContain("self-authorized");
    secretsSeen.push(SP_TOKEN);
    const list = await call("GET", `/v1/seller-accounts/${accountA}/connections`, {
      session: alice,
    });
    expect(list.json.items).toHaveLength(1);
    expect(list.text).not.toContain("self-authorized");
  });

  it("Ads flow over HTTP: start, callback with code+state, profiles, choose one", async () => {
    const start = await call(
      "POST",
      `/v1/seller-accounts/${accountA}/connections/ads/authorization`,
      { session: alice },
    );
    expect(start.status).toBe(200);
    const url = new URL(start.json.authorizationUrl);
    const body = { code: url.searchParams.get("code"), state: url.searchParams.get("state") };
    secretsSeen.push(body.code!, body.state!);
    // tenant B cannot complete A's flow
    expect(
      (await call("POST", "/v1/connections/ads/callback", { session: bob, body })).status,
    ).toBe(422);
    const done = await call("POST", "/v1/connections/ads/callback", { session: alice, body });
    expect(done.status).toBe(200);
    expect(done.json.sellerAccountId).toBe(accountA);
    expect(done.json.profiles).toMatchObject({ count: 1, synced: true });
    const profiles = await call("GET", `/v1/seller-accounts/${accountA}/ads/profiles`, {
      session: alice,
    });
    expect(profiles.json.items[0]).toMatchObject({
      amazonProfileId: "1234567890",
      status: "available",
    });
    const link = await call("PUT", `/v1/seller-accounts/${accountA}/ads/profiles/1234567890/link`, {
      session: alice,
      body: { marketplaceId: "ATVPDKIKX0DER" },
    });
    expect(link.status).toBe(200);
    expect(link.json.status).toBe("linked");
  });

  it("D55 roles are enforced in the API: a viewer reads but cannot manage; a manager cannot manage members or connections", async () => {
    const inv = await call("POST", "/v1/invitations", {
      session: alice,
      body: { email: "vera@example.test", role: "viewer" },
    });
    expect(inv.status).toBe(201);
    const token = new URL(inv.json.link).hash.replace("#token=", "");
    secretsSeen.push(token);
    const reg = await call("POST", "/v1/auth/invitations/register", {
      body: { token, password: PASSWORD, displayName: "Vera" },
    });
    expect(reg.status).toBe(201);
    const vera: Session = {
      token: String(reg.headers["x-sh-session"]),
      tenantId: reg.json.tenantId,
      userId: reg.json.user.id,
    };

    expect((await call("GET", "/v1/me", { session: vera })).json.roles).toEqual(["viewer"]);
    expect(
      (await call("GET", `/v1/seller-accounts/${accountA}/connections`, { session: vera })).status,
    ).toBe(200);
    expect((await call("GET", "/v1/members", { session: vera })).status).toBe(200);
    expect((await call("GET", "/v1/ref/marketplaces", { session: vera })).status).toBe(200);
    for (const [method, url, body] of [
      [
        "POST",
        `/v1/seller-accounts/${accountA}/connections/spapi/self-authorization`,
        { refreshToken: SP_TOKEN },
      ],
      ["POST", `/v1/seller-accounts/${accountA}/connections/ads/authorization`, undefined],
      ["DELETE", `/v1/seller-accounts/${accountA}/connections/spapi`, undefined],
      ["POST", "/v1/invitations", { email: "z@example.test", role: "viewer" }],
      ["GET", "/v1/invitations", undefined],
      ["POST", "/v1/seller-accounts", { name: "Nope", regionCode: "NA" }],
    ] as [string, string, unknown][]) {
      const r = await call(method, url, { session: vera, ...(body ? { body } : {}) });
      expect(r.status, `${method} ${url}`).toBe(403);
      expect(r.json.code).toBe("forbidden");
    }

    // promote to manager: still no members/connections management (only owner/admin)
    const members = (await call("GET", "/v1/members", { session: alice })).json.items as {
      membershipId: string;
      email: string;
    }[];
    const veraMembership = members.find((m) => m.email === "vera@example.test")!.membershipId;
    const promoted = await call("PUT", `/v1/members/${veraMembership}/roles`, {
      session: alice,
      body: { grants: [{ role: "manager", sellerAccountId: null }] },
    });
    expect(promoted.status).toBe(200);
    // the privilege change revoked Vera's sessions: she signs in again
    expect((await call("GET", "/v1/me", { session: vera })).status).toBe(401);
    const manager = await signIn("vera@example.test");
    expect(
      (
        await call("POST", "/v1/invitations", {
          session: manager,
          body: { email: "z@example.test", role: "viewer" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("POST", `/v1/seller-accounts/${accountA}/connections/ads/authorization`, {
          session: manager,
        })
      ).status,
    ).toBe(403);

    // an admin can manage members but cannot touch an owner
    await call("PUT", `/v1/members/${veraMembership}/roles`, {
      session: alice,
      body: { grants: [{ role: "admin", sellerAccountId: null }] },
    });
    const admin = await signIn("vera@example.test");
    expect(
      (
        await call("POST", "/v1/invitations", {
          session: admin,
          body: { email: "z@example.test", role: "viewer" },
        })
      ).status,
    ).toBe(201);
    const aliceMembership = members.find((m) => m.email === "alice@example.test")!.membershipId;
    const demote = await call("PUT", `/v1/members/${aliceMembership}/roles`, {
      session: admin,
      body: { grants: [{ role: "viewer", sellerAccountId: null }] },
    });
    expect(demote.status).toBe(403);
    expect(demote.json.code).toBe("owner_required");
    // the last owner cannot be removed even by an owner
    expect(
      (await call("DELETE", `/v1/members/${aliceMembership}`, { session: alice })).json.code,
    ).toBe("last_owner");
  });

  it("a seller-account-scoped grant reaches only that account", async () => {
    const second = await call("POST", "/v1/seller-accounts", {
      session: alice,
      body: { name: "Acme CA", regionCode: "NA" },
    });
    const accountA2 = second.json.id as string;
    const inv = await call("POST", "/v1/invitations", {
      session: alice,
      body: { email: "sam@example.test", role: "manager", sellerAccountId: accountA2 },
    });
    const token = new URL(inv.json.link).hash.replace("#token=", "");
    const reg = await call("POST", "/v1/auth/invitations/register", {
      body: { token, password: PASSWORD },
    });
    const sam: Session = {
      token: String(reg.headers["x-sh-session"]),
      tenantId: reg.json.tenantId,
      userId: reg.json.user.id,
    };
    expect(
      (await call("GET", "/v1/seller-accounts", { session: sam })).json.items.map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual([accountA2]);
    expect((await call("GET", `/v1/seller-accounts/${accountA2}`, { session: sam })).status).toBe(
      200,
    );
    expect((await call("GET", `/v1/seller-accounts/${accountA}`, { session: sam })).status).toBe(
      404,
    );
    expect(
      (await call("GET", "/v1/me", { session: sam })).json.sellerAccounts.map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual([accountA2]);
  });

  it("preferences (column layout): stored per user and tenant, validated", async () => {
    const put = await call("PUT", "/v1/me/preferences/ads.campaigns.grid", {
      session: alice,
      body: { value: { hidden: ["acos"], pinned: ["name"] } },
    });
    expect(put.status).toBe(200);
    expect(
      (await call("GET", "/v1/me/preferences/ads.campaigns.grid", { session: alice })).json.value,
    ).toEqual({ hidden: ["acos"], pinned: ["name"] });
    expect(
      (await call("GET", "/v1/me/preferences/ads.campaigns.grid", { session: bob })).status,
    ).toBe(404);
    expect(
      (await call("PUT", "/v1/me/preferences/Bad_Key", { session: alice, body: { value: {} } }))
        .status,
    ).toBe(422);
    expect(
      (await call("DELETE", "/v1/me/preferences/ads.campaigns.grid", { session: alice })).status,
    ).toBe(204);
  });

  it("reference data endpoints serve ref.marketplaces and ref.ads_limits", async () => {
    const m = await call("GET", "/v1/ref/marketplaces", { session: alice });
    expect(m.json.items.find((x: { id: string }) => x.id === "ATVPDKIKX0DER")).toMatchObject({
      countryCode: "US",
      currency: "USD",
      timeZone: "America/Los_Angeles",
    });
    const l = await call("GET", "/v1/ref/ads-limits?marketplaceId=ATVPDKIKX0DER", {
      session: alice,
    });
    expect(l.json.items.length).toBeGreaterThan(0);
    expect(
      l.json.items.every((x: { marketplaceId: string }) => x.marketplaceId === "ATVPDKIKX0DER"),
    ).toBe(true);
  });

  it("switching tenant rotates the session; a stranger's tenant id is 404", async () => {
    expect(
      (
        await call("POST", "/v1/auth/switch-tenant", {
          session: alice,
          body: { tenantId: bob.tenantId },
        })
      ).status,
    ).toBe(404);
  });

  it("sign-out revokes the session and asks the BFF to clear its cookie", async () => {
    const s = await signIn("alice@example.test");
    const out = await call("POST", "/v1/auth/sign-out", { session: s });
    expect(out.status).toBe(204);
    expect(out.headers["x-sh-session-clear"]).toBe("1");
    expect((await call("GET", "/v1/me", { session: s })).status).toBe(401);
  });

  it("audit: sign-in, membership and connection events are recorded per tenant; no secret appears in the log table", async () => {
    const { rows } = await sql<{
      tenant_id: string;
      action: string;
    }>`select tenant_id, action from ops.audit_log`.execute(t!.owner.db);
    const aActions = rows.filter((r) => r.tenant_id === alice.tenantId).map((r) => r.action);
    expect(aActions).toEqual(
      expect.arrayContaining([
        "auth.login",
        "auth.logout",
        "member.invited",
        "member.joined",
        "member.roles_changed",
        "connection.connected",
        "ads_profile.linked",
        "seller_account.created",
      ]),
    );
    expect(rows.filter((r) => r.tenant_id === bob.tenantId).map((r) => r.action)).not.toContain(
      "member.invited",
    );
    const all = (
      await sql`select details, actor_label, target_id from ops.audit_log`.execute(t!.owner.db)
    ).rows;
    for (const secret of secretsSeen) expect(JSON.stringify(all)).not.toContain(secret);
  });

  it("no secret (session token, setup token, invitation token, OAuth code/state, refresh token) is in any log line or error body", () => {
    const logs = logLines.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of secretsSeen)
      expect(logs, "log must not contain a secret").not.toContain(secret);
    expect(logs).not.toContain(PASSWORD);
    expect(logs.toLowerCase()).not.toContain("set-cookie");
  });
});
