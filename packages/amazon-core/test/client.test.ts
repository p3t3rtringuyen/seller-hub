import { Writable } from "node:stream";
import { createLogger } from "@seller-hub/core";
import { describe, expect, it } from "vitest";
import {
  AmazonApiError,
  AmazonAuthError,
  AmazonNotFoundError,
  AmazonThrottledError,
  AmazonUpstreamError,
  AmazonValidationError,
  LocalRateLimitError,
  OperationUsageError,
  PiiDisabled,
  createAmazonRuntime,
  type OperationMeta,
} from "../src";
import {
  FAKE_LWA,
  FAKE_REF,
  bytesResponse,
  createTestRuntime,
  emptyResponse,
  fakeCredentialSource,
  jsonResponse,
  ManualClock,
  MockTransport,
  mockLwa,
} from "../src/testing";

const getParticipations: OperationMeta = {
  id: "sellers.getMarketplaceParticipations",
  api: "sp",
  family: "sellers@v1",
  method: "GET",
  path: "/sellers/v1/marketplaceParticipations",
  rateLimit: { rate: 0.016, burst: 15 },
  restricted: false,
  regions: ["eu", "fe", "na"],
  idempotent: true,
};
const createReport: OperationMeta = {
  id: "reports.createReport",
  api: "sp",
  family: "reports@2021-06-30",
  method: "POST",
  path: "/reports/2021-06-30/reports",
  rateLimit: { rate: 0.0167, burst: 15 },
  restricted: false,
};
const getReport: OperationMeta = {
  id: "reports.getReport",
  api: "sp",
  family: "reports@2021-06-30",
  method: "GET",
  path: "/reports/2021-06-30/reports/{reportId}",
  rateLimit: { rate: 2, burst: 15 },
  idempotent: true,
};
const restrictedOp: OperationMeta = {
  id: "orders.getOrder",
  api: "sp",
  family: "orders@2026-01-01",
  method: "GET",
  path: "/orders/2026-01-01/orders/{orderId}",
  restricted: true,
  restrictedReason: "amazon-rdt-list",
};
const adsV1Query: OperationMeta = {
  id: "SPQueryCampaign",
  api: "ads",
  family: "AmazonAdsAPISPCampaignsContract",
  method: "POST",
  path: "/adsApi/v1/query/campaigns",
  generation: "v1",
  idempotent: true,
  accept: ["application/json"],
  contentType: ["application/json"],
};
const adsV0List: OperationMeta = {
  id: "listProfiles",
  api: "ads",
  family: "profiles-3-0",
  method: "GET",
  path: "/v2/profiles",
  generation: "v0",
  exception: "EX-PROFILES",
  idempotent: true,
};
const adsV1Update: OperationMeta = {
  id: "SPUpdateTarget",
  api: "ads",
  family: "AmazonAdsAPISPTargetsContract",
  method: "POST",
  path: "/adsApi/v1/update/targets",
  generation: "v1",
  multiStatus207: true,
};

const SP_PATH = { path: "/sellers/v1/marketplaceParticipations" };

