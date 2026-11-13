import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADS_OPERATIONS,
  ADS_V0_EXCEPTIONS,
  BUDGET_RULE_READ_OPERATIONS,
  V0_EXCEPTIONS,
} from "../src";

// D53: v1 is the default; every v0 operation is a named exception. D57 a: no Reporting v3.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = <T>(f: string): T => JSON.parse(readFileSync(join(root, f), "utf8")) as T;
const domain = read<{
  operations: { api: string; operationId: string; exception: string | null; treatment: string }[];
  exceptions: Record<string, unknown>;
}>("catalog/ads/domain-map.json");

type Op = {
  id: string;
  family: string;
  generation: "v0" | "v1";
  exception?: string;
  method: string;
  path: string;
};
const ops = Object.values(ADS_OPERATIONS) as unknown as Op[];

describe("D53 exception table", () => {
  it("every generated v0 operation names an exception, and the catalogue agrees", () => {
    const v0 = ops.filter((o) => o.generation === "v0");
    expect(v0.length).toBeGreaterThan(0);
    for (const o of v0) {
      expect(o.exception, o.id).toBeTruthy();
      expect(ADS_V0_EXCEPTIONS[o.id], o.id).toBe(o.exception);
      const cat = domain.operations.find((d) => d.api === o.family && d.operationId === o.id);
      expect(cat?.treatment, o.id).toBe("v0-exception");
      expect(cat?.exception, o.id).toBe(o.exception);
    }
  });

  it("every exception used by an operation has an adapter in the table and exists in the catalogue", () => {
    const used = new Set(ops.filter((o) => o.generation === "v0").map((o) => o.exception));
    const table = new Set(V0_EXCEPTIONS.map((e) => e.id));
    for (const id of used) {
      expect(table.has(id as string), `${id} has no adapter`).toBe(true);
      expect(domain.exceptions[id as string], id as string).toBeDefined();
    }
    for (const e of V0_EXCEPTIONS) {
      expect(used.has(e.id), `${e.id} has an adapter but no operation`).toBe(true);
      expect(e.watch.length).toBeGreaterThan(0);
    }
  });

  it("covers exactly the MVP exceptions the plan lists", () => {
    expect(V0_EXCEPTIONS.map((e) => e.id).sort()).toEqual(
      [
        "EX-BUDGET-RULES",
        "EX-CHANGE-HISTORY",
        "EX-EXPORTS",
        "EX-PORTFOLIOS",
        "EX-PROFILES",
        "EX-TARGETING-DISCOVERY",
        "EX-TARGETING-RECS",
      ].sort(),
    );
  });

  it("v1 is the default for everything v1 has: campaigns, ad groups, ads, targets, reports", () => {
    for (const id of [
      "SPQueryCampaign",
      "SPCreateAdGroup",
      "SPUpdateAd",
      "SPDeleteTarget",
      "AdsApiv1CreateReport",
    ]) {
      expect((ADS_OPERATIONS as unknown as Record<string, Op>)[id]?.generation, id).toBe("v1");
    }
  });
});

describe("D57 a: no Reporting v3", () => {
  it("no generated operation is a v3 reporting, Sponsored Ads v2 reporting or Stream v1 endpoint", () => {
    for (const o of ops) {
      expect(o.path, o.id).not.toMatch(/^\/(v2\/)?(sp|sb|sd|hsa)\/.*reports?(\/|$)/i);
      expect(o.path, o.id).not.toMatch(/^\/reporting\//);
      expect(o.path, o.id).not.toMatch(
        /^\/(sp|sb|sd)\/(campaigns|adGroups|keywords|targets|productAds)\/report/,
      );
      expect(o.family, o.id).not.toMatch(/OfflineReport|Reporting|Stream/i);
    }
  });

  it("the only report operations are the v1 ones", () => {
    const reportOps = ops
      .filter((o) => /report/i.test(o.id) && !/budget/i.test(o.id))
      .map((o) => o.id)
      .sort();
    expect(reportOps).toEqual([
      "AdsApiv1CreateReport",
      "AdsApiv1DeleteReport",
      "AdsApiv1RetrieveReport",
    ]);
  });
});

describe("EX-BUDGET-RULES is read only", () => {
  it("only GET operations are generated for budget rules", () => {
    const rules = ops.filter((o) => o.exception === "EX-BUDGET-RULES");
    expect(rules.length).toBe(12);
    for (const o of rules) expect(o.method, o.id).toBe("GET");
    const named = Object.values(BUDGET_RULE_READ_OPERATIONS)
      .flatMap((p) => Object.values(p))
      .sort();
    expect(named).toEqual(rules.map((o) => o.id).sort());
  });
});

describe("catalogue agreement", () => {
  it("batch maxima and 207 flags are copied from catalog/ads/operations.json", () => {
    const cat = read<{
      operations: {
        operationId: string;
        api: string;
        batchMax: number | null;
        multiStatus207: boolean;
        batchField: string | null;
      }[];
    }>("catalog/ads/operations.json").operations;
    for (const o of ops as (Op & {
      batchMax?: number;
      multiStatus207?: boolean;
      batchField?: string;
    })[]) {
      const c = cat.find((x) => x.operationId === o.id && x.api === o.family);
      expect(c, o.id).toBeDefined();
      expect(o.batchMax ?? null, o.id).toBe(c?.batchMax ?? null);
      expect(o.multiStatus207 === true, o.id).toBe(c?.multiStatus207 === true);
      expect(o.batchField ?? null, o.id).toBe(c?.batchField ?? null);
    }
    expect(
      (ADS_OPERATIONS as unknown as Record<string, { batchMax: number }>).SPCreateCampaign
        ?.batchMax,
    ).toBe(1000);
  });
});
