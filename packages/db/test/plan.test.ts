import { describe, expect, it } from "vitest";
import { planMigrations, type MigrationFile } from "../src/migrate";

const f = (timestamp: string, name = `${timestamp}_x_y_z`): MigrationFile => ({
  name,
  timestamp,
  path: `/${name}.sql`,
});

describe("planMigrations (B4: late arrivals are applied, in order)", () => {
  const a = f("20261110100000");
  const b = f("20261110090000"); // created earlier, merged later
  const c = f("20261110110000");

  it("plans pending migrations in timestamp order and flags the older-than-applied ones", () => {
    const files = [b, a, c].sort((x, y) => x.timestamp.localeCompare(y.timestamp));
    const plan = planMigrations(files, new Set([a.name]));
    expect(plan.pending.map((m) => m.timestamp)).toEqual(["20261110090000", "20261110110000"]);
    expect([...plan.lateArrivals]).toEqual([b.name]);
  });
  it("flags nothing on a fresh database or when nothing is older", () => {
    expect(planMigrations([b, a, c], new Set()).lateArrivals.size).toBe(0);
    expect(planMigrations([b, a, c], new Set([b.name])).lateArrivals.size).toBe(0);
  });
});