describe("AmazonClient: request building", () => {
  it("SP: x-amz-access-token + user agent, no Authorization, regional host, path and query encoded", async () => {
    const t = createTestRuntime();
    t.transport.route(
      { path: "/reports/2021-06-30/reports/R%2F1" },
      jsonResponse(200, { ok: true }),
    );
    await t.runtime.client.call({
      operation: getReport,
      ref: FAKE_REF("sp", "eu"),
      path: { reportId: "R/1" },
      query: { marketplaceIds: ["A1", "A2"], skip: undefined },
    });
    const sent = t.transport.callsTo({ path: /reports\/R%2F1/ })[0];
    expect(sent?.url).toBe(
      "https://sellingpartnerapi-eu.amazon.com/reports/2021-06-30/reports/R%2F1?marketplaceIds=A1%2CA2",
    );
    expect(sent?.headers["x-amz-access-token"]).toMatch(/^Atza\|fake-access/);
    expect(sent?.headers.authorization).toBeUndefined();
    expect(sent?.headers["user-agent"]).toContain("seller-hub");
  });

  it("routes by region: NA, EU and FE hosts for SP and for Ads, and the sandbox host for SP only", async () => {
    const hosts = async (mode: "production" | "sandbox", op: OperationMeta, api: "sp" | "ads") => {
      const t = createTestRuntime({ mode });
      t.transport.route({ where: (r) => !r.url.includes("/auth/o2/") }, jsonResponse(200, {}));
      for (const region of ["na", "eu", "fe"] as const) {
        await t.runtime.client.call({ operation: op, ref: FAKE_REF(api, region) });
      }
      return t.transport.requests
        .filter((r) => !r.url.includes("/auth/o2/"))
        .map((r) => new URL(r.url).host);
    };
    expect(await hosts("production", getParticipations, "sp")).toEqual([
      "sellingpartnerapi-na.amazon.com",
      "sellingpartnerapi-eu.amazon.com",
      "sellingpartnerapi-fe.amazon.com",
    ]);
    expect(await hosts("sandbox", getParticipations, "sp")).toEqual([
      "sandbox.sellingpartnerapi-na.amazon.com",
      "sandbox.sellingpartnerapi-eu.amazon.com",
      "sandbox.sellingpartnerapi-fe.amazon.com",
    ]);
    // Ads has no sandbox host: sandbox mode still uses the production hosts (test accounts, EX-TEST-ACCOUNTS).
    expect(await hosts("sandbox", adsV0List, "ads")).toEqual([
      "advertising-api.amazon.com",
      "advertising-api-eu.amazon.com",
      "advertising-api-fe.amazon.com",
    ]);
  });

  it("Ads v1: Bearer token, Amazon-Ads-ClientId, profile scope and account id; JSON body", async () => {
    const t = createTestRuntime();
    t.transport.route({ path: "/adsApi/v1/query/campaigns" }, jsonResponse(200, { campaigns: [] }));
    await t.runtime.client.call({
      operation: adsV1Query,
      ref: FAKE_REF("ads"),
      body: { adProductFilter: { include: ["SPONSORED_PRODUCTS"] } },
      profileId: "12345",
      accountId: "ENTITY1",
    });
    const sent = t.transport.callsTo({ path: "/adsApi/v1/query/campaigns" })[0];
    expect(sent?.headers.authorization).toMatch(/^Bearer Atza\|/);
    expect(sent?.headers["amazon-ads-clientid"]).toBe(FAKE_LWA.clientId);
    expect(sent?.headers["amazon-advertising-api-clientid"]).toBeUndefined();
    expect(sent?.headers["amazon-advertising-api-scope"]).toBe("12345");
    expect(sent?.headers["amazon-ads-accountid"]).toBe("ENTITY1");
    expect(sent?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(sent?.bodyText ?? "{}")).toEqual({
      adProductFilter: { include: ["SPONSORED_PRODUCTS"] },
    });
  });

  it("Ads v0 uses the old client-id header", async () => {
    const t = createTestRuntime();
    t.transport.route({ path: "/v2/profiles" }, jsonResponse(200, []));
    await t.runtime.client.call({ operation: adsV0List, ref: FAKE_REF("ads") });
    const sent = t.transport.callsTo({ path: "/v2/profiles" })[0];
    expect(sent?.headers["amazon-advertising-api-clientid"]).toBe(FAKE_LWA.clientId);
    expect(sent?.headers["amazon-ads-clientid"]).toBeUndefined();
  });

  it("routes by the seller account's region (catalogue regions are advisory) and refuses a credential for the other API", async () => {
    const t = createTestRuntime();
    t.transport.route(SP_PATH, jsonResponse(200, {}));
    const euOnly = { ...getParticipations, regions: ["eu"] as const };
    await t.runtime.client.call({ operation: euOnly, ref: FAKE_REF("sp", "na") });
    expect(new URL(t.transport.callsTo(SP_PATH)[0]?.url ?? "").host).toBe(
      "sellingpartnerapi-na.amazon.com",
    );
    await expect(
      t.runtime.client.call({ operation: getParticipations, ref: FAKE_REF("ads") }),
    ).rejects.toBeInstanceOf(OperationUsageError);
    expect(t.transport.callsTo(SP_PATH)).toHaveLength(1);
  });
});

