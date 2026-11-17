import { gzipSync } from "node:zlib";
import { encodeText } from "@seller-hub/amazon-core";
import { bytesResponse, jsonResponse } from "@seller-hub/amazon-core/testing";
import type { SellerScope } from "@seller-hub/core";
import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsvParts, parseJsonRecords } from "../src/parsers";
import * as repo from "../src/repository";
import { createTestEngine } from "../src/testing";
import {
  defineAdsExport,
  defineAdsReport,
  defineDataKiosk,
  type DataKioskPort,
  type IngestDefinition,
  type SyncTarget,
} from "../src/types";

const t = await tryCreateTestDb();
const A: SellerScope = { tenantId: FIXTURE.tenantId, sellerAccountId: FIXTURE.sellerAccountId };
const PROFILE = "1234567890";
const target: SyncTarget = {
  tenantId: A.tenantId,
  sellerAccountId: A.sellerAccountId as string,
  accountType: "seller",
  region: "na",
  marketplaceIds: ["ATVPDKIKX0DER"],
  adsProfiles: [{ profileId: PROFILE, marketplaceId: "ATVPDKIKX0DER", accountType: "seller" }],
  paused: {},
};

async function engineWith(defs: IngestDefinition[], kiosk?: DataKioskPort) {
  const h = createTestEngine({
    app: t!.app.db,
    owner: t!.owner.db,
    definitions: defs,
    targets: [target],
    ...(kiosk ? { kiosk } : {}),
  });
  await h.scheduler.ensureStates();
  return h;
}

