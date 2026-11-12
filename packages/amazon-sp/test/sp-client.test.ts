import { AmazonThrottledError, PiiDisabled } from "@seller-hub/amazon-core";
import {
  FAKE_REF,
  createReplayTransport,
  createTestRuntime,
  jsonResponse,
} from "@seller-hub/amazon-core/testing";
import { describe, expect, it } from "vitest";
import { ReportFailedError, createSpClient, runReport, withRestrictedDataToken } from "../src";
import type { SpScope } from "../src";
import { spFixtures } from "../src/testing";

const scope: SpScope = { tenantId: "tenant-1", sellerAccountId: "sa-1", region: "na" };

function replay() {
  const transport = createReplayTransport({ fixtures: spFixtures() });
  const t = createTestRuntime({ transport, mode: "replay" });
  return { ...t, sp: createSpClient(t.runtime.client) };
}
function mocked() {
  const t = createTestRuntime();
  return { ...t, sp: createSpClient(t.runtime.client) };
}

describe("SP client (typed per operation)", () => {
  it("calls an operation by family.method and returns the typed body (replay fixtures)", async () => {
    const { sp, events } = replay();
    const res = await sp.sellers.getMarketplaceParticipations(scope);
    const first = res.body?.payload?.[0];
    expect(first?.marketplace.id).toBe("ATVPDKIKX0DER");
    expect(first?.participation.isParticipating).toBe(true);
    expect(res.requestId).toBe("fixture-req-1");
    expect(events[0]).toMatchObject({
      operation: "sellers.getMarketplaceParticipations",
      outcome: "ok",
      region: "na",
    });
  });

  it("generic call(id) and family methods are the same path", async () => {
    const { sp } = replay();
    const a = await sp.call("sellers.getMarketplaceParticipations", scope);
    const b = await sp.sellers.getMarketplaceParticipations(scope);
    expect(a.body).toEqual(b.body);
  });

  it("routes to the seller account's region and to the sandbox host in sandbox mode", async () => {
    const eu = mocked();
    eu.transport.route(
      { path: "/sellers/v1/marketplaceParticipations" },
      jsonResponse(200, { payload: [] }),
    );
    await eu.sp.sellers.getMarketplaceParticipations({ ...scope, region: "eu" });
    expect(
      new URL(eu.transport.callsTo({ path: /marketplaceParticipations/ })[0]?.url ?? "").host,
    ).toBe("sellingpartnerapi-eu.amazon.com");
    const sb = createTestRuntime({ mode: "sandbox" });
    sb.transport.route(
      { path: "/sellers/v1/marketplaceParticipations" },
      jsonResponse(200, { payload: [] }),
    );
    await createSpClient(sb.runtime.client).sellers.getMarketplaceParticipations({
      ...scope,
      region: "fe",
    });
    expect(
      new URL(sb.transport.callsTo({ path: /marketplaceParticipations/ })[0]?.url ?? "").host,
    ).toBe("sandbox.sellingpartnerapi-fe.amazon.com");
  });

  it("serves a vendor-audience operation the same way (no seller-only assumption, D5)", async () => {
    const { sp, transport } = mocked();
    transport.route({ path: "/sellers/v1/account" }, jsonResponse(200, { payload: {} }));
    await sp.sellers.getAccount({ ...scope, sellerAccountId: "vendor-account-1" });
    expect(transport.callsTo({ path: "/sellers/v1/account" })).toHaveLength(1);
  });

  it("429 → backoff → success on a real catalogue operation, honouring its rate limit", async () => {
    const { sp, transport, clock, events } = mocked();
    transport.route(
      { path: "/reports/2021-06-30/reports/R1" },
      jsonResponse(
        429,
        { errors: [{ code: "QuotaExceeded", message: "Too many requests" }] },
        { "retry-after": "3" },
      ),
      jsonResponse(200, { reportId: "R1", processingStatus: "IN_QUEUE" }),
    );
    const res = await sp.reports.getReport(scope, { path: { reportId: "R1" } });
    expect(res.body?.processingStatus).toBe("IN_QUEUE");
    expect(clock.sleeps).toContain(3000);
    expect(events[0]).toMatchObject({ throttled: true, retries: 1 });
  });

  it("surfaces a throttle that never clears as a retryable AmazonThrottledError", async () => {
    const { sp, transport } = mocked();
    transport.route(
      { path: "/reports/2021-06-30/reports/R1" },
      jsonResponse(429, {}, { "retry-after": "1" }),
    );
    await expect(sp.reports.getReport(scope, { path: { reportId: "R1" } })).rejects.toBeInstanceOf(
      AmazonThrottledError,
    );
  });

  it("rejects unknown operations at runtime (and at compile time)", async () => {
    const { sp } = mocked();
    // @ts-expect-error not a generated operation
    await expect(sp.call("sellers.noSuchThing", scope)).rejects.toThrow(/unknown SP-API operation/);
    expect((sp as unknown as Record<string, unknown>).notAFamily).toBeUndefined();
  });
});

