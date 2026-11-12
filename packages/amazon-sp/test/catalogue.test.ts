import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SP_OPERATIONS } from "../src";

// The generated operation table must agree with the committed catalogue it was generated from, and the
// documented limits the plan relies on must be in it.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const catalog = Object.values(
  JSON.parse(readFileSync(join(root, "catalog/spapi/operations.json"), "utf8")) as Record<
    string,
    Record<string, unknown>
  >,
);

describe("SP operation table", () => {
  const entries = Object.values(SP_OPERATIONS) as unknown as {
    id: string;
    family: string;
    method: string;
    path: string;
    rateLimit?: { rate: number; burst: number };
    restricted?: boolean;
    regions?: string[];
  }[];

  it("is non-trivial and every entry matches the catalogue (path, method, rate, restricted flag)", () => {
    expect(entries.length).toBeGreaterThanOrEqual(40);
    for (const e of entries) {
      const [api, version] = e.family.split("@");
      const operationId = e.id.slice(`${api}.`.length);
      const cat = catalog.find(
        (c) => c.api === api && c.version === version && c.operationId === operationId,
      );
      expect(cat, e.id).toBeDefined();
      expect(cat?.path, e.id).toBe(e.path);
      expect(cat?.method, e.id).toBe(e.method);
      expect(cat?.rateLimit ?? undefined, e.id).toEqual(e.rateLimit);
      expect(cat?.restricted === true, e.id).toBe(e.restricted === true);
    }
  });

  it("carries the limits the design quotes (ADR-0006, overview §5)", () => {
    expect(SP_OPERATIONS["orders.searchOrders"].rateLimit).toEqual({ rate: 0.0056, burst: 20 });
    expect(SP_OPERATIONS["reports.createReport"].rateLimit).toEqual({ rate: 0.0167, burst: 15 });
    expect(SP_OPERATIONS["sales.getOrderMetrics"].rateLimit).toMatchObject({ rate: 0.5 });
    expect(SP_OPERATIONS["fbaInventory.getInventorySummaries"].rateLimit).toMatchObject({
      rate: 2,
    });
    expect(SP_OPERATIONS["finances.listTransactions"].rateLimit).toMatchObject({ rate: 0.5 });
  });

  it("flags the PII operations as restricted and normalises region strings", () => {
    expect(SP_OPERATIONS["orders.getOrder"].restricted).toBe(true);
    expect(SP_OPERATIONS["reports.getReportDocument"].restricted).toBe(true);
    for (const e of entries)
      for (const r of e.regions ?? []) expect(["na", "eu", "fe"]).toContain(r);
  });

  it("covers the always-needed families: sellers, reports, feeds, notifications, tokens", () => {
    const families = new Set(entries.map((e) => e.id.split(".")[0]));
    for (const f of ["sellers", "reports", "feeds", "notifications", "tokens"])
      expect(families.has(f)).toBe(true);
  });
});
