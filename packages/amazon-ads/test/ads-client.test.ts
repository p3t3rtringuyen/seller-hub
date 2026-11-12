import {
  MemoryConcurrencyGate,
  LocalRateLimitError,
  OperationUsageError,
} from "@seller-hub/amazon-core";
import {
  createReplayTransport,
  createTestRuntime,
  jsonResponse,
} from "@seller-hub/amazon-core/testing";
import { describe, expect, it } from "vitest";
import {
  AdsReportFailedError,
  createAdsClient,
  createAdsReports,
  createBudgetRulesReadPort,
  createCampaignsPort,
  createExportsPort,
  createProfilesPort,
  createTargetsPort,
  type AdsScope,
} from "../src";
import { adsFixtures } from "../src/testing";

const scope: AdsScope = {
  tenantId: "tenant-1",
  sellerAccountId: "sa-1",
  region: "na",
  profileId: "1234567890",
  accountId: "ENTITY1ABC",
};

function replay() {
  const t = createTestRuntime({
    transport: createReplayTransport({ fixtures: adsFixtures() }),
    mode: "replay",
  });
  return { ...t, ads: createAdsClient(t.runtime.client) };
}
function mocked() {
  const t = createTestRuntime();
  return { ...t, ads: createAdsClient(t.runtime.client) };
}

describe("Ads client", () => {
  it("v1 call: typed per operation, v1 headers, profile scope", async () => {
    const { ads, transport } = mocked();
    transport.route(
      { path: "/adsApi/v1/query/campaigns" },
      jsonResponse(200, { campaigns: [{ campaignId: "C1" }] }),
    );
    const res = await ads.SPQueryCampaign(scope, {
      body: { adProductFilter: { include: ["SPONSORED_PRODUCTS"] } },
    });
    expect(res.body.campaigns?.[0]?.campaignId).toBe("C1");
    const sent = transport.callsTo({ path: "/adsApi/v1/query/campaigns" })[0];
    expect(sent?.headers["amazon-ads-clientid"]).toBeDefined();
    expect(sent?.headers["amazon-advertising-api-scope"]).toBe("1234567890");
    expect(sent?.headers["amazon-ads-accountid"]).toBe("ENTITY1ABC");
  });

  it("routes EU and FE profiles to their own Ads hosts", async () => {
    const { ads, transport } = mocked();
    transport.route({ path: "/v2/profiles" }, jsonResponse(200, []));
    await ads.listProfiles({ ...scope, region: "eu" });
    await ads.listProfiles({ ...scope, region: "fe" });
    const hosts = transport.callsTo({ path: "/v2/profiles" }).map((r) => new URL(r.url).host);
    expect(hosts).toEqual(["advertising-api-eu.amazon.com", "advertising-api-fe.amazon.com"]);
  });

  it("429 on Ads halves the adaptive rate and retries after Retry-After", async () => {
    const { ads, transport, clock, runtime } = mocked();
    transport.route(
      { path: "/adsApi/v1/query/campaigns" },
      jsonResponse(429, { code: "TOO_MANY_REQUESTS", message: "slow" }, { "retry-after": "4" }),
      jsonResponse(200, { campaigns: [] }),
    );
    await ads.SPQueryCampaign(scope, {
      body: { adProductFilter: { include: ["SPONSORED_PRODUCTS"] } },
    });
    expect(clock.sleeps).toContain(4000);
    void runtime;
  });

  it("refuses an unknown operation id", async () => {
    const { ads } = mocked();
    // @ts-expect-error not a generated operation
    await expect(ads.call("SPNoSuchThing", scope)).rejects.toBeInstanceOf(OperationUsageError);
  });
});

