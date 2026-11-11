import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "@seller-hub/config";
import { listMigrationFiles, withScope } from "@seller-hub/db";
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURE, seedFixtures, tryCreateTestDb } from "../src";

const root = findRepoRoot();
const norm = (s: string) => s.replace(/\r\n/g, "\n");

describe("platform migrations are the db/design DDL", () => {
  it("has one migration per design file, in order, with identical SQL", () => {
    const designDir = join(root, "db", "design");
    const design = readdirSync(designDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(design).toHaveLength(14);
    const platform = listMigrationFiles(root).filter((m) => m.name.includes("_platform_"));
    expect(platform.map((m) => m.name.replace(/^\d+_platform_/, "") + ".sql")).toEqual(design);
    design.forEach((file, i) => {
      const body = norm(readFileSync(join(designDir, file), "utf8"));
      const migration = norm(readFileSync(platform[i]!.path, "utf8"));
      expect(migration.endsWith(body)).toBe(true);
    });
  });

  it("orders migrations by timestamp across directories", () => {
    const ts = listMigrationFiles(root).map((m) => m.timestamp);
    expect([...ts].sort()).toEqual(ts);
  });
});

const t = await tryCreateTestDb();

describe.skipIf(!t)("database after migrations (Postgres 16)", () => {
  afterAll(async () => {
    await t?.drop();
  });

  it("creates the 57 designed tables plus module tables, and the monthly partitions", async () => {
    const r = await sql<{ n: string }>`
      select count(*)::text as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('identity','core','ref','ingest','ads','catalog','inventory','orders','finance','facts','ops','pii')
         and c.relkind in ('r','p') and not c.relispartition`.execute(t!.owner.db);
    expect(Number(r.rows[0]!.n)).toBeGreaterThanOrEqual(57);
    const parts = await sql<{
      n: string;
    }>`select count(*)::text as n from pg_class where relispartition`.execute(t!.owner.db);
    expect(Number(parts.rows[0]!.n)).toBeGreaterThan(50);
  });

  it("seeds ref data from the migrations", async () => {
    const r = await sql<{ n: string }>`select count(*)::text as n from ref.marketplaces`.execute(
      t!.owner.db,
    );
    expect(Number(r.rows[0]!.n)).toBeGreaterThan(10);
  });

  it("runs the app as sh_app without BYPASSRLS", async () => {
    const r = await sql<{ current_user: string; bypass: boolean }>`
      select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`.execute(
      t!.app.db,
    );
    expect(r.rows[0]).toEqual({ current_user: "sh_app", bypass: false });
  });

  it("withScope sets the tenant for RLS and fail-closes without one", async () => {
    await seedFixtures(t!);
    const seen = await withScope(t!.app.db, { tenantId: FIXTURE.tenantId }, async (trx) =>
      (await sql<{ id: string }>`select id from core.tenants`.execute(trx)).rows.map((x) => x.id),
    );
    expect(seen).toEqual([FIXTURE.tenantId]);
    const unscoped = await sql`select id from core.tenants`.execute(t!.app.db);
    expect(unscoped.rows).toHaveLength(0);
    await expect(withScope(t!.app.db, undefined as never, async () => 1)).rejects.toThrow(/Scope/);
  });

  it("re-running the migrations applies nothing (idempotent)", async () => {
    const { runMigrations } = await import("@seller-hub/db");
    expect(await runMigrations(t!.ownerUrl)).toEqual([]);
  });
});
