import { describe, expect, it } from "vitest";
import { AmazonAuthError, OperationUsageError, type OperationMeta } from "../src";
import { FAKE_REF, createTestRuntime, jsonResponse } from "../src/testing";

// Fixes from the P5 review of P3-CLIENTS (M2, S8, N3). M3 lives in batch.test.ts, M1 in amazon-sp, M4 in amazon-ads.

const adsWrite: OperationMeta = {
  id: "SPUpdateTarget",
  api: "ads",
  family: "AmazonAdsAPISPTargetsContract",
  method: "POST",
  path: "/adsApi/v1/update/targets",
  generation: "v1",
  multiStatus207: true,
};
const adsRead: OperationMeta = {
  id: "listProfiles",
  api: "ads",
  family: "profiles-3-0",
  method: "GET",
  path: "/v2/profiles",
  generation: "v0",
  exception: "EX-PROFILES",
  idempotent: true,
};
const adsReadPost: OperationMeta = {
  ...adsWrite,
  id: "SPQueryTarget",
  path: "/adsApi/v1/query/targets",
  idempotent: true,
};
const spGet: OperationMeta = {
  id: "reports.getReport",
  api: "sp",
  family: "reports@2021-06-30",
  method: "GET",
  path: "/reports/2021-06-30/reports/R1",
  idempotent: true,
};

describe("M2: sandbox mode never sends an Ads write to the live host", () => {
  it("refuses an Ads write in sandbox mode before any network call", async () => {
    const t = createTestRuntime({ mode: "sandbox" });
    t.transport.route({ where: () => true }, jsonResponse(207, { success: [], error: [] }));
    await expect(
      t.runtime.client.call({ operation: adsWrite, ref: FAKE_REF("ads"), body: { targets: [] } }),
    ).rejects.toBeInstanceOf(OperationUsageError);
    expect(t.transport.requests).toHaveLength(0);
  });

  it("still allows Ads reads (GET and read-only POST) and every SP-API call in sandbox mode", async () => {
    const t = createTestRuntime({ mode: "sandbox" });
    t.transport.route({ where: (r) => !r.url.includes("/auth/o2/") }, jsonResponse(200, {}));
    await t.runtime.client.call({ operation: adsRead, ref: FAKE_REF("ads") });
    await t.runtime.client.call({ operation: adsReadPost, ref: FAKE_REF("ads"), body: {} });
    await t.runtime.client.call({ operation: spGet, ref: FAKE_REF("sp") });
    expect(t.transport.requests.filter((r) => !r.url.includes("/auth/o2/"))).toHaveLength(3);
  });

  it("an explicit opt-in allows the write; production mode never needed it", async () => {
    const t = createTestRuntime({ mode: "sandbox", overrides: { allowAdsWritesInSandbox: true } });
    t.transport.route(
      { path: "/adsApi/v1/update/targets" },
      jsonResponse(207, { success: [], error: [] }),
    );
    expect(
      (await t.runtime.client.call({ operation: adsWrite, ref: FAKE_REF("ads"), body: {} })).status,
    ).toBe(207);
    const p = createTestRuntime({ mode: "production" });
    p.transport.route(
      { path: "/adsApi/v1/update/targets" },
      jsonResponse(207, { success: [], error: [] }),
    );
    expect(
      (await p.runtime.client.call({ operation: adsWrite, ref: FAKE_REF("ads"), body: {} })).status,
    ).toBe(207);
  });
});

describe("S8: 401 refreshes the token once even after an earlier retry", () => {
  it("429 then 401 then 200: the 401 triggers one forced refresh", async () => {
    const t = createTestRuntime();
    t.transport.route(
      { path: "/reports/2021-06-30/reports/R1" },
      jsonResponse(429, {}),
      jsonResponse(401, {}),
      jsonResponse(200, { ok: true }),
    );
    const res = await t.runtime.client.call({ operation: spGet, ref: FAKE_REF("sp") });
    expect(res.status).toBe(200);
    expect(t.transport.callsTo({ path: "/auth/o2/token" })).toHaveLength(2);
  });

  it("a second 401 after the refresh is an AmazonAuthError, not another refresh", async () => {
    const t = createTestRuntime();
    t.transport.route({ path: "/reports/2021-06-30/reports/R1" }, jsonResponse(401, {}));
    await expect(
      t.runtime.client.call({ operation: spGet, ref: FAKE_REF("sp") }),
    ).rejects.toBeInstanceOf(AmazonAuthError);
    expect(t.transport.callsTo({ path: "/auth/o2/token" })).toHaveLength(2);
  });
});

describe("N3: token-shaped values are scrubbed even under innocent keys", () => {
  it("removes Atza| / Atzr| values from kept error details", async () => {
    const t = createTestRuntime();
    t.transport.route(
      { path: "/reports/2021-06-30/reports/R1" },
      jsonResponse(400, {
        errors: [
          { code: "InvalidInput", message: "m", details: "see Atza|abc.def-ghi and Atzr|xyz" },
        ],
      }),
    );
    const err = (await t.runtime.client
      .call({ operation: spGet, ref: FAKE_REF("sp") })
      .catch((e: unknown) => e)) as { details: unknown };
    expect(JSON.stringify(err.details)).not.toMatch(/Atz[ar]\|/);
  });
});
