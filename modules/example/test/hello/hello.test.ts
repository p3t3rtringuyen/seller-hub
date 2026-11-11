import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { withScope } from "@seller-hub/db";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { helloRepository } from "../../src/repository/hello/hello-repository";
import { helloService, type HelloRepository } from "../../src/service/hello/hello-service";

// --- service: pure business rules, fake repository --------------------------------------------------------
const fakeRepo = (): HelloRepository =>
  ({
    count: async () => 0,
    list: async () => [],
    create: async (_s: unknown, g: string) => ({ id: "x", greeting: g }),
  }) as unknown as HelloRepository;

describe("helloService (rules)", () => {
  const scope = { tenantId: "t", sellerAccountId: "s" };
  it("trims and accepts a greeting", async () => {
    await expect(helloService(fakeRepo()).create(scope, "  hi ")).resolves.toMatchObject({
      greeting: "hi",
    });
  });
  it("rejects an empty greeting with a 422-kind error carrying a field path", async () => {
    await expect(helloService(fakeRepo()).create(scope, "   ")).rejects.toMatchObject({
      kind: "validation",
      errors: [{ path: "/greeting", code: "required" }],
    });
  });
  it("rejects a reserved greeting as a conflict", async () => {
    await expect(helloService(fakeRepo()).create(scope, "Forbidden")).rejects.toMatchObject({
      kind: "conflict",
    });
  });
});

// --- repository: real Postgres 16, RLS on, connection = sh_app (NOBYPASSRLS) ---------------------------------
const t = await tryCreateTestDb();
const A = { tenantId: FIXTURE.tenantId, sellerAccountId: FIXTURE.sellerAccountId };
const B = { tenantId: FIXTURE.otherTenantId, sellerAccountId: FIXTURE.otherSellerAccountId };

describe.skipIf(!t)("helloRepository — tenant isolation (C3)", () => {
  let repo: ReturnType<typeof helloRepository>;
  beforeAll(async () => {
    await seedFixtures(t!);
    repo = helloRepository(t!.app.db);
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("each tenant sees only its own rows", async () => {
    expect((await repo.list(A)).map((r) => r.greeting)).toEqual(["hello from tenant A"]);
    expect((await repo.list(B)).map((r) => r.greeting)).toEqual(["hello from tenant B"]);
  });

  it("RLS alone hides tenant A from tenant B even for an unfiltered query", async () => {
    const rows = await withScope(
      t!.app.db,
      B,
      async (trx) =>
        (await sql<{ greeting: string }>`select greeting from ops.example_hello`.execute(trx)).rows,
    );
    expect(rows.map((r) => r.greeting)).toEqual(["hello from tenant B"]);
  });

  it("returns nothing, not an error, when the scope has no rows; and an unscoped connection sees nothing", async () => {
    const none = await sql`select * from ops.example_hello`.execute(t!.app.db); // no app.tenant_id set => fail closed
    expect(none.rows).toHaveLength(0);
  });

  it("tenant B cannot write a row for tenant A (WITH CHECK)", async () => {
    await expect(
      withScope(t!.app.db, B, (trx) =>
        sql`insert into ops.example_hello (id, tenant_id, seller_account_id, greeting)
            values ('01900000-0000-7000-8000-0000000000c1', ${A.tenantId}, ${A.sellerAccountId}, 'sneaky')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/row-level security|foreign key/);
  });

  it("a call without a Scope fails at runtime", async () => {
    await expect(repo.list(undefined as never)).rejects.toThrow(/Scope/);
    await expect(repo.list({ tenantId: "x" } as never)).rejects.toThrow(/sellerAccountId/);
  });

  it("create is scoped: the new row is visible to its tenant only", async () => {
    await repo.create(A, "second");
    expect(await repo.count(A)).toBe(2);
    expect(await repo.count(B)).toBe(1);
  });
});