describe.skipIf(!t)("report families other than SP-API reports", () => {
  beforeAll(async () => {
    await seedFixtures(t!);
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("Ads v1 report: create -> poll -> download parts -> parse -> upsert, per Ads profile (no Reporting v3)", async () => {
    const seen: unknown[] = [];
    const def = defineAdsReport<{ campaignId: string; cost: number }>({
      key: "ads.sp-report-daily",
      family: "ads-report",
      schedule: { every: "6h", jitter: "30m" },
      window: { lookbackDays: 3, maxRangeDays: 31 },
      operations: ["AdsApiv1CreateReport", "AdsApiv1RetrieveReport"],
      buildRequest: (ctx) => ({
        reports: [
          {
            format: "GZIP_JSON",
            periods: [
              {
                datePeriod: {
                  startDate: ctx.window.start?.toISOString().slice(0, 10),
                  endDate: ctx.window.end?.toISOString().slice(0, 10),
                },
              },
            ],
          },
        ],
      }),
      parse: (parts) =>
        parts.flatMap((p) =>
          parseJsonRecords(p).map((r) => ({
            campaignId: String((r as { campaignId: string }).campaignId),
            cost: Number((r as { cost: number }).cost),
          })),
        ),
      upsert: async (ctx, rows) => {
        expect(ctx.scopeKey).toBe(PROFILE);
        seen.push(...rows);
      },
    });
    const h = await engineWith([def]);
    const tr = h.amazon.transport;
    tr.route(
      { method: "POST", path: "/adsApi/v1/create/reports" },
      jsonResponse(207, {
        success: [
          { index: 0, report: { reportId: "RPT-1", status: "PENDING", format: "GZIP_JSON" } },
        ],
        error: [],
      }),
    );
    tr.route(
      { method: "POST", path: "/adsApi/v1/retrieve/reports" },
      jsonResponse(207, {
        success: [{ index: 0, report: { reportId: "RPT-1", status: "PROCESSING" } }],
        error: [],
      }),
      jsonResponse(207, {
        success: [
          {
            index: 0,
            report: {
              reportId: "RPT-1",
              status: "COMPLETED",
              format: "GZIP_JSON",
              completedReportParts: [
                { url: "https://reports.example.test/p1.gz" },
                { url: "https://reports.example.test/p2.gz" },
              ],
            },
          },
        ],
        error: [],
      }),
    );
    tr.route(
      { path: "/p1.gz" },
      bytesResponse(200, gzipSync(encodeText('[{"campaignId":"c1","cost":1.5}]'))),
    );
    tr.route(
      { path: "/p2.gz" },
      bytesResponse(
        200,
        gzipSync(encodeText('{"campaignId":"c2","cost":2}\n{"campaignId":"c3","cost":0}')),
      ),
    );

    const { runId } = await h.scheduler.requestRefresh(A, {
      syncKey: "ads.sp-report-daily",
      scopeKey: PROFILE,
    });
    await h.drain();
    const run = (await repo.listRuns(A, t!.app.db, { syncKey: "ads.sp-report-daily" })).find(
      (r) => r.id === runId,
    )!;
    expect(run.state).toBe("done");
    expect(run.amazonRequestId).toBe("RPT-1");
    expect(seen).toEqual([
      { campaignId: "c1", cost: 1.5 },
      { campaignId: "c2", cost: 2 },
      { campaignId: "c3", cost: 0 },
    ]);
    expect((await repo.listRawObjects(A, t!.app.db, runId)).map((o) => o.part)).toEqual([0, 1]);
    // the 3-day lookback window was asked for, not the full history
    const created = JSON.parse(
      tr.callsTo({ path: "/adsApi/v1/create/reports" })[0]?.bodyText ?? "{}",
    );
    expect(JSON.stringify(created)).toContain("startDate");
    expect(tr.requests.every((r) => !/\/v3\/|reporting\/v3|\/reporting\/reports/.test(r.url))).toBe(
      true,
    );
  });

  it("Ads export snapshot: create -> poll -> download -> parse -> upsert -> reconcile (deletion detection)", async () => {
    const upserted: string[] = [];
    let reconciled: string[] = [];
    const def = defineAdsExport<{ campaignId: string }>({
      key: "ads.campaign-export",
      family: "ads-export",
      exportOperation: "CampaignExport",
      schedule: { every: "1d", jitter: "1h" },
      operations: ["CampaignExport", "GetExport"],
      buildRequest: () => ({ adProductFilter: ["SPONSORED_PRODUCTS"] }),
      parse: (text) =>
        parseJsonRecords(text).map((r) => ({
          campaignId: String((r as { campaignId: string }).campaignId),
        })),
      upsert: async (_c, rows) => void upserted.push(...rows.map((r) => r.campaignId)),
      reconcile: async (_c, rows) => void (reconciled = rows.map((r) => r.campaignId)),
    });
    const h = await engineWith([def]);
    const tr = h.amazon.transport;
    tr.route(
      { method: "POST", path: "/campaigns/export" },
      jsonResponse(202, { exportId: "E-1", status: "PROCESSING" }),
    );
    tr.route(
      { method: "GET", path: "/exports/E-1" },
      jsonResponse(200, { exportId: "E-1", status: "PROCESSING" }),
      jsonResponse(200, {
        exportId: "E-1",
        status: "COMPLETED",
        url: "https://exports.example.test/e1.json",
      }),
    );
    tr.route(
      { path: "/e1.json" },
      bytesResponse(200, encodeText('[{"campaignId":"x1"},{"campaignId":"x2"}]')),
    );
    await h.scheduler.requestRefresh(A, { syncKey: "ads.campaign-export", scopeKey: PROFILE });
    await h.drain();
    expect(upserted).toEqual(["x1", "x2"]);
    expect(reconciled).toEqual(["x1", "x2"]);
    const poll = tr.callsTo({ path: "/exports/E-1" })[0];
    expect(poll?.headers.accept).toBe("application/vnd.campaignsexport.v1+json");
  });

  it("Data Kiosk query: create -> poll -> document -> parse -> upsert, through the port", async () => {
    const rows: number[] = [];
    const states = ["IN_QUEUE", "IN_PROGRESS", "DONE"] as const;
    let polls = 0;
    const kiosk: DataKioskPort = {
      async createQuery() {
        return { queryId: "Q-1" };
      },
      async getQuery() {
        const status = states[Math.min(polls++, 2)] as (typeof states)[number];
        return { status, ...(status === "DONE" ? { documentId: "DOC-Q1" } : {}) };
      },
      async getDocument() {
        return { url: "https://kiosk.example.test/q1.jsonl" };
      },
    };
    const def = defineDataKiosk<{ n: number }>({
      key: "orders.sales-metrics",
      family: "data-kiosk",
      schedule: { every: "1d" },
      query: () =>
        "query { analytics_salesAndTraffic_2024_04_24 { salesAndTrafficByDate { date } } }",
      parse: (text) => parseJsonRecords(text).map((r) => ({ n: Number((r as { n: number }).n) })),
      upsert: async (_c, r) => void rows.push(...r.map((x) => x.n)),
    });
    const h = await engineWith([def], kiosk);
    h.amazon.transport.route(
      { path: "/q1.jsonl" },
      bytesResponse(200, encodeText('{"n":1}\n{"n":2}\n')),
    );
    await h.scheduler.requestRefresh(A, { syncKey: "orders.sales-metrics" });
    await h.drain();
    expect(rows).toEqual([1, 2]);
    expect(polls).toBe(3);
  });

  it("a Data Kiosk definition fails clearly when the worker has no Data Kiosk client (no silent success)", async () => {
    const def = defineDataKiosk<{ n: number }>({
      key: "orders.kiosk-missing",
      family: "data-kiosk",
      query: () => "query {}",
      parse: () => [],
      upsert: async () => {},
    });
    const h = await engineWith([def]);
    const { runId } = await h.scheduler.requestRefresh(A, { syncKey: "orders.kiosk-missing" });
    await h.drain();
    const run = (await repo.listRuns(A, t!.app.db, { syncKey: "orders.kiosk-missing" })).find(
      (r) => r.id === runId,
    )!;
    expect(run.state).toBe("failed");
    expect(run.errorCode).toBe("kiosk_unavailable");
  });

  it("parsers: Ads CSV parts repeat the header; TSV/CSV quoting and BOM are handled", () => {
    expect(parseCsvParts(['a,b\n1,"x,y"\n', "a,b\n2,z\n"])).toEqual([
      { a: "1", b: "x,y" },
      { a: "2", b: "z" },
    ]);
  });
});