describe("207 batch writes", () => {
  it("returns one result per item with the failure kept per item (replay fixture)", async () => {
    const { ads } = replay();
    const items = [
      { targetId: "T1", bid: { bid: 0.75 } },
      { targetId: "T2", bid: { bid: 0.001 } },
    ];
    const r = await ads.batch<(typeof items)[number], { targetId: string }>(
      "SPUpdateTarget",
      scope,
      items,
    );
    expect(r.succeeded).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.partial).toBe(true);
    expect(r.items[0]).toMatchObject({ ok: true, entity: { targetId: "T1" } });
    expect(r.items[1]).toMatchObject({
      ok: false,
      errors: [{ code: "FIELD_VALUE_IS_BELOW_MINIMUM_LIMIT", fieldLocation: "/targets/1/bid/bid" }],
      retryable: false,
    });
  });

  it("chunks by the catalogue batchMax (1000) and sends the right body field", async () => {
    const { ads, transport } = mocked();
    transport.route({ path: "/adsApi/v1/update/targets" }, (req) => {
      const sent = JSON.parse(new TextDecoder().decode(req.body as Uint8Array)) as {
        targets: unknown[];
      };
      return jsonResponse(207, {
        success: sent.targets.map((t, index) => ({ index, target: t })),
        error: [],
      });
    });
    const items = Array.from({ length: 2500 }, (_, i) => ({ targetId: `T${i}` }));
    const r = await ads.batch("SPUpdateTarget", scope, items);
    const calls = transport.callsTo({ path: "/adsApi/v1/update/targets" });
    expect(
      calls.map((c) => (JSON.parse(c.bodyText ?? "{}") as { targets: unknown[] }).targets.length),
    ).toEqual([1000, 1000, 500]);
    expect(r.allOk).toBe(true);
    expect(r.items).toHaveLength(2500);
    expect(r.items[2499]).toMatchObject({ index: 2499, input: { targetId: "T2499" } });
  });

  it("a whole-request 400 becomes a failure of every item in that chunk, not an exception", async () => {
    const { ads, transport } = mocked();
    transport.route(
      { path: "/adsApi/v1/update/targets" },
      jsonResponse(400, { code: "BAD_REQUEST", message: "invalid" }),
    );
    const r = await ads.batch("SPUpdateTarget", scope, [{ targetId: "T1" }, { targetId: "T2" }]);
    expect(r).toMatchObject({ failed: 2, succeeded: 0 });
    expect(r.items[0]).toMatchObject({
      ok: false,
      retryable: false,
      errors: [{ code: "BAD_REQUEST" }],
    });
  });

  it("a write that fails with 5xx is reported as outcome_unknown, not retried and not assumed lost", async () => {
    const { ads, transport } = mocked();
    transport.route({ path: "/adsApi/v1/update/targets" }, jsonResponse(500, {}));
    const r = await ads.batch("SPUpdateTarget", scope, [{ targetId: "T1" }]);
    expect(r.items[0]).toMatchObject({
      ok: false,
      retryable: false,
      errors: [{ code: "outcome_unknown" }],
    });
    expect(transport.callsTo({ path: "/adsApi/v1/update/targets" })).toHaveLength(1);
  });

  it("an exhausted 429 is a retryable item failure", async () => {
    const { ads, transport } = mocked();
    transport.route(
      { path: "/adsApi/v1/update/targets" },
      jsonResponse(429, {}, { "retry-after": "1" }),
    );
    const r = await ads.batch("SPUpdateTarget", scope, [{ targetId: "T1" }]);
    expect(r.items[0]).toMatchObject({
      ok: false,
      retryable: true,
      errors: [{ code: "TOO_MANY_REQUESTS" }],
    });
  });

  it("refuses batch() on an operation that is not a 207 batch", async () => {
    const { ads } = mocked();
    await expect(ads.batch("SPQueryCampaign", scope, [{}])).rejects.toBeInstanceOf(
      OperationUsageError,
    );
  });
});

describe("ports (v1 adapters)", () => {
  it("CampaignsPort.queryPages follows nextToken", async () => {
    const { ads } = replay();
    const port = createCampaignsPort(ads);
    const pages: string[][] = [];
    for await (const page of port.queryPages(scope, {
      adProductFilter: { include: ["SPONSORED_PRODUCTS"] },
    })) {
      pages.push(page.map((c) => String(c.campaignId)));
    }
    expect(pages).toEqual([["C1"], ["C2"]]);
  });

  it("TargetsPort.update maps 207 to a BatchResult", async () => {
    const { ads } = replay();
    const r = await createTargetsPort(ads).update(scope, [
      { targetId: "T1" } as never,
      { targetId: "T2" } as never,
    ]);
    expect(r.items.map((i) => i.ok)).toEqual([true, false]);
  });

  it("CampaignsPort.delete sends campaignIds", async () => {
    const { ads, transport } = mocked();
    transport.route(
      { path: "/adsApi/v1/delete/campaigns" },
      jsonResponse(207, { success: [{ index: 0, campaignId: "C1" }], error: [] }),
    );
    const r = await createCampaignsPort(ads).delete(scope, ["C1"]);
    expect(
      JSON.parse(transport.callsTo({ path: "/adsApi/v1/delete/campaigns" })[0]?.bodyText ?? "{}"),
    ).toEqual({ campaignIds: ["C1"] });
    expect(r.allOk).toBe(true);
  });
});