describe("AmazonClient: throttling and retry", () => {
  it("429 → honours Retry-After and backoff → succeeds", async () => {
    const t = createTestRuntime();
    t.transport.route(
      SP_PATH,
      jsonResponse(
        429,
        { errors: [{ code: "QuotaExceeded", message: "slow down" }] },
        { "retry-after": "7" },
      ),
      jsonResponse(429, { errors: [{ code: "QuotaExceeded" }] }),
      jsonResponse(200, { payload: [] }, { "x-amzn-RequestId": "REQ-1" }),
    );
    const res = await t.runtime.client.call({ operation: getParticipations, ref: FAKE_REF("sp") });
    expect(res.status).toBe(200);
    expect(res.attempts).toBe(3);
    expect(res.requestId).toBe("REQ-1");
    // first wait = max(Retry-After 7 s, jitter 0.5·1 s); second = jitter 0.5·2 s
    expect(t.clock.sleeps.filter((s) => s > 0)).toContain(7000);
    expect(t.clock.sleeps).toContain(1000);
    const event = t.events[0];
    expect(event).toMatchObject({
      outcome: "ok",
      retries: 2,
      throttled: true,
      status: 200,
      requestId: "REQ-1",
    });
  });

  it("gives up after the attempt budget with a retryable AmazonThrottledError", async () => {
    const t = createTestRuntime({
      retry: { maxAttempts: 3, baseMs: 1000, capMs: 60_000, maxRetryAfterMs: 120_000 },
    });
    t.transport.route(SP_PATH, jsonResponse(429, {}, { "retry-after": "2" }));
    const err = await t.runtime.client
      .call({ operation: getParticipations, ref: FAKE_REF("sp") })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AmazonThrottledError);
    expect((err as AmazonThrottledError).retryable).toBe(true);
    expect((err as AmazonThrottledError).retryAfterMs).toBe(2000);
    expect(t.transport.callsTo(SP_PATH)).toHaveLength(3);
  });

  it("does not sleep on a Retry-After longer than the cap: fails at once so the job can be delayed", async () => {
    const t = createTestRuntime();
    t.transport.route(SP_PATH, jsonResponse(429, {}, { "retry-after": "900" }));
    const err = await t.runtime.client
      .call({ operation: getParticipations, ref: FAKE_REF("sp") })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AmazonThrottledError);
    expect((err as AmazonThrottledError).retryAfterMs).toBe(900_000);
    expect(t.transport.callsTo(SP_PATH)).toHaveLength(1);
  });

  it("retries a write on 429 (not processed) but never on 5xx without an idempotency guard", async () => {
    const t = createTestRuntime();
    const route = { method: "POST" as const, path: "/reports/2021-06-30/reports" };
    t.transport.route(route, jsonResponse(429, {}), jsonResponse(202, { reportId: "1" }));
    const ok = await t.runtime.client.call({
      operation: createReport,
      ref: FAKE_REF("sp"),
      body: {},
    });
    expect(ok.status).toBe(202);

    t.transport.reset();
    mockLwa(t.transport);
    t.transport.route(route, jsonResponse(500, {}), jsonResponse(202, { reportId: "2" }));
    const err = await t.runtime.client
      .call({ operation: createReport, ref: FAKE_REF("sp"), body: {} })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AmazonUpstreamError);
    expect((err as AmazonUpstreamError).retryable).toBe(false);
    expect((err as Error).message).toMatch(/reconcile by re-reading/);
    expect(t.transport.callsTo(route)).toHaveLength(1);
  });

  it("retries a write on 5xx when the caller supplies an idempotency guard", async () => {
    const t = createTestRuntime();
    const route = { method: "POST" as const, path: "/reports/2021-06-30/reports" };
    t.transport.route(route, jsonResponse(503, {}), jsonResponse(202, { reportId: "3" }));
    const ok = await t.runtime.client.call({
      operation: createReport,
      ref: FAKE_REF("sp"),
      body: {},
      idempotent: true,
    });
    expect(ok.status).toBe(202);
    expect(ok.attempts).toBe(2);
  });

  it("retries reads on 5xx and on network errors", async () => {
    const t = createTestRuntime();
    t.transport.route(
      SP_PATH,
      jsonResponse(502, {}),
      { throw: new Error("ECONNRESET") },
      jsonResponse(200, { payload: [] }),
    );
    const res = await t.runtime.client.call({ operation: getParticipations, ref: FAKE_REF("sp") });
    expect(res.attempts).toBe(3);
  });

  it.each([
    [400, AmazonValidationError],
    [422, AmazonValidationError],
    [403, AmazonAuthError],
    [404, AmazonNotFoundError],
    [409, AmazonApiError],
  ])("%i is never retried and maps to %o", async (status, klass) => {
    const t = createTestRuntime();
    t.transport.route(
      SP_PATH,
      jsonResponse(
        status,
        { errors: [{ code: "InvalidInput", message: "bad marketplace" }] },
        { "x-amzn-RequestId": "R9" },
      ),
    );
    const err = await t.runtime.client
      .call({ operation: getParticipations, ref: FAKE_REF("sp") })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(klass);
    expect((err as AmazonApiError).amazonCode).toBe("InvalidInput");
    expect((err as AmazonApiError).context.requestId).toBe("R9");
    expect(t.transport.callsTo(SP_PATH)).toHaveLength(1);
  });

  it("401: refreshes the token once and retries; a second 401 is an AmazonAuthError", async () => {
    const t = createTestRuntime();
    t.transport.route(
      SP_PATH,
      jsonResponse(401, { errors: [{ code: "Unauthorized" }] }),
      jsonResponse(200, { payload: [] }),
    );
    const res = await t.runtime.client.call({ operation: getParticipations, ref: FAKE_REF("sp") });
    expect(res.attempts).toBe(2);
    expect(t.transport.callsTo({ path: "/auth/o2/token" })).toHaveLength(2); // initial + forced refresh
    const [first, second] = t.transport.callsTo(SP_PATH);
    expect(first?.headers["x-amz-access-token"]).not.toBe(second?.headers["x-amz-access-token"]);

    const t2 = createTestRuntime();
    t2.transport.route(SP_PATH, jsonResponse(401, {}));
    await expect(
      t2.runtime.client.call({ operation: getParticipations, ref: FAKE_REF("sp") }),
    ).rejects.toBeInstanceOf(AmazonAuthError);
    expect(t2.transport.callsTo(SP_PATH)).toHaveLength(2);
  });

  it("failFast raises LocalRateLimitError from our own limiter without calling Amazon", async () => {
    const t = createTestRuntime();
    t.transport.route(SP_PATH, jsonResponse(200, {}));
    const slow = { ...getParticipations, rateLimit: { rate: 0.001, burst: 1 } };
    await t.runtime.client.call({
      operation: slow,
      ref: FAKE_REF("sp"),
      wait: { kind: "failFast" },
    });
    await expect(
      t.runtime.client.call({ operation: slow, ref: FAKE_REF("sp"), wait: { kind: "failFast" } }),
    ).rejects.toBeInstanceOf(LocalRateLimitError);
    expect(t.transport.callsTo(SP_PATH)).toHaveLength(1);
  });

  it("spaces calls by the catalogue rate and adopts x-amzn-RateLimit-Limit", async () => {
    const t = createTestRuntime();
    const op = { ...getParticipations, rateLimit: { rate: 0.5, burst: 1 } };
    t.transport.route(SP_PATH, jsonResponse(200, {}, { "x-amzn-RateLimit-Limit": "0.5" }));
    await t.runtime.client.call({ operation: op, ref: FAKE_REF("sp") });
    await t.runtime.client.call({ operation: op, ref: FAKE_REF("sp") });
    expect(t.clock.sleeps).toEqual([2000]);
    expect(t.events[1]?.waitedMs).toBe(2000);
  });

  it("two seller accounts do not share a bucket", async () => {
    const t = createTestRuntime();
    t.transport.route(SP_PATH, jsonResponse(200, {}));
    const op = { ...getParticipations, rateLimit: { rate: 0.001, burst: 1 } };
    await t.runtime.client.call({
      operation: op,
      ref: FAKE_REF("sp", "na", "sa-1"),
      wait: { kind: "failFast" },
    });
    await t.runtime.client.call({
      operation: op,
      ref: FAKE_REF("sp", "na", "sa-2"),
      wait: { kind: "failFast" },
    });
  });
});

