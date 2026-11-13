import { createTestRuntime, jsonResponse } from "@seller-hub/amazon-core/testing";
import { describe, expect, it } from "vitest";
import { createAdsClient, createPortfoliosPort, type AdsScope } from "../src";

// M4 + M3 (P5 review): EX-PORTFOLIOS writes use the 207 mapping, and an unmentioned write item is "outcome unknown".
const scope: AdsScope = {
  tenantId: "tenant-1",
  sellerAccountId: "sa-1",
  region: "na",
  profileId: "123",
};

function setup() {
  const t = createTestRuntime();
  return { ...t, ads: createAdsClient(t.runtime.client) };
}
const sentBody = (t: ReturnType<typeof setup>, i: number) =>
  JSON.parse(t.transport.callsTo({ method: "POST", path: "/portfolios" })[i]?.bodyText ?? "{}") as {
    portfolios: unknown[];
  };

describe("EX-PORTFOLIOS writes", () => {
  it("create chunks by the catalogue batchMax (100), sends Prefer: return=representation, maps 207 per item", async () => {
    const t = setup();
    t.transport.route({ method: "POST", path: "/portfolios" }, (req) => {
      const sent = JSON.parse(new TextDecoder().decode(req.body as Uint8Array)) as {
        portfolios: { name: string }[];
      };
      return jsonResponse(207, {
        portfolios: {
          success: sent.portfolios.flatMap((p, index) =>
            p.name === "bad"
              ? []
              : [
                  {
                    index,
                    portfolioId: `P${index}`,
                    portfolio: { portfolioId: `P${index}`, name: p.name },
                  },
                ],
          ),
          error: sent.portfolios.flatMap((p, index) =>
            p.name === "bad"
              ? [
                  {
                    index,
                    errors: [
                      {
                        errorType: "DUPLICATE_VALUE",
                        errorValue: { duplicateValueError: { message: "name taken" } },
                      },
                    ],
                  },
                ]
              : [],
          ),
        },
      });
    });
    const items = Array.from({ length: 150 }, (_, i) => ({
      name: i === 120 ? "bad" : `p${i}`,
      state: "ENABLED" as const,
    }));
    const r = await createPortfoliosPort(t.ads).create(scope, items as never);

    expect(t.transport.callsTo({ method: "POST", path: "/portfolios" })).toHaveLength(2);
    expect(sentBody(t, 0).portfolios).toHaveLength(100);
    expect(sentBody(t, 1).portfolios).toHaveLength(50);
    expect(t.transport.callsTo({ method: "POST", path: "/portfolios" })[0]?.headers.prefer).toBe(
      "return=representation",
    );

    expect(r.items).toHaveLength(150);
    expect(r).toMatchObject({ succeeded: 149, failed: 1, partial: true });
    expect(r.items[120]).toMatchObject({
      ok: false,
      errors: [{ code: "DUPLICATE_VALUE", message: "name taken" }],
      retryable: false,
    });
    expect(r.items[0]).toMatchObject({ ok: true, entity: { portfolioId: "P0" } });
  });

  it("update goes through the same mapping", async () => {
    const t = setup();
    t.transport.route(
      { method: "PUT", path: "/portfolios" },
      jsonResponse(207, {
        portfolios: { success: [], error: [{ index: 0, errors: [{ errorType: "NOT_FOUND" }] }] },
      }),
    );
    const r = await createPortfoliosPort(t.ads).update(scope, [
      { portfolioId: "P1", name: "x" },
    ] as never);
    expect(r.items[0]).toMatchObject({ ok: false, errors: [{ code: "NOT_FOUND" }] });
  });

  it("a created item Amazon does not mention is outcome_unknown and NOT retryable (no duplicate portfolios)", async () => {
    const t = setup();
    t.transport.route(
      { method: "POST", path: "/portfolios" },
      jsonResponse(207, { portfolios: { success: [], error: [] } }),
    );
    const r = await createPortfoliosPort(t.ads).create(scope, [
      { name: "a", state: "ENABLED" },
    ] as never);
    expect(r.items[0]).toMatchObject({
      ok: false,
      errors: [{ code: "outcome_unknown" }],
      retryable: false,
    });
  });

  it("a truncated 207 body on a v1 write is also outcome_unknown (SPCreateCampaign)", async () => {
    const t = setup();
    t.transport.route({ path: "/adsApi/v1/create/campaigns" }, jsonResponse(207, {}));
    const r = await t.ads.batch("SPCreateCampaign", scope, [{ name: "c" }]);
    expect(r.items[0]).toMatchObject({ retryable: false, errors: [{ code: "outcome_unknown" }] });
  });

  it("but a missing item of a read-style batch stays retryable", async () => {
    const t = setup();
    t.transport.route(
      { path: "/portfolios/budget/usage" },
      jsonResponse(207, { success: [], error: [] }),
    );
    const r = await t.ads.batch("portfolioBudgetUsage", scope, ["P1"]);
    expect(r.items[0]).toMatchObject({ retryable: true, errors: [{ code: "missing_result" }] });
  });
});
