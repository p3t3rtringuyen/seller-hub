import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { createAuditWriter } from "@seller-hub/mod-platform-audit";
import { tenancyService } from "@seller-hub/mod-platform-tenancy";
import permissions from "../../platform-tenancy/src/permissions/platform-tenancy.permissions";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearerToken } from "../src/authenticator";
import { passwordProblem, sha256 } from "../src/crypto";
import { createLoginLimiter } from "../src/service/platform-auth/login-limiter";
import { identityService } from "../src/service/platform-auth/identity-service";

describe("passwords and tokens", () => {
  it("enforces length and rejects trivial passwords", () => {
    expect(passwordProblem("short")).toBe("too_short");
    expect(passwordProblem("aaaaaaaaaaaaaaaa")).toBe("too_simple");
    expect(passwordProblem("x".repeat(200))).toBe("too_long");
    expect(passwordProblem("correct horse battery", "someone@example.test")).toBeNull();
    expect(passwordProblem("someone-is-my-name", "someone@example.test")).toBe("contains_email");
  });
  it("accepts only well-formed bearer tokens", () => {
    expect(bearerToken("Bearer " + "a".repeat(43))).toBe("a".repeat(43));
    expect(bearerToken("Bearer short")).toBeNull();
    expect(bearerToken("Basic " + "a".repeat(43))).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe("login limiter", () => {
  it("reserves slots before the check: parallel attempts cannot exceed the budget", () => {
    const l = createLoginLimiter({ maxPerEmail: 3, maxPerIp: 100, windowMs: 1000 });
    const results = Array.from({ length: 10 }, () => l.reserve("a@example.test", "1.1.1.1"));
    expect(results.filter((r) => r === 0)).toHaveLength(3);
  });
  it("forgets after the window and forgives the e-mail on success", () => {
    let t = 0;
    const l = createLoginLimiter({ maxPerEmail: 2, windowMs: 1000, now: () => t });
    l.reserve("a@example.test", "1.1.1.1");
    l.reserve("a@example.test", "1.1.1.2");
    expect(l.reserve("a@example.test", "1.1.1.3")).toBeGreaterThan(0);
    l.success("a@example.test");
    expect(l.reserve("a@example.test", "1.1.1.4")).toBe(0);
    t = 5000;
    expect(l.reserve("a@example.test", "1.1.1.5")).toBe(0);
  });
  it("limits password spraying across e-mails per IP, and shares one bucket when the IP is unknown", () => {
    const l = createLoginLimiter({ maxPerIp: 3, maxUnknownIp: 5, windowMs: 1000 });
    const byIp = Array.from({ length: 6 }, (_v, i) => l.reserve(`u${i}@example.test`, "9.9.9.9"));
    expect(byIp.filter((r) => r === 0)).toHaveLength(3);
    const unknown = Array.from({ length: 8 }, (_v, i) => l.reserve(`v${i}@example.test`, null));
    expect(unknown.filter((r) => r === 0)).toHaveLength(5);
  });
  it("a flood of distinct e-mails evicts the oldest entries but never resets the target's counter", () => {
    const l = createLoginLimiter({
      maxPerEmail: 2,
      maxPerIp: 1e9,
      maxUnknownIp: 1e9,
      maxKeys: 100,
    });
    l.reserve("target@example.test", null);
    l.reserve("target@example.test", null);
    for (let i = 0; i < 50; i++) l.reserve(`noise${i}@example.test`, null);
    expect(l.reserve("target@example.test", null)).toBeGreaterThan(0);
  });
});

const t = await tryCreateTestDb();
const matrix = new Map(permissions.map((p) => [p.permission, new Set(p.roles)]));
const PASSWORD = "correct horse battery staple";

describe.skipIf(!t)("IdentityService (real Postgres)", () => {
  let identity: ReturnType<typeof identityService>;
  let tenancy: ReturnType<typeof tenancyService>;
  const revoked: string[] = [];

  beforeAll(async () => {
    await seedFixtures(t!);
    const audit = createAuditWriter(t!.app.db);
    tenancy = tenancyService({
      db: t!.app.db,
      audit,
      permissionMatrix: matrix,
      webPublicUrl: "https://app.example.test",
      onPrivilegeChange: async (u) => void revoked.push(u),
    });
    identity = identityService({
      db: t!.app.db,
      audit,
      tenancy,
      limiter: createLoginLimiter({ maxPerEmail: 5, maxPerIp: 1e9, maxUnknownIp: 1e9 }),
    });
  });
  afterAll(async () => {
    await t?.drop();
  });

  let ownerSession = "";
  let ownerTenant = "";

  it("there is no default admin: sign-in fails until a setup token is used", async () => {
    await expect(
      identity.signIn({ email: "owner@example.test", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    const users = await sql`select 1 from identity.users`.execute(t!.owner.db);
    expect(users.rows).toHaveLength(0);
  });

  it("setup: a single-use token creates the first owner, tenant and session; the token is stored hashed", async () => {
    const { token } = await identity.createSetupToken();
    const stored = await sql<{
      token_hash: Buffer;
    }>`select token_hash from identity.verifications`.execute(t!.owner.db);
    expect(stored.rows[0]!.token_hash.equals(sha256(token))).toBe(true);
    expect(stored.rows[0]!.token_hash.toString("utf8")).not.toContain(token);

    await expect(
      identity.setup({
        setupToken: "x".repeat(43),
        email: "owner@example.test",
        password: PASSWORD,
        tenantName: "Acme",
      }),
    ).rejects.toMatchObject({ code: "setup_token_invalid" });
    await expect(
      identity.setup({ setupToken: token, email: "bad", password: "short", tenantName: "Acme" }),
    ).rejects.toMatchObject({ kind: "validation" });
    const issued = await identity.setup(
      {
        setupToken: token,
        email: "Owner@Example.test",
        password: PASSWORD,
        displayName: "Olive",
        tenantName: "Acme",
      },
      { ip: "203.0.113.5", traceId: "trace-1" },
    );
    ownerSession = issued.token;
    ownerTenant = issued.tenantId;
    expect(issued.user.email).toBe("Owner@Example.test");
    await expect(
      identity.setup({
        setupToken: token,
        email: "second@example.test",
        password: PASSWORD,
        tenantName: "Acme 2",
      }),
    ).rejects.toMatchObject({ code: "setup_token_invalid" });
  });

  it("the password is argon2id, sessions are hashed at rest and resolve to the tenant", async () => {
    const auth = await sql<{
      password_hash: string;
    }>`select password_hash from identity.auth_accounts`.execute(t!.owner.db);
    expect(auth.rows[0]!.password_hash.startsWith("$argon2id$")).toBe(true);
    const sessions = await sql<{
      token_hash: Buffer;
    }>`select token_hash from identity.sessions`.execute(t!.owner.db);
    expect(sessions.rows[0]!.token_hash.equals(sha256(ownerSession))).toBe(true);
    const p = await identity.resolveSession(ownerSession);
    expect(p?.tenantId).toBe(ownerTenant);
    expect(await identity.resolveSession("unknown-token-that-is-long-enough-123456")).toBeNull();
  });

  it("sign-in: wrong password and unknown e-mail give the same error; success audits login", async () => {
    await expect(
      identity.signIn({ email: "owner@example.test", password: "wrong password here" }),
    ).rejects.toMatchObject({
      code: "invalid_credentials",
      message: "E-mail or password is incorrect",
    });
    await expect(
      identity.signIn({ email: "nobody@example.test", password: "wrong password here" }),
    ).rejects.toMatchObject({
      code: "invalid_credentials",
      message: "E-mail or password is incorrect",
    });
    const ok = await identity.signIn(
      { email: "owner@example.test", password: PASSWORD },
      { ip: "203.0.113.5" },
    );
    expect(ok.tenantId).toBe(ownerTenant);
    const audit = await sql<{ action: string; outcome: string; ip_address: string | null }>`
      select action, outcome, ip_address::text from ops.audit_log where tenant_id = ${ownerTenant} order by occurred_at`.execute(
      t!.owner.db,
    );
    const actions = audit.rows.map((r) => `${r.action}:${r.outcome}`);
    expect(actions).toEqual(
      expect.arrayContaining([
        "tenant.created:success",
        "auth.login:success",
        "auth.login_failed:failure",
      ]),
    );
    expect(JSON.stringify(audit.rows)).not.toContain(PASSWORD);
  });

  it("sign-in is throttled after repeated failures", async () => {
    for (let i = 0; i < 6; i++)
      await identity
        .signIn({ email: "victim@example.test", password: "wrong password here" })
        .catch(() => undefined);
    await expect(
      identity.signIn({ email: "victim@example.test", password: "wrong password here" }),
    ).rejects.toMatchObject({ code: "too_many_attempts", kind: "rate_limited" });
  });

  it("sign-out revokes the session immediately", async () => {
    const s = await identity.signIn({ email: "owner@example.test", password: PASSWORD });
    expect(await identity.resolveSession(s.token)).not.toBeNull();
    await identity.signOut(s.token);
    expect(await identity.resolveSession(s.token)).toBeNull();
  });

  it("idle and absolute expiry end a session", async () => {
    const s = await identity.signIn({ email: "owner@example.test", password: PASSWORD });
    await sql`update identity.sessions set idle_expires_at = now() - interval '1 second' where token_hash = ${sha256(s.token)}`.execute(
      t!.owner.db,
    );
    expect(await identity.resolveSession(s.token)).toBeNull();
    const s2 = await identity.signIn({ email: "owner@example.test", password: PASSWORD });
    await sql`update identity.sessions set absolute_expires_at = now() - interval '1 second' where token_hash = ${sha256(s2.token)}`.execute(
      t!.owner.db,
    );
    expect(await identity.resolveSession(s2.token)).toBeNull();
  });

  it("a disabled user cannot sign in and existing sessions stop working", async () => {
    const s = await identity.signIn({ email: "owner@example.test", password: PASSWORD });
    await sql`update identity.users set disabled_at = now()`.execute(t!.owner.db);
    expect(await identity.resolveSession(s.token)).toBeNull();
    await expect(
      identity.signIn({ email: "owner@example.test", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await sql`update identity.users set disabled_at = null`.execute(t!.owner.db);
  });

  it("invitation: a new person registers from the link, joins with the invited role and signs in", async () => {
    const actor = {
      scope: {
        tenantId: ownerTenant,
        userId: (await identity.resolveSession(ownerSession))!.userId,
      },
      email: "owner@example.test",
    };
    const { token } = await tenancy.createInvitation(actor, {
      email: "Analyst@Example.test",
      role: "analyst",
    });
    expect(await identity.previewInvitation(token)).toMatchObject({
      email: "analyst@example.test",
      accountExists: false,
    });
    await expect(
      identity.acceptInvitationNewUser({ token, password: "short" }),
    ).rejects.toMatchObject({ kind: "validation" });
    const s = await identity.acceptInvitationNewUser({
      token,
      password: PASSWORD,
      displayName: "Ana",
    });
    expect(s.tenantId).toBe(ownerTenant);
    const access = await tenancy.access(s.user.id, ownerTenant, null);
    expect(access?.roles).toEqual(["analyst"]);
    await expect(
      identity.acceptInvitationNewUser({ token, password: PASSWORD }),
    ).rejects.toMatchObject({ code: "invitation_invalid" });
  });

  it("invitation: an existing user accepts while signed in and gets a rotated session on the new tenant", async () => {
    // second tenant with its own owner
    const { token: setup2 } = await identity.createSetupToken();
    const second = await identity.setup({
      setupToken: setup2,
      email: "owner2@example.test",
      password: PASSWORD,
      tenantName: "Beta",
    });
    const owner2Actor = {
      scope: { tenantId: second.tenantId, userId: second.user.id },
      email: "owner2@example.test",
    };
    const { token } = await tenancy.createInvitation(owner2Actor, {
      email: "owner@example.test",
      role: "viewer",
    });
    expect(await identity.previewInvitation(token)).toMatchObject({ accountExists: true });
    const current = await identity.signIn({ email: "owner@example.test", password: PASSWORD });
    const moved = await identity.acceptInvitationSignedIn(
      { token: current.token, userId: current.user.id },
      token,
    );
    expect(moved.tenantId).toBe(second.tenantId);
    expect(moved.token).not.toBe(current.token);
    expect(await identity.resolveSession(current.token)).toBeNull(); // old token rotated away
    expect((await identity.resolveSession(moved.token))?.tenantId).toBe(second.tenantId);
    // switch back
    const back = await identity.switchTenant(
      { token: moved.token, userId: moved.user.id },
      ownerTenant,
    );
    expect((await identity.resolveSession(back.token))?.tenantId).toBe(ownerTenant);
    await expect(
      identity.switchTenant({ token: back.token, userId: back.user.id }, FIXTURE.otherTenantId),
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("a member removed from the tenant loses the tenant at once (sessions are revoked by the privilege hook)", async () => {
    const members = await tenancy.listMembers({
      tenantId: ownerTenant,
      userId: (await identity.resolveSession(ownerSession))!.userId,
    });
    const analyst = members.find((m) => m.email === "analyst@example.test")!;
    const actor = {
      scope: {
        tenantId: ownerTenant,
        userId: (await identity.resolveSession(ownerSession))!.userId,
      },
    };
    await tenancy.removeMember(actor, analyst.membershipId);
    expect(revoked).toContain(analyst.userId);
    await expect(
      identity.signIn({ email: "analyst@example.test", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "no_active_membership" });
  });

  it("a removed member who is re-invited can accept with their password (review M3)", async () => {
    const ownerId = (await identity.resolveSession(ownerSession))!.userId;
    const actor = {
      scope: { tenantId: ownerTenant, userId: ownerId },
      email: "owner@example.test",
    };
    const { token } = await tenancy.createInvitation(actor, {
      email: "analyst@example.test",
      role: "viewer",
    });
    expect(await identity.previewInvitation(token)).toMatchObject({ accountExists: true });
    await expect(
      identity.acceptInvitationNewUser({ token, password: PASSWORD }),
    ).rejects.toMatchObject({ code: "account_exists" });
    await expect(
      identity.acceptInvitationWithPassword({ token, password: "not the password at all" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    const s = await identity.acceptInvitationWithPassword({ token, password: PASSWORD });
    expect(s.tenantId).toBe(ownerTenant);
    expect((await tenancy.access(s.user.id, ownerTenant, null))?.roles).toEqual(["viewer"]);
  });

  it("a failed registration leaves no orphan account (review M3)", async () => {
    const ownerId = (await identity.resolveSession(ownerSession))!.userId;
    const actor = {
      scope: { tenantId: ownerTenant, userId: ownerId },
      email: "owner@example.test",
    };
    const { token } = await tenancy.createInvitation(actor, {
      email: "orphan@example.test",
      role: "viewer",
    });
    const failing = identityService({
      db: t!.app.db,
      audit: createAuditWriter(t!.app.db),
      tenancy: new Proxy(tenancy, {
        get: (target, prop, recv) =>
          prop === "acceptInvitation"
            ? async () => {
                throw new Error("boom");
              }
            : Reflect.get(target, prop, recv),
      }),
    });
    await expect(failing.acceptInvitationNewUser({ token, password: PASSWORD })).rejects.toThrow(
      "boom",
    );
    expect(
      (
        await sql`select 1 from identity.users where email_normalized = 'orphan@example.test'`.execute(
          t!.owner.db,
        )
      ).rows,
    ).toHaveLength(0);
    // and the invitation is still usable
    expect((await identity.acceptInvitationNewUser({ token, password: PASSWORD })).tenantId).toBe(
      ownerTenant,
    );
  });

  it("signing in again replaces the previous session of the same browser (QA FAIL-4)", async () => {
    const first = await identity.signIn({ email: "owner@example.test", password: PASSWORD });
    const second = await identity.signIn(
      { email: "owner@example.test", password: PASSWORD },
      { previousToken: first.token },
    );
    expect(await identity.resolveSession(first.token)).toBeNull();
    expect(await identity.resolveSession(second.token)).not.toBeNull();
  });
});