describe("AmazonClient: restricted data (D11)", () => {
  it("refuses a catalogue-restricted operation before any network call", async () => {
    const t = createTestRuntime();
    const err = await t.runtime.client
      .call({ operation: restrictedOp, ref: FAKE_REF("sp"), path: { orderId: "1" } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PiiDisabled);
    expect(t.transport.requests).toHaveLength(0);
  });

  it("refuses any call that carries a Restricted Data Token", async () => {
    const t = createTestRuntime();
    await expect(
      t.runtime.client.call({
        operation: getParticipations,
        ref: FAKE_REF("sp"),
        restrictedDataToken: "Atz.sprdt|x",
      }),
    ).rejects.toBeInstanceOf(PiiDisabled);
  });

  it("lets a typed client assert that one specific request is PII-free", async () => {
    const t = createTestRuntime();
    t.transport.route({ path: "/orders/2026-01-01/orders/1" }, jsonResponse(200, {}));
    const res = await t.runtime.client.call({
      operation: restrictedOp,
      ref: FAKE_REF("sp"),
      path: { orderId: "1" },
      piiCheck: { verifiedNoPii: true, reason: "no BUYER/RECIPIENT in includedData" },
    });
    expect(res.status).toBe(200);
  });
});

describe("AmazonClient: logging hooks never leak secrets", () => {
  it("emits operation, account, status, latency and request id, and nothing secret", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write: (c: Buffer, _e, cb) => (chunks.push(c.toString()), cb()),
    });
    const logger = createLogger({ name: "test", level: "debug", stream });
    const transport = new MockTransport();
    mockLwa(transport);
    transport.route(
      SP_PATH,
      jsonResponse(500, {
        errors: [{ code: "X", message: "boom", details: "Atza|should-not-print" }],
      }),
      jsonResponse(200, {}, { "x-amzn-RequestId": "REQ-9" }),
    );
    const runtime = createAmazonRuntime({
      credentials: fakeCredentialSource(),
      mode: "production",
      transport,
      clock: new ManualClock(),
      random: () => 0.5,
      logger,
    });
    await runtime.client.call({
      operation: getParticipations,
      ref: FAKE_REF("sp"),
      query: { secret: "Atza|query-secret" },
    });
    const out = chunks.join("");
    expect(out).toContain("sellers.getMarketplaceParticipations");
    expect(out).toContain("REQ-9");
    expect(out).toContain("sa-1");
    expect(out).not.toMatch(/Atza\|/);
    expect(out).not.toContain(FAKE_LWA.refreshToken);
    expect(out).not.toContain(FAKE_LWA.clientSecret);
    expect(out).not.toContain("query-secret");
  });

  it("scrubs token-like keys from the error payload it keeps", async () => {
    const t = createTestRuntime();
    t.transport.route(
      SP_PATH,
      jsonResponse(400, {
        errors: [{ code: "InvalidInput", message: "m" }],
        access_token: "Atza|leak",
        nested: { refresh_token: "r" },
      }),
    );
    const err = (await t.runtime.client
      .call({ operation: getParticipations, ref: FAKE_REF("sp") })
      .catch((e: unknown) => e)) as AmazonApiError;
    expect(JSON.stringify(err.details)).not.toContain("Atza|leak");
    expect(JSON.stringify(err.details)).not.toContain('"r"');
  });
});

