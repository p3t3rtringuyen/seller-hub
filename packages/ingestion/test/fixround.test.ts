import { gzipSync } from "node:zlib";
import { encodeText } from "@seller-hub/amazon-core";
import { bytesResponse, jsonResponse, type MockTransport } from "@seller-hub/amazon-core/testing";
import { addDays, todayIn, type SellerScope } from "@seller-hub/core";
import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staticSellerDirectory } from "../src/directory";
import { parseJsonRecords, parseTsv } from "../src/parsers";
import * as repo from "../src/repository";
import { createRunRequester } from "../src/requester";
import { createTestEngine, InlineQueue } from "../src/testing";
import {
  defineAdsExport,
  defineAdsReport,
  defineDataKiosk,
  definePagedPull,
  defineSpReport,
  type DataKioskPort,
  type IngestDefinition,
  type SyncTarget,
} from "../src/types";

// Fix round 1 of the P5 review: B1 (one step chain per run), M1 (idempotent landing), M2 (no stored pre-signed url),
// M4 (connection status), M5 (no data is not a failure), M6 (enqueue-only requester).

const t = await tryCreateTestDb();
const A: SellerScope = { tenantId: FIXTURE.tenantId, sellerAccountId: FIXTURE.sellerAccountId };
const PROFILE = "1234567890";
beforeAll(async () => {
  if (t) await seedFixtures(t);
});
afterAll(async () => {
  await t?.drop();
});

const target = (extra: Partial<SyncTarget> = {}): SyncTarget => ({
  tenantId: A.tenantId,
  sellerAccountId: A.sellerAccountId as string,
  accountType: "seller",
  region: "na",
  marketplaceIds: ["ATVPDKIKX0DER"],
  adsProfiles: [{ profileId: PROFILE, marketplaceId: "ATVPDKIKX0DER", accountType: "seller" }],
  paused: {},
  ...extra,
});

