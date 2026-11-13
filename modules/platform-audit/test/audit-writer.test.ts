import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { withScope } from "@seller-hub/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditWriter, sanitizeDetails } from "../src/writer/audit-writer";

describe("sanitizeDetails", () => {
  it("redacts secret-looking keys at any depth and truncates long strings", () => {
    const out = sanitizeDetails({
      role: "admin",
      refreshToken: "Atzr|abc",
      nested: { password: "x", ok: 1, list: [{ clientSecret: "s" }] },
      long: "x".repeat(600),
    }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(out.role).toBe("admin");
    expect(out.refreshToken).toBe("[redacted]");
    expect(out.nested.password).toBe("[redacted]");
    expect(out.nested.list[0].clientSecret).toBe("[redacted]");
    expect(out.long.length).toBeLessThan(510);
    expect(JSON.stringify(out)).not.toContain("Atzr|");
  });
});

const t = await tryCreateTestDb();
const A = { tenantId: FIXTURE.tenantId };
const B = { tenantId: FIXTURE.otherTenantId };

describe.skipIf(!t)("AuditWriter - tenant isolation and append-only (real Postgres)", () => {
  beforeAll(async () => {
    await seedFixtures(t!);
    const w = createAuditWriter(t!.app.db);
    await w.write(A, { action: "auth.login", actorLabel: "a@example.test", details: { token: "x" } });
    await w.write(B, { action: "auth.login", actorLabel: "b@example.test", ipAddress: "not-an-ip" });
  });
  afterAll(async () => {
    await t?.drop();
  });

  const rows = (scope: { tenantId: string }) =>
    withScope(t!.app.db, scope, async (trx) =>
      (await sql<{ actor_label: string; details: unknown; ip_address: string | null }>`
        select actor_label, details, ip_address from ops.audit_log`.execute(trx)).rows,
    );

  it("each tenant sees only its own audit rows (RLS, unfiltered query)", async () => {
    expect((await rows(A)).map((r) => r.actor_label)).toEqual(["a@example.test"]);
    expect((await rows(B)).map((r) => r.actor_label)).toEqual(["b@example.test"]);
  });
  it("stores redacted details and drops an invalid IP", async () => {
    expect((await rows(A))[0]!.details).toEqual({ token: "[redacted]" });
    expect((await rows(B))[0]!.ip_address).toBeNull();
  });
  it("sh_app cannot update or delete audit rows", async () => {
    await expect(
      withScope(t!.app.db, A, (trx) => sql`update ops.audit_log set action = 'x'`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withScope(t!.app.db, A, (trx) => sql`delete from ops.audit_log`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });
});
