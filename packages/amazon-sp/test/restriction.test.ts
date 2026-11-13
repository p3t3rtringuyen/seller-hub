import { PiiDisabled } from "@seller-hub/amazon-core";
import { createTestRuntime, jsonResponse } from "@seller-hub/amazon-core/testing";
import { describe, expect, it } from "vitest";
import { createSpClient, fetchDocument } from "../src";
import type { SpScope } from "../src";

// M1 (P5 review): the D11 guard must not be bypassable through report schedules or foreign document ids.
const scope: SpScope = { tenantId: "tenant-1", sellerAccountId: "sa-1", region: "na" };
const PII = "GET_FLAT_FILE_ACTIONABLE_ORDER_DATA_SHIPPING";

function setup() {
  const t = createTestRuntime();
  return { ...t, sp: createSpClient(t.runtime.client) };
}
const apiCalls = (t: ReturnType<typeof setup>) =>
  t.transport.requests.filter((r) => !r.url.includes("/auth/o2/"));

describe("report schedules", () => {
  it("createReportSchedule refuses a PII report type, like createReport", async () => {
    const t = setup();
    await expect(
      t.sp.reports.createReportSchedule(scope, {
        body: { reportType: PII, period: "P1D", marketplaceIds: ["ATVPDKIKX0DER"] },
      }),
    ).rejects.toBeInstanceOf(PiiDisabled);
    expect(apiCalls(t)).toHaveLength(0);
  });

  it("createReportSchedule works for a non-PII report type", async () => {
    const t = setup();
    t.transport.route(
      { method: "POST", path: "/reports/2021-06-30/schedules" },
      jsonResponse(201, { reportScheduleId: "S1" }),
    );
    const res = await t.sp.reports.createReportSchedule(scope, {
      body: {
        reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
        period: "P1D",
        marketplaceIds: ["ATVPDKIKX0DER"],
      },
    });
    expect(res.status).toBe(201);
  });
});

describe("getReportDocument", () => {
  const route = (t: ReturnType<typeof setup>) =>
    t.transport.route(
      { path: "/reports/2021-06-30/documents/D1" },
      jsonResponse(200, { reportDocumentId: "D1", url: "https://s3.test/d" }),
    );

  it("is refused when the report type is not stated (the id may come from a schedule or getReports)", async () => {
    const t = setup();
    route(t);
    await expect(
      t.sp.reports.getReportDocument(scope, { path: { reportDocumentId: "D1" } }),
    ).rejects.toBeInstanceOf(PiiDisabled);
    expect(apiCalls(t)).toHaveLength(0);
  });

  it("is refused for a PII report type, allowed for a non-PII one", async () => {
    const t = setup();
    route(t);
    await expect(
      t.sp.reports.getReportDocument(
        scope,
        { path: { reportDocumentId: "D1" } },
        { reportType: PII },
      ),
    ).rejects.toBeInstanceOf(PiiDisabled);
    expect(apiCalls(t)).toHaveLength(0);
    const ok = await t.sp.reports.getReportDocument(
      scope,
      { path: { reportDocumentId: "D1" } },
      { reportType: "GET_MERCHANT_LISTINGS_ALL_DATA" },
    );
    expect(ok.status).toBe(200);
  });

  it("fetchDocument needs the report type too", async () => {
    const t = setup();
    route(t);
    await expect(fetchDocument(t.sp, scope, "R1", "D1", PII)).rejects.toBeInstanceOf(PiiDisabled);
  });
});

describe("N4: includedData is compared case-insensitively", () => {
  it("'buyer' and ' Recipient ' are refused", async () => {
    const t = setup();
    for (const includedData of [["buyer"], [" Recipient "], "fulfillment,buyer"]) {
      await expect(
        t.sp.orders.searchOrders(scope, {
          query: { marketplaceIds: ["A"], includedData: includedData as never },
        }),
      ).rejects.toBeInstanceOf(PiiDisabled);
    }
    expect(apiCalls(t)).toHaveLength(0);
  });
});
