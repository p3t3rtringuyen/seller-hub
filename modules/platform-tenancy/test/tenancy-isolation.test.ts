import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { uuidv7 } from "@seller-hub/core";
import { createAuditWriter } from "@seller-hub/mod-platform-audit";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import permissions from "../src/permissions/platform-tenancy.permissions";
import { tenancyRepository } from "../src/repository/platform-tenancy/tenancy-repository";
import { hashToken, tenancyService } from "../src/service/platform-tenancy/tenancy-service";
import { userScope } from "../src/types";

// Cross-tenant tests (CLAUDE.md tenancy rule, ADR-0004): connection = sh_app (NOBYPASSRLS), real Postgres 16.
const t = await tryCreateTestDb();
const A = { tenantId: FIXTURE.tenantId };
const B = { tenantId: FIXTURE.otherTenantId };
const matrix = new Map(permissions.map((p) => [p.permission, new Set(p.roles)]));
const ownerA = uuidv7();
const ownerB = uuidv7();

afterAll(async () => {
  await t?.drop();
});

describe.skipIf(!t)("tenancyRepository - tenant isolation", () => {
  let repo: ReturnType<typeof tenancyRepository>;
  let membershipA = "";
  let membershipB = "";

  beforeAll(async () => {
    await seedFixtures(t!);
    repo = tenancyRepository(t!.app.db);
    // arrange as sh_owner (bypasses RLS on purpose)
    for (const [id, email] of [
      [ownerA, "owner-a@example.test"],
      [ownerB, "owner-b@example.test"],
    ] as const)
      await sql`insert into identity.users (id, email) values (${id}, ${email})`.execute(
        t!.owner.db,
      );
    membershipA = await repo.createMembership({ ...A, userId: ownerA }, ownerA);
    membershipB = await repo.createMembership({ ...B, userId: ownerB }, ownerB);
    await repo.replaceGrants(
      { ...A, userId: ownerA },
      membershipA,
      [{ role: "owner", sellerAccountId: null }],
      null,
    );
    await repo.replaceGrants(
      { ...B, userId: ownerB },
      membershipB,
      [{ role: "owner", sellerAccountId: null }],
      null,
    );
    await repo.createInvitation(A, {
      email: "inv-a@example.test",
      role: "viewer",
      sellerAccountId: null,
      tokenHash: hashToken("tok-a"),
      expiresAt: new Date(Date.now() + 1e6),
      invitedBy: ownerA,
    });
    await repo.putPreference({ ...A, userId: ownerA }, ownerA, "ads.campaigns.grid", {
      hidden: ["acos"],
    });
  });

  it("tenant: each scope sees only its own tenant row", async () => {
    expect((await repo.getTenant(A))?.id).toBe(A.tenantId);
    expect((await repo.getTenant(B))?.id).toBe(B.tenantId);
  });
  it("members: a tenant lists only its own members", async () => {
    expect((await repo.listMembers(A)).map((m) => m.email)).toEqual(["owner-a@example.test"]);
    expect((await repo.listMembers(B)).map((m) => m.email)).toEqual(["owner-b@example.test"]);
  });
  it("members: a membership id of another tenant is not found in this scope", async () => {
    expect(await repo.listGrants(A, membershipB)).toEqual([]);
    expect(await repo.findMembershipByUser(A, ownerB)).toBeNull();
  });
  it("grants: grants of another tenant's user are invisible", async () => {
    expect(await repo.listGrantsForUser(A, ownerB)).toEqual([]);
    expect((await repo.listGrantsForUser(A, ownerA)).map((g) => g.role)).toEqual(["owner"]);
  });
  it("invitations: tenant B cannot list, read or revoke tenant A's invitation", async () => {
    const [inv] = await repo.listInvitations(A);
    expect(inv?.email).toBe("inv-a@example.test");
    expect(await repo.listInvitations(B)).toEqual([]);
    expect(await repo.getInvitation(B, inv!.id)).toBeNull();
    expect(await repo.revokeInvitation(B, inv!.id)).toBe(false);
    expect((await repo.getInvitation(A, inv!.id))?.revokedAt).toBeNull();
  });
  it("seller accounts: a tenant sees only its own accounts, and not by guessing the id", async () => {
    expect((await repo.listSellerAccounts(A)).map((s) => s.id)).toEqual([FIXTURE.sellerAccountId]);
    expect(await repo.getSellerAccount(A, FIXTURE.otherSellerAccountId)).toBeNull();
    expect(await repo.listAccountMarketplaces(A, FIXTURE.otherSellerAccountId)).toEqual([]);
  });
  it("preferences: scoped by tenant and user", async () => {
    expect(
      await repo.getPreference({ ...A, userId: ownerA }, ownerA, "ads.campaigns.grid"),
    ).toEqual({ hidden: ["acos"] });
    expect(
      await repo.getPreference({ ...B, userId: ownerB }, ownerB, "ads.campaigns.grid"),
    ).toBeNull();
    expect(
      await repo.getPreference({ ...B, userId: ownerA }, ownerA, "ads.campaigns.grid"),
    ).toBeNull();
  });
  it("RLS alone: an unfiltered statement in scope B never returns tenant A rows", async () => {
    const { withScope } = await import("@seller-hub/db");
    const rows = await withScope(t!.app.db, B, async (trx) => ({
      memberships: (await sql`select 1 from core.memberships`.execute(trx)).rows.length,
      grants: (await sql`select 1 from core.role_grants`.execute(trx)).rows.length,
      invitations: (await sql`select 1 from core.invitations`.execute(trx)).rows.length,
      accounts: (await sql`select 1 from core.seller_accounts`.execute(trx)).rows.length,
    }));
    expect(rows).toEqual({ memberships: 1, grants: 1, invitations: 0, accounts: 1 });
  });
  it("a write for another tenant is rejected by RLS (WITH CHECK)", async () => {
    const { withScope } = await import("@seller-hub/db");
    await expect(
      withScope(t!.app.db, B, (trx) =>
        sql`insert into core.invitations (id, tenant_id, email, role, token_hash, expires_at)
            values (${uuidv7()}, ${A.tenantId}, 'x@example.test', 'viewer', ${hashToken("x")}, now() + interval '1 day')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("a user sees their own memberships across tenants, never another user's", async () => {
    expect((await repo.listUserMemberships(userScope(ownerA))).map((m) => m.tenantId)).toEqual([
      A.tenantId,
    ]);
    expect((await repo.listUserMemberships(userScope(ownerB))).map((m) => m.tenantId)).toEqual([
      B.tenantId,
    ]);
  });
});

describe.skipIf(!t)("tenancyService - roles, owners and invitations", () => {
  const owner = uuidv7();
  const admin = uuidv7();
  const analyst = uuidv7();
  let svc: ReturnType<typeof tenancyService>;
  let ownerScope: { tenantId: string; userId: string };
  const revoked: string[] = [];
  const memberships: Record<string, string> = {};

  beforeAll(async () => {
    await seedFixtures(t!);
    // the repository suite above made its own owner of tenant A; the service suite needs exactly one owner
    await sql`delete from core.memberships where user_id = ${ownerA}`.execute(t!.owner.db);
    const repo = tenancyRepository(t!.app.db);
    svc = tenancyService({
      db: t!.app.db,
      audit: createAuditWriter(t!.app.db),
      permissionMatrix: matrix,
      webPublicUrl: "https://app.example.test",
      onPrivilegeChange: async (u) => void revoked.push(u),
    });
    ownerScope = { tenantId: FIXTURE.tenantId, userId: owner };
    for (const [id, email] of [
      [owner, "o@example.test"],
      [admin, "a@example.test"],
      [analyst, "an@example.test"],
    ] as const)
      await sql`insert into identity.users (id, email) values (${id}, ${email})`.execute(
        t!.owner.db,
      );
    const roles: Record<string, "owner" | "admin" | "analyst"> = {
      [owner]: "owner",
      [admin]: "admin",
      [analyst]: "analyst",
    };
    for (const id of [owner, admin, analyst]) {
      memberships[id] = await repo.createMembership({ tenantId: FIXTURE.tenantId, userId: id }, id);
      await repo.replaceGrants(
        { tenantId: FIXTURE.tenantId, userId: id },
        memberships[id]!,
        [{ role: roles[id]!, sellerAccountId: null }],
        null,
      );
    }
  });

  it("access: resolves roles for own tenant, null for another tenant's seller account (404 upstream)", async () => {
    expect((await svc.access(analyst, FIXTURE.tenantId, FIXTURE.sellerAccountId))?.roles).toEqual([
      "analyst",
    ]);
    expect(await svc.access(analyst, FIXTURE.tenantId, FIXTURE.otherSellerAccountId)).toBeNull();
    expect(await svc.access(analyst, FIXTURE.otherTenantId, null)).toBeNull();
  });

  it("an admin cannot grant or change owner access; an owner can", async () => {
    const adminActor = { scope: { tenantId: FIXTURE.tenantId, userId: admin } };
    await expect(
      svc.setMemberRoles(adminActor, memberships[analyst]!, [
        { role: "owner", sellerAccountId: null },
      ]),
    ).rejects.toMatchObject({ code: "owner_required" });
    await expect(
      svc.setMemberRoles(adminActor, memberships[owner]!, [
        { role: "viewer", sellerAccountId: null },
      ]),
    ).rejects.toMatchObject({ code: "owner_required" });
    await svc.setMemberRoles({ scope: ownerScope }, memberships[analyst]!, [
      { role: "manager", sellerAccountId: null },
    ]);
    expect((await svc.access(analyst, FIXTURE.tenantId, null))?.roles).toEqual(["manager"]);
    expect(revoked).toContain(analyst); // sessions of the changed member are revoked
  });

  it("the last owner cannot be demoted or removed", async () => {
    await expect(
      svc.setMemberRoles({ scope: ownerScope }, memberships[owner]!, [
        { role: "admin", sellerAccountId: null },
      ]),
    ).rejects.toMatchObject({ code: "last_owner" });
    await expect(
      svc.removeMember({ scope: ownerScope }, memberships[owner]!),
    ).rejects.toMatchObject({ code: "last_owner" });
    expect((await svc.access(owner, FIXTURE.tenantId, null))?.roles).toEqual(["owner"]);
  });

  it("a member id from another tenant is 'not found' for both change and removal", async () => {
    const other = { scope: { tenantId: FIXTURE.otherTenantId, userId: owner } };
    await expect(svc.removeMember(other, memberships[analyst]!)).rejects.toMatchObject({
      kind: "not_found",
    });
    await expect(
      svc.setMemberRoles(other, memberships[analyst]!, [{ role: "viewer", sellerAccountId: null }]),
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("invitations: owner is not invitable, the link is single-use, and acceptance creates the membership", async () => {
    const actor = { scope: ownerScope, email: "o@example.test" };
    await expect(
      svc.createInvitation(actor, { email: "new@example.test", role: "owner" }),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      svc.createInvitation(actor, { email: "a@example.test", role: "viewer" }),
    ).rejects.toMatchObject({ code: "already_member" });
    const { token, link } = await svc.createInvitation(actor, {
      email: "new@example.test",
      role: "viewer",
      sellerAccountId: FIXTURE.sellerAccountId,
    });
    expect(link).toContain("https://app.example.test/accept-invitation#token=");
    expect(await svc.previewInvitation(token)).toMatchObject({
      email: "new@example.test",
      role: "viewer",
      accountExists: false,
    });

    const newUser = uuidv7();
    await sql`insert into identity.users (id, email) values (${newUser}, 'new@example.test')`.execute(
      t!.owner.db,
    );
    await expect(
      svc.acceptInvitation(token, { id: newUser, email: "other@example.test" }),
    ).rejects.toMatchObject({ code: "invitation_email_mismatch" });
    await svc.acceptInvitation(token, { id: newUser, email: "new@example.test" });
    expect((await svc.access(newUser, FIXTURE.tenantId, FIXTURE.sellerAccountId))?.roles).toEqual([
      "viewer",
    ]);
    await expect(
      svc.acceptInvitation(token, { id: newUser, email: "new@example.test" }),
    ).rejects.toMatchObject({ code: "invitation_invalid" });
  });

  it("an expired or revoked invitation cannot be accepted", async () => {
    const actor = { scope: ownerScope, email: "o@example.test" };
    const { token, invitation } = await svc.createInvitation(actor, {
      email: "later@example.test",
      role: "analyst",
    });
    await svc.revokeInvitation(actor, invitation.id);
    await expect(svc.previewInvitation(token)).rejects.toMatchObject({
      code: "invitation_invalid",
    });
    const second = await svc.createInvitation(actor, {
      email: "exp@example.test",
      role: "analyst",
    });
    await sql`update core.invitations set expires_at = now() - interval '1 minute' where id = ${second.invitation.id}`.execute(
      t!.owner.db,
    );
    await expect(svc.previewInvitation(second.token)).rejects.toMatchObject({
      code: "invitation_invalid",
    });
  });

  it("audit rows exist for membership changes and carry no token", async () => {
    const { rows } = await sql<{
      action: string;
      details: unknown;
    }>`select action, details from ops.audit_log order by occurred_at`.execute(t!.owner.db);
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "member.roles_changed",
        "member.invited",
        "member.joined",
        "member.invitation_revoked",
      ]),
    );
    expect(JSON.stringify(rows)).not.toMatch(/token/i);
  });

  it("preferences reject keys and values that are not allowed", async () => {
    await expect(svc.putPreference(ownerScope, "Bad Key!", { a: 1 })).rejects.toMatchObject({
      kind: "validation",
    });
    await expect(
      svc.putPreference(ownerScope, "ads.grid", "string" as never),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      svc.putPreference(ownerScope, "ads.grid", { big: "x".repeat(20_000) }),
    ).rejects.toMatchObject({ kind: "validation" });
    expect(await svc.putPreference(ownerScope, "ads.grid", { cols: ["a"] })).toMatchObject({
      value: { cols: ["a"] },
    });
    expect(await svc.getPreference(ownerScope, "ads.grid")).toMatchObject({
      value: { cols: ["a"] },
    });
  });

  it("reference data comes from ref.* (marketplaces and Ads limits as data)", async () => {
    const markets = await svc.listMarketplaces();
    expect(markets.find((m) => m.id === "ATVPDKIKX0DER")).toMatchObject({
      countryCode: "US",
      currency: "USD",
      timeZone: "America/Los_Angeles",
    });
    const limits = await svc.listAdsLimits("ATVPDKIKX0DER");
    expect(limits.find((l) => l.limitKind === "keyword_bid")).toMatchObject({
      minValue: "0.0200",
      maxValue: "1000.0000",
    });
  });
});