async function engineWith(
  defs: IngestDefinition[],
  opts: { kiosk?: DataKioskPort; now?: () => Date; targets?: SyncTarget[] } = {},
) {
  const h = createTestEngine({
    app: t!.app.db,
    owner: t!.owner.db,
    definitions: defs,
    targets: opts.targets ?? [target()],
    ...(opts.kiosk ? { kiosk: opts.kiosk } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  await h.scheduler.ensureStates();
  return h;
}

const spDef = (key: string, rows: unknown[] = []) =>
  defineSpReport<Record<string, string>>({
    key,
    family: "spapi-report",
    scopeKind: "marketplace",
    schedule: { every: "6h" },
    description: "fix round demo",
    report: (ctx) => ({
      reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
      marketplaceIds: [ctx.scopeKey],
    }),
    parse: (text) => parseTsv(text),
    upsert: async (_c, r) => void rows.push(...r),
  });

function routeReport(tr: MockTransport, statuses: Record<string, unknown>[], tsv = "a\tb\n1\t2\n") {
  tr.route(
    { method: "POST", path: "/reports/2021-06-30/reports" },
    jsonResponse(202, { reportId: "R-1" }),
  );
  tr.route(
    { method: "GET", path: "/reports/2021-06-30/reports/R-1" },
    ...statuses.map((s) => jsonResponse(200, { reportId: "R-1", ...s })),
  );
  tr.route(
    { method: "GET", path: "/reports/2021-06-30/documents/D-1" },
    jsonResponse(200, {
      reportDocumentId: "D-1",
      url: "https://s3.example.test/doc/D-1",
      compressionAlgorithm: "GZIP",
    }),
  );
  tr.route({ method: "GET", path: "/doc/D-1" }, bytesResponse(200, gzipSync(encodeText(tsv))));
}

describe.skipIf(!t)("P3-INGEST fix round 1", () => {
  describe("B1: one step chain per run", () => {
    it("two concurrent steps of the same run create ONE Amazon report; the second chain is dropped", async () => {
      const h = await engineWith([spDef("b1.concurrent")]);
      routeReport(h.amazon.transport, [{ processingStatus: "DONE", reportDocumentId: "D-1" }]);
      await h.scheduler.requestRefresh(A, { syncKey: "b1.concurrent", scopeKey: "ATVPDKIKX0DER" });
      const job = h.queue.pending.shift()!;
      const [r1, r2] = await Promise.all([
        h.engine.processRun(job.payload),
        h.engine.processRun(job.payload),
      ]);
      expect([r1.state, r2.state]).toContain("duplicate");
      expect(
        h.amazon.transport.callsTo({ method: "POST", path: "/reports/2021-06-30/reports" }),
      ).toHaveLength(1);
    });

    it("a 25-minute wait with a tick every minute stays ONE chain (heartbeat, no false stale detection)", async () => {
      let clock = Date.now();
      const h = await engineWith([spDef("b1.longpoll")], { now: () => new Date(clock) });
      h.engine.config.polling.spPollMs = 25 * 60_000; // each poll hands the run back for 25 minutes
      routeReport(h.amazon.transport, [
        { processingStatus: "IN_PROGRESS" },
        { processingStatus: "DONE", reportDocumentId: "D-1" },
      ]);
      const { runId } = await h.scheduler.requestRefresh(A, {
        syncKey: "b1.longpoll",
        scopeKey: "ATVPDKIKX0DER",
      });
      const chainOf = () => h.queue.history.filter((q) => q.payload.runId === runId).length;
      const first = h.queue.pending.shift()!;
      await h.engine.processRun(first.payload); // creates the report
      await h.engine.processRun({ ...first.payload, step: 1 }); // first poll: not ready, waits 25 min
      const before = chainOf();
      for (let minute = 1; minute <= 24; minute++) {
        clock += 60_000;
        await h.scheduler.tick();
        expect(chainOf(), `tick at +${minute} min`).toBe(before);
      }

      // a chain that really died (its next step is 10 min overdue) IS picked up
      clock += 40 * 60_000;
      await h.scheduler.tick();
      expect(chainOf()).toBe(before + 1);
    });

    it("pressing Refresh twice on an open run starts one chain, not two", async () => {
      const h = await engineWith([spDef("b1.double")]);
      routeReport(h.amazon.transport, [{ processingStatus: "DONE", reportDocumentId: "D-1" }]);
      const a = await h.scheduler.requestRefresh(A, {
        syncKey: "b1.double",
        scopeKey: "ATVPDKIKX0DER",
      });
      const b = await h.scheduler.requestRefresh(A, {
        syncKey: "b1.double",
        scopeKey: "ATVPDKIKX0DER",
      });
      expect(b.runId).toBe(a.runId);
      expect(b.created).toBe(false);
      // the second press re-adds the not-yet-started run at interactive priority (a twin job of step 0) ...
      expect(new Set(h.queue.history.map((q) => q.payload.runId)).size).toBe(1);
      // ... and the step guard makes the pair one chain: only one of them creates the report
      routeReport(h.amazon.transport, [{ processingStatus: "DONE", reportDocumentId: "D-1" }]);
      await h.drain();
      expect(
        h.amazon.transport.callsTo({ method: "POST", path: "/reports/2021-06-30/reports" }),
      ).toHaveLength(1);
    });
  });

  describe("M1: raw landing is idempotent", () => {
    it("a failed PUT of part 1 retries without duplicating part 0 in the index or the parse", async () => {
      const seen: string[] = [];
      const def = defineAdsReport<{ id: string }>({
        key: "ads.m1-two-parts",
        family: "ads-report",
        schedule: { every: "6h" },
        buildRequest: () => ({ reports: [] }),
        parse: (parts) =>
          parts.flatMap((p) =>
            parseJsonRecords(p).map((r) => ({ id: String((r as { id: string }).id) })),
          ),
        upsert: async (_c, rows) => void seen.push(...rows.map((r) => r.id)),
      });
      const h = await engineWith([def]);
      const tr = h.amazon.transport;
      tr.route(
        { method: "POST", path: "/adsApi/v1/create/reports" },
        jsonResponse(207, {
          success: [{ index: 0, report: { reportId: "RPT-1", status: "PENDING" } }],
          error: [],
        }),
      );
      tr.route(
        { method: "POST", path: "/adsApi/v1/retrieve/reports" },
        jsonResponse(207, {
          success: [
            {
              index: 0,
              report: {
                reportId: "RPT-1",
                status: "COMPLETED",
                format: "GZIP_JSON",
                completedReportParts: [
                  { url: "https://r.example.test/p0.gz" },
                  { url: "https://r.example.test/p1.gz" },
                ],
              },
            },
          ],
          error: [],
        }),
      );
      tr.route({ path: "/p0.gz" }, bytesResponse(200, gzipSync(encodeText('[{"id":"a"}]'))));
      tr.route({ path: "/p1.gz" }, bytesResponse(200, gzipSync(encodeText('[{"id":"b"}]'))));
      const realPut = h.store.put.bind(h.store);
      let puts = 0;
      h.store.put = async (key: string, body: Uint8Array) => {
        puts++;
        if (puts === 2) throw new Error("S3 503"); // part 1, first attempt
        return realPut(key, body);
      };
      const { runId } = await h.scheduler.requestRefresh(A, {
        syncKey: "ads.m1-two-parts",
        scopeKey: PROFILE,
      });
      await h.drain();
      const run = (await repo.listRuns(A, t!.app.db, { syncKey: "ads.m1-two-parts" })).find(
        (r) => r.id === runId,
      )!;
      expect(run.state).toBe("done");
      expect(run.attempts).toBe(0); // reset by the progress after the retry
      expect(seen).toEqual(["a", "b"]);
      expect((await repo.listRawObjects(A, t!.app.db, runId)).map((o) => o.part)).toEqual([0, 1]);
      expect(h.store.objects.size).toBe(2); // same keys on the retry: no stray copies
    });
  });

  describe("M2: the Ads export's pre-signed url is never stored", () => {
    it("downloads with a fresh url asked at download time, even after the first url expired", async () => {
      const got: string[] = [];
      const def = defineAdsExport<{ campaignId: string }>({
        key: "ads.m2-export",
        family: "ads-export",
        exportOperation: "CampaignExport",
        schedule: { every: "1d" },
        buildRequest: () => ({}),
        parse: (text) =>
          parseJsonRecords(text).map((r) => ({
            campaignId: String((r as { campaignId: string }).campaignId),
          })),
        upsert: async (_c, rows) => void got.push(...rows.map((r) => r.campaignId)),
      });
      const h = await engineWith([def]);
      const tr = h.amazon.transport;
      tr.route(
        { method: "POST", path: "/campaigns/export" },
        jsonResponse(202, { exportId: "E-9" }),
      );
      tr.route(
        { method: "GET", path: "/exports/E-9" },
        jsonResponse(200, {
          exportId: "E-9",
          status: "COMPLETED",
          url: "https://x.example.test/expired",
        }), // poll
        jsonResponse(200, {
          exportId: "E-9",
          status: "COMPLETED",
          url: "https://x.example.test/fresh",
        }), // download
      );
      tr.route({ path: "/expired" }, bytesResponse(403, encodeText("expired")));
      tr.route({ path: "/fresh" }, bytesResponse(200, encodeText('[{"campaignId":"c1"}]')));
      const { runId } = await h.scheduler.requestRefresh(A, {
        syncKey: "ads.m2-export",
        scopeKey: PROFILE,
      });
      await h.drain();
      expect(got).toEqual(["c1"]);
      expect(tr.callsTo({ path: "/expired" })).toHaveLength(0);
      const row = await sql<{ amazon_document_id: string; amazon_request_id: string }>`
        select amazon_document_id, amazon_request_id from ingest.job_runs where id = ${runId}`.execute(
        t!.owner.db,
      );
      expect(row.rows[0]).toEqual({ amazon_document_id: "E-9", amazon_request_id: "E-9" });
    });
  });

  describe("M4: connection status decides what is scheduled", () => {
    it("an Ads-only account gets no SP sync states, and a pending connection gets none for its API", async () => {
      const sp = spDef("m4.sp");
      const ads = defineAdsReport<{ id: string }>({
        key: "ads.m4-report",
        family: "ads-report",
        schedule: { every: "6h" },
        buildRequest: () => ({}),
        parse: () => [],
        upsert: async () => {},
      });
      const h = await engineWith([sp, ads], {
        targets: [target({ connected: { sp: false, ads: true } })],
      });
      const states = (await repo.listSyncStates(A, t!.app.db)).map((s) => s.syncKey);
      expect(states).toContain("ads.m4-report");
      expect(states).not.toContain("m4.sp");
      await expect(
        h.scheduler.requestRefresh(A, { syncKey: "m4.sp", scopeKey: "ATVPDKIKX0DER" }),
      ).rejects.toThrow(/does not apply/);
    });
  });

  describe("M5: no data is not a failure", () => {
    it("an SP report that Amazon cancels because it has no data is a successful empty run", async () => {
      const rows: unknown[] = [];
      const h = await engineWith([spDef("m5.cancelled", rows)]);
      routeReport(h.amazon.transport, [{ processingStatus: "CANCELLED" }]);
      const { runId } = await h.scheduler.requestRefresh(A, {
        syncKey: "m5.cancelled",
        scopeKey: "ATVPDKIKX0DER",
      });
      await h.drain();
      const run = (await repo.listRuns(A, t!.app.db, { syncKey: "m5.cancelled" })).find(
        (r) => r.id === runId,
      )!;
      expect(run.state).toBe("done");
      expect(run.rowsUpserted).toBe(0);
      expect(rows).toEqual([]);
      expect(
        h.amazon.transport.callsTo({ method: "POST", path: "/reports/2021-06-30/reports" }),
      ).toHaveLength(1);
      expect(
        (await repo.findSyncState(A, t!.app.db, "m5.cancelled", "ATVPDKIKX0DER"))?.status,
      ).toBe("idle");
    });

    it("FATAL is still a failure", async () => {
      const h = await engineWith([spDef("m5.fatal")]);
      routeReport(h.amazon.transport, [{ processingStatus: "FATAL" }]);
      const { runId } = await h.scheduler.requestRefresh(A, {
        syncKey: "m5.fatal",
        scopeKey: "ATVPDKIKX0DER",
      });
      await h.drain();
      expect(
        (await repo.listRuns(A, t!.app.db, { syncKey: "m5.fatal" })).find((r) => r.id === runId)
          ?.state,
      ).toBe("failed");
    });

    it("a Data Kiosk query that is DONE without a document is an empty successful run", async () => {
      const kiosk: DataKioskPort = {
        createQuery: async () => ({ queryId: "Q" }),
        getQuery: async () => ({ status: "DONE" }),
        getDocument: async () => ({ url: "https://never" }),
      };
      const def = defineDataKiosk<{ n: number }>({
        key: "m5.kiosk",
        family: "data-kiosk",
        schedule: { every: "1d" },
        query: () => "query {}",
        parse: () => [],
        upsert: async () => {},
      });
      const h = await engineWith([def], { kiosk });
      const { runId } = await h.scheduler.requestRefresh(A, { syncKey: "m5.kiosk" });
      await h.drain();
      const run = (await repo.listRuns(A, t!.app.db, { syncKey: "m5.kiosk" })).find(
        (r) => r.id === runId,
      )!;
      expect(run.state).toBe("done");
      expect(run.rowsUpserted).toBe(0);
    });
  });

  describe("M6: enqueue-only requester", () => {
    it("requests and backfills with no Amazon client, no object store and no registry, and reads sync health", async () => {
      const def = definePagedPull<{ id: string }>({
        key: "m6.sync",
        family: "paged-pull",
        description: "M6 sync",
        schedule: { every: "6h" },
        window: { lookbackDays: 2, backfillDays: 100, maxRangeDays: 10 },
        fetchPage: async () => ({ rows: [] }),
        upsert: async () => {},
      });
      const queue = new InlineQueue();
      const requester = createRunRequester({
        db: t!.app.db,
        directory: staticSellerDirectory([target()]),
        definitions: [def as IngestDefinition],
        enqueuer: queue,
      });
      const r1 = await requester.requestRefresh(A, { syncKey: "m6.sync" });
      const r2 = await requester.requestRefresh(A, { syncKey: "m6.sync" });
      expect([r1.created, r2.created]).toEqual([true, false]);
      expect(queue.history.map((q) => q.priority)).toEqual(["interactive", "interactive"]); // run + twin
      expect(new Set(queue.history.map((q) => q.payload.runId)).size).toBe(1);
      const res = await requester.backfill(A, {
        syncKey: "m6.sync",
        fromDate: addDays(todayIn("UTC"), -25),
        toDate: addDays(todayIn("UTC"), -1),
      });
      expect(res.windows).toBe(3);
      expect(queue.history.filter((q) => q.priority === "backfill")).toHaveLength(3);
      const health = await requester.getSyncHealth(A);
      const item = health.items.find((i) => i.syncKey === "m6.sync");
      expect(item?.description).toBe("M6 sync");
      expect(item?.family).toBe("paged-pull");
    });
  });

  describe("minors", () => {
    it("a cancelled run leaves no scratch behind", async () => {
      const def = definePagedPull<{ id: string }>({
        key: "min.cancel",
        family: "paged-pull",
        schedule: { every: "6h" },
        fetchPage: async () => ({ rows: [] }),
        upsert: async () => {},
      });
      const h = await engineWith([def]);
      const { runId } = await h.scheduler.requestRefresh(A, { syncKey: "min.cancel" });
      const hGone = createTestEngine({
        app: t!.app.db,
        owner: t!.owner.db,
        definitions: [def],
        targets: [target({ connected: { sp: false } })],
      });
      const job = h.queue.pending.shift()!;
      expect((await hGone.engine.processRun(job.payload)).state).toBe("cancelled");
      const state = await repo.findSyncState(A, t!.app.db, "min.cancel", "");
      expect(Object.keys((state?.cursor.runs ?? {}) as object)).not.toContain(runId);
    });

    it("a crash after the last page's commit does not re-pull from page 1", async () => {
      const calls: (string | undefined)[] = [];
      const def = definePagedPull<{ id: string }>({
        key: "min.complete",
        family: "paged-pull",
        schedule: { every: "6h" },
        fetchPage: async (_c, token) => {
          calls.push(token);
          return { rows: [{ id: "x" }] };
        },
        upsert: async () => {},
      });
      const h = await engineWith([def]);
      const { runId } = await h.scheduler.requestRefresh(A, { syncKey: "min.complete" });
      const state = await repo.findSyncState(A, t!.app.db, "min.complete", "");
      // simulate: the last page was committed (complete), then the worker died before finish()
      await repo.scoped(A, t!.app.db, (trx) =>
        repo.writeScratch(trx, state!.id, runId, {
          nextToken: null,
          complete: true,
          rows: 1,
          pages: 1,
        }),
      );
      await h.drain();
      expect(calls).toEqual([]); // nothing was fetched again
      expect((await repo.listRuns(A, t!.app.db, { syncKey: "min.complete" }))[0]?.state).toBe(
        "done",
      );
    });
  });
});

describe.skipIf(!t)("fix round 2: R1 and the new minors", () => {
  it("R1: a backlog of never-started runs and a tick per minute leaves ONE queued job per run", async () => {
    let clock = Date.now();
    const calls: string[] = [];
    const def = definePagedPull<{ id: string }>({
      key: "r1.backlog",
      family: "paged-pull",
      window: { lookbackDays: 1, backfillDays: 60, maxRangeDays: 1 },
      fetchPage: async (ctx) => {
        if (ctx.priority === "backfill") calls.push(ctx.runId);
        return { rows: [] };
      },
      upsert: async () => {},
    });
    const h = await engineWith([def], { now: () => new Date(clock) });
    const to = todayIn("UTC");
    const res = await h.scheduler.backfill(A, {
      syncKey: "r1.backlog",
      fromDate: addDays(to, -29),
      toDate: to,
    });
    expect(res.windows).toBe(30);
    const mine = new Set(
      (await repo.listRuns(A, t!.app.db, { syncKey: "r1.backlog", limit: 200 }))
        .filter((r) => r.priority === "backfill")
        .map((r) => r.id),
    );
    expect(mine.size).toBe(30);
    expect(h.queue.pending).toHaveLength(30);
    // the queue is slow: nothing is drained for 30 simulated minutes, a tick every minute
    for (let minute = 1; minute <= 30; minute++) {
      clock += 60_000;
      await h.scheduler.tick();
    }
    const perRun = new Map<string, number>();
    for (const q of h.queue.pending.filter((x) => mine.has(x.payload.runId)))
      perRun.set(q.payload.runId, (perRun.get(q.payload.runId) ?? 0) + 1);
    expect(perRun.size).toBe(30);
    expect(Math.max(...perRun.values())).toBe(1);
    expect(h.queue.history.filter((q) => mine.has(q.payload.runId))).toHaveLength(30); // the sweep never added a second job
    // draining runs each run once, in one sequence
    await h.drain();
    expect(calls).toHaveLength(30);
    expect(new Set(calls).size).toBe(30);
  });

  it("R1: a job of an older step is dropped once the run expects a later one", async () => {
    const def = defineSpReport<Record<string, string>>({
      key: "r1.stepguard",
      family: "spapi-report",
      scopeKind: "marketplace",
      schedule: { every: "6h" },
      report: (ctx) => ({
        reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
        marketplaceIds: [ctx.scopeKey],
      }),
      parse: (text) => parseTsv(text),
      upsert: async () => {},
    });
    const h = await engineWith([def]);
    routeReport(h.amazon.transport, [{ processingStatus: "DONE", reportDocumentId: "D-1" }]);
    await h.scheduler.requestRefresh(A, { syncKey: "r1.stepguard", scopeKey: "ATVPDKIKX0DER" });
    const job = h.queue.pending.shift()!;
    expect((await h.engine.processRun(job.payload)).done).toBe(false); // step 0 creates the report
    // a leftover job of step 0 (a re-enqueued twin) arrives after the chain moved on to step 1
    expect((await h.engine.processRun(job.payload)).state).toBe("duplicate");
    expect(
      h.amazon.transport.callsTo({ method: "POST", path: "/reports/2021-06-30/reports" }),
    ).toHaveLength(1);
    expect((await h.engine.processRun({ ...job.payload, step: 1 })).state).not.toBe("duplicate");
  });

  it("N2: a refresh joins a run that has not started, but starts a new run when the open one is already past its fetch", async () => {
    const def = definePagedPull<{ id: string }>({
      key: "n2.refresh",
      family: "paged-pull",
      schedule: { every: "6h" },
      window: { lookbackDays: 1, maxRangeDays: 5 },
      fetchPage: async () => ({ rows: [] }),
      upsert: async () => {},
    });
    const h = await engineWith([def]);
    const a = await h.scheduler.requestRefresh(A, { syncKey: "n2.refresh" });
    const joined = await h.scheduler.requestRefresh(A, { syncKey: "n2.refresh" });
    expect(joined).toEqual({ runId: a.runId, created: false });
    expect(h.queue.history.map((q) => q.priority)).toEqual(["interactive", "interactive"]);
    await sql`update ingest.job_runs set state = 'upserting', started_at = now() where id = ${a.runId}`.execute(
      t!.owner.db,
    );
    const later = await h.scheduler.requestRefresh(A, { syncKey: "n2.refresh" });
    expect(later.created).toBe(true);
    expect(later.runId).not.toBe(a.runId);
  });
});