describe("AmazonClient: updates and binary", () => {
  it("Ads 207 is returned as success=2xx; the caller maps items", async () => {
    const t = createTestRuntime();
    t.transport.route(
      { path: "/adsApi/v1/update/targets" },
      jsonResponse(207, { success: [], error: [] }),
    );
    const res = await t.runtime.client.call({
      operation: adsV1Update,
      ref: FAKE_REF("ads"),
      body: { targets: [] },
    });
    expect(res.status).toBe(207);
  });

  it("returns raw bytes when asked and an empty body as undefined", async () => {
    const t = createTestRuntime();
    t.transport.route(
      { path: "/reports/2021-06-30/reports/R1" },
      bytesResponse(200, new Uint8Array([1, 2, 3])),
    );
    const bin = await t.runtime.client.call<Uint8Array>({
      operation: getReport,
      ref: FAKE_REF("sp"),
      path: { reportId: "R1" },
      responseType: "bytes",
    });
    expect([...bin.body]).toEqual([1, 2, 3]);
    t.transport.route({ path: "/reports/2021-06-30/reports/R2" }, emptyResponse(204));
    const empty = await t.runtime.client.call({
      operation: getReport,
      ref: FAKE_REF("sp"),
      path: { reportId: "R2" },
    });
    expect(empty.body).toBeUndefined();
  });
});