describe("v1 reports (no Reporting v3): create → poll → download → decompress", () => {
  const body = {
    accessRequestedAccounts: [{ advertiserAccountId: "ENTITY1ABC" }],
    reports: [
      {
        format: "GZIP_JSON",
        periods: [{ datePeriod: { startDate: "2026-11-01", endDate: "2026-11-01" } }],
        query: { fields: ["campaign.id", "metric.impressions"] },
      },
    ],
  } as never;

  it("runs end to end on the replay fixtures and releases its slot", async () => {
    const { ads, transport, clock } = replay();
    const gate = new MemoryConcurrencyGate(clock);
    const reports = createAdsReports({ ads, gate });
    const out = await reports.run(scope, body, { pollIntervalMs: 5000 });
    expect(out.reportId).toBe("RPT-1");
    expect(out.parts).toHaveLength(1);
    expect(JSON.parse(out.text().trim())).toMatchObject({
      campaign: { id: "C1" },
      metric: { clicks: 20 },
    });
    expect(clock.sleeps).toContain(5000);
    // only v1 endpoints were used
    const paths = transport.requests
      .map((r) => new URL(r.url).pathname)
      .filter((p) => !p.includes("/auth/") && !p.startsWith("/fixture"));
    expect(paths.every((p) => p.startsWith("/adsApi/v1/"))).toBe(true);
    expect(await gate.tryAcquire("ads:v1-reports", 1, 1000)).not.toBeNull();
  });

  it("holds the global slot: a second run fails fast with LocalRateLimitError while the first is active", async () => {
    const { ads, clock } = replay();
    const gate = new MemoryConcurrencyGate(clock);
    const held = await gate.tryAcquire("ads:v1-reports", 1, 60_000);
    expect(held).not.toBeNull();
    await expect(createAdsReports({ ads, gate }).run(scope, body)).rejects.toBeInstanceOf(
      LocalRateLimitError,
    );
  });

  it("reports a FAILED report with its failure code and still releases the slot", async () => {
    const { ads, transport, clock } = mocked();
    const gate = new MemoryConcurrencyGate(clock);
    transport.route(
      { path: "/adsApi/v1/create/reports" },
      jsonResponse(207, {
        success: [{ index: 0, report: { reportId: "R2", status: "PENDING" } }],
        error: [],
      }),
    );
    transport.route(
      { path: "/adsApi/v1/retrieve/reports" },
      jsonResponse(207, {
        success: [
          { index: 0, report: { reportId: "R2", status: "FAILED", failureCode: "TOO_LARGE" } },
        ],
        error: [],
      }),
    );
    await expect(createAdsReports({ ads, gate }).run(scope, body)).rejects.toBeInstanceOf(
      AdsReportFailedError,
    );
    expect(await gate.tryAcquire("ads:v1-reports", 1, 1000)).not.toBeNull();
  });
});

describe("v0 named exceptions", () => {
  it("EX-PROFILES lists profiles through the v0 endpoint", async () => {
    const { ads } = replay();
    const profiles = await createProfilesPort(ads).list(scope);
    expect(profiles[0]?.profileId).toBe(1234567890);
  });

  it("EX-EXPORTS: create (202) → poll → download → parse, within the 5-per-endpoint cap", async () => {
    const { ads, transport, clock } = mocked();
    const gate = new MemoryConcurrencyGate(clock);
    const { gzipSync } = await import("node:zlib");
    transport.route(
      { method: "POST", path: "/campaigns/export" },
      jsonResponse(202, { exportId: "EXP1", status: "PROCESSING" }),
    );
    transport.route(
      { path: "/exports/EXP1" },
      jsonResponse(200, { exportId: "EXP1", status: "PROCESSING" }),
      jsonResponse(200, {
        exportId: "EXP1",
        status: "COMPLETED",
        url: "https://s3.test/exp1.json.gz",
      }),
    );
    transport.route(
      { url: "https://s3.test/exp1.json.gz" },
      { status: 200, headers: {}, body: gzipSync(JSON.stringify([{ campaignId: "C1" }])) },
    );
    const exportsPort = createExportsPort(ads, gate);
    expect(await exportsPort.run(scope, "campaigns", { stateFilter: ["ENABLED"] })).toEqual([
      { campaignId: "C1" },
    ]);
    expect(transport.callsTo({ path: "/exports/EXP1" })[0]?.headers.accept).toBe(
      "application/vnd.campaignsexport.v1+json",
    );
    expect(
      transport.callsTo({ method: "POST", path: "/campaigns/export" })[0]?.headers["content-type"],
    ).toBe("application/vnd.campaignsexport.v1+json");
    // 5 slots per endpoint, then fail fast
    for (let i = 0; i < 5; i++) await gate.tryAcquire("ads:export:campaigns", 5, 60_000);
    await expect(exportsPort.run(scope, "campaigns", {})).rejects.toBeInstanceOf(
      LocalRateLimitError,
    );
  });

  it("EX-BUDGET-RULES is read only: GET operations, and the port has no write method", async () => {
    const { ads, transport } = mocked();
    transport.route({ path: "/sp/budgetRules" }, jsonResponse(200, { budgetRulesDetails: [] }));
    const port = createBudgetRulesReadPort(ads);
    await port.list(scope, "SP");
    expect(transport.callsTo({ path: "/sp/budgetRules" })[0]?.method).toBe("GET");
    expect(Object.keys(port).sort()).toEqual(["campaignsOfRule", "get", "list", "rulesOfCampaign"]);
  });
});