describe("restricted data guard (D11)", () => {
  it("the RDT flow is a stub that always throws PiiDisabled", async () => {
    expect(() => withRestrictedDataToken(["buyerInfo"])).toThrow(PiiDisabled);
    const { sp, transport } = mocked();
    expect(() => sp.withRestrictedDataToken(["buyerInfo"])).toThrow(PiiDisabled);
    await expect(
      sp.tokens.createRestrictedDataToken(scope, {
        body: { restrictedResources: [{ method: "GET", path: "/orders/v0/orders" }] },
      }),
    ).rejects.toBeInstanceOf(PiiDisabled);
    expect(transport.requests.filter((r) => !r.url.includes("/auth/o2/"))).toHaveLength(0);
  });

  it("orders.getOrder is catalogue-restricted: allowed without BUYER/RECIPIENT, refused with them", async () => {
    const { sp, transport } = mocked();
    transport.route(
      { path: "/orders/2026-01-01/orders/111-1" },
      jsonResponse(200, { order: { orderId: "111-1" } }),
    );
    const ok = await sp.orders.getOrder(scope, {
      path: { orderId: "111-1" },
      query: { includedData: ["FULFILLMENT"] },
    });
    expect(ok.status).toBe(200);
    await expect(
      sp.orders.getOrder(scope, { path: { orderId: "111-1" }, query: { includedData: ["BUYER"] } }),
    ).rejects.toBeInstanceOf(PiiDisabled);
    await expect(
      sp.orders.getOrder(scope, {
        path: { orderId: "111-1" },
        query: { includedData: ["FULFILLMENT", "RECIPIENT"] },
      }),
    ).rejects.toBeInstanceOf(PiiDisabled);
    expect(transport.callsTo({ path: /orders\/111-1/ })).toHaveLength(1);
  });

  it("orders.searchOrders refuses buyer data even though the catalogue does not flag it restricted", async () => {
    const { sp, transport } = mocked();
    transport.route({ path: "/orders/2026-01-01/orders" }, jsonResponse(200, { orders: [] }));
    await sp.orders.searchOrders(scope, {
      query: { marketplaceIds: ["ATVPDKIKX0DER"], createdAfter: "2026-11-01T00:00:00Z" },
    });
    await expect(
      sp.orders.searchOrders(scope, {
        query: { marketplaceIds: ["ATVPDKIKX0DER"], includedData: ["BUYER"] },
      }),
    ).rejects.toBeInstanceOf(PiiDisabled);
  });

  it("refuses to create a report type that returns buyer data", async () => {
    const { sp } = mocked();
    for (const reportType of [
      "GET_FLAT_FILE_ORDER_REPORT_DATA_SHIPPING",
      "GET_EASYSHIP_DOCUMENTS",
      "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_INVOICING",
    ]) {
      await expect(
        sp.reports.createReport(scope, { body: { reportType, marketplaceIds: ["ATVPDKIKX0DER"] } }),
      ).rejects.toBeInstanceOf(PiiDisabled);
    }
  });

  it("getReportDocument (catalogue-restricted) works for documents of non-PII reports", async () => {
    const { sp, transport } = mocked();
    transport.route(
      { path: "/reports/2021-06-30/documents/D1" },
      jsonResponse(200, { reportDocumentId: "D1", url: "https://s3.test/d" }),
    );
    expect(
      (await sp.reports.getReportDocument(scope, { path: { reportDocumentId: "D1" } })).status,
    ).toBe(200);
  });
});

describe("report flow: create → poll → document → download → gunzip", () => {
  it("runs end to end on the replay fixtures", async () => {
    const { sp, clock, transport } = replay();
    const out = await runReport(
      sp,
      scope,
      { reportType: "GET_MERCHANT_LISTINGS_ALL_DATA", marketplaceIds: ["ATVPDKIKX0DER"] },
      { pollIntervalMs: 15_000 },
    );
    expect(out.reportId).toBe("ID-1001");
    expect(out.text()).toBe(
      "sku\tasin\tprice\nSKU-1\tB000000001\t19.99\nSKU-2\tB000000002\t24.50\n",
    );
    expect(clock.sleeps).toContain(15_000); // one IN_PROGRESS poll
    const download = transport.callsTo({ path: "/fixture/DOC-1" })[0];
    expect(download?.headers["x-amz-access-token"]).toBeUndefined(); // pre-signed URL: no auth
  });

  it("fails clearly when Amazon cancels the report, and times out instead of polling forever", async () => {
    const a = mocked();
    a.transport.route(
      { method: "POST", path: "/reports/2021-06-30/reports" },
      jsonResponse(202, { reportId: "R9" }),
    );
    a.transport.route(
      { path: "/reports/2021-06-30/reports/R9" },
      jsonResponse(200, { reportId: "R9", processingStatus: "CANCELLED" }),
    );
    await expect(
      runReport(a.sp, scope, {
        reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
        marketplaceIds: ["A"],
      }),
    ).rejects.toBeInstanceOf(ReportFailedError);

    const b = mocked();
    b.transport.route(
      { method: "POST", path: "/reports/2021-06-30/reports" },
      jsonResponse(202, { reportId: "R8" }),
    );
    b.transport.route(
      { path: "/reports/2021-06-30/reports/R8" },
      jsonResponse(200, { reportId: "R8", processingStatus: "IN_PROGRESS" }),
    );
    await expect(
      runReport(
        b.sp,
        scope,
        { reportType: "GET_MERCHANT_LISTINGS_ALL_DATA", marketplaceIds: ["A"] },
        { pollIntervalMs: 60_000, timeoutMs: 120_000 },
      ),
    ).rejects.toThrow(/not ready in time/);
  });
});

void FAKE_REF;
