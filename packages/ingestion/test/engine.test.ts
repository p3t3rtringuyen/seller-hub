import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { bytesResponse, jsonResponse, type MockTransport } from "@seller-hub/amazon-core/testing";
import { AmazonValidationError, ConnectionNeedsReauth, encodeText } from "@seller-hub/amazon-core";
import { createLogger, MissingScopeError, type SellerScope } from "@seller-hub/core";
import { withScope } from "@seller-hub/db";
import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import merchantListings from "../src/demo/merchant-listings.sync";
import { getSyncHealth } from "../src/health";
import { pollPushQueue, processInbox, type SqsLike, type SqsMessage } from "../src/inbox";
import * as repo from "../src/repository";
import { createTestEngine } from "../src/testing";
import {
  definePagedPull,
  definePush,
  type IngestDefinition,
  type PagedPullDefinition,
  type SyncTarget,
} from "../src/types";

const t = await tryCreateTestDb();
const MARKETPLACE = "ATVPDKIKX0DER";
const A: SellerScope = { tenantId: FIXTURE.tenantId, sellerAccountId: FIXTURE.sellerAccountId };
const B: SellerScope = {
  tenantId: FIXTURE.otherTenantId,
  sellerAccountId: FIXTURE.otherSellerAccountId,
};
const target = (s: SellerScope, extra: Partial<SyncTarget> = {}): SyncTarget => ({
  tenantId: s.tenantId,
  sellerAccountId: s.sellerAccountId as string,
  accountType: "seller",
  region: "na",
  marketplaceIds: [MARKETPLACE],
  adsProfiles: [{ profileId: "1234567890", marketplaceId: MARKETPLACE, accountType: "seller" }],
  paused: {},
  ...extra,
});
const log = createLogger({ name: "t", level: "silent" });

function mockListingsReport(
  transport: MockTransport,
  tsv: string,
  opts: { createResponses?: Parameters<MockTransport["route"]>[1][] } = {},
): void {
  transport.route(
    { method: "POST", path: "/reports/2021-06-30/reports" },
    ...((opts.createResponses as never[] | undefined) ?? [jsonResponse(202, { reportId: "R-1" })]),
  );
  transport.route(
    { method: "GET", path: "/reports/2021-06-30/reports/R-1" },
    jsonResponse(200, { reportId: "R-1", processingStatus: "IN_PROGRESS" }),
    jsonResponse(200, { reportId: "R-1", processingStatus: "DONE", reportDocumentId: "D-1" }),
  );
  transport.route(
    { method: "GET", path: "/reports/2021-06-30/documents/D-1" },
    jsonResponse(200, {
      reportDocumentId: "D-1",
      url: "https://s3.example.test/doc/D-1",
      compressionAlgorithm: "GZIP",
    }),
  );
  transport.route(
    { method: "GET", path: "/doc/D-1" },
    bytesResponse(200, gzipSync(encodeText(tsv))),
  );
}

const fixtureTsv = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

async function makeEngine(
  definitions: readonly IngestDefinition[],
  targets: SyncTarget[] = [target(A), target(B)],
  config?: Parameters<typeof createTestEngine>[0]["config"],
) {
  const h = createTestEngine({
    app: t!.app.db,
    owner: t!.owner.db,
    definitions,
    targets,
    ...(config ? { config } : {}),
  });
  await h.scheduler.ensureStates();
  return h;
}

const countListings = async (s: SellerScope): Promise<number> =>
  withScope(t!.app.db, s, async (trx) => {
    const r = await sql<{ n: string }>`select count(*) as n from catalog.listings`.execute(trx);
    return Number(r.rows[0]?.n);
  });

describe.skipIf(!t)("ingestion engine (real Postgres)", () => {
  beforeAll(async () => {
    await seedFixtures(t!);
  });
  afterAll(async () => {
    await t?.drop();
  });

  describe("demo definition: merchant listings report, end to end from fixtures", () => {
    it("creates, polls, downloads, gunzips, lands raw, parses and upserts into catalog.listings", async () => {
      const h = await makeEngine([merchantListings]);
      mockListingsReport(h.amazon.transport, fixtureTsv("merchant-listings.tsv"));

      const { runId } = await h.scheduler.requestRefresh(A, {
        syncKey: "listings.merchant-listings",
        scopeKey: MARKETPLACE,
      });
      const { delays } = await h.drain();

      const runs = await repo.listRuns(A, t!.app.db, { syncKey: "listings.merchant-listings" });
      const run = runs.find((r) => r.id === runId)!;
      expect(run.state).toBe("done");
      expect(run.rowsUpserted).toBe(3);
      expect(run.amazonRequestId).toBe("R-1");
      expect(run.amazonDocumentId).toBe("D-1");
      expect(run.priority).toBe("interactive");
      expect(delays.length).toBeGreaterThanOrEqual(2); // polled: not ready, then ready
      expect(await countListings(A)).toBe(3);
      expect(await countListings(B)).toBe(0);

      // raw landing: the document is in object storage and indexed, with its sha256 and expiry
      const raw = await repo.listRawObjects(A, t!.app.db, runId);
      expect(raw).toHaveLength(1);
      expect(raw[0]?.objectKey).toMatch(
        new RegExp(
          `^raw/${FIXTURE.tenantId}/${FIXTURE.sellerAccountId}/listings.merchant-listings/\\d{4}/\\d{2}/\\d{2}/${runId}/0$`,
        ),
      );
      expect(new TextDecoder().decode(h.store.objects.get(raw[0]!.objectKey))).toContain(
        "WIDGET-BLUE",
      );

      // the sync state carries the last-run marker and is scheduled again
      const state = await repo.findSyncState(
        A,
        t!.app.db,
        "listings.merchant-listings",
        MARKETPLACE,
      );
      expect(state?.status).toBe("idle");
      expect(state?.lastSuccessAt).toBeTruthy();
      expect(state?.cursor.lastUpdatedAfter).toBeTruthy();
      expect(state?.cursor.runs).toEqual({}); // scratch dropped
      expect(state?.nextRunAt && state.nextRunAt > new Date()).toBe(true);

      // a second run converges on the same rows (upsert by natural key)
      const h2 = await makeEngine([merchantListings]);
      mockListingsReport(h2.amazon.transport, fixtureTsv("merchant-listings.tsv"));
      await h2.scheduler.requestRefresh(A, {
        syncKey: "listings.merchant-listings",
        scopeKey: MARKETPLACE,
      });
      await h2.drain();
      expect(await countListings(A)).toBe(3);
    });

    it("an empty report is a successful run with zero rows", async () => {
      await withScope(t!.app.db, A, (trx) => sql`delete from catalog.listings`.execute(trx));
      const h = await makeEngine([merchantListings]);
      mockListingsReport(h.amazon.transport, fixtureTsv("merchant-listings-empty.tsv"));
      const { runId } = await h.scheduler.requestRefresh(A, {
        syncKey: "listings.merchant-listings",
        scopeKey: MARKETPLACE,
      });
      await h.drain();
      const run = (await repo.listRuns(A, t!.app.db)).find((r) => r.id === runId)!;
      expect(run.state).toBe("done");
      expect(run.rowsUpserted).toBe(0);
      expect(await countListings(A)).toBe(0);
    });

    it("retries after a 429: the throttle delays the run, it does not fail it", async () => {
      const h = await makeEngine([merchantListings]);
      mockListingsReport(h.amazon.transport, fixtureTsv("merchant-listings.tsv"), {
        // Retry-After beyond the client's cap -> AmazonThrottledError reaches the engine at once; then success.
        createResponses: [
          jsonResponse(429, { errors: [{ code: "QuotaExceeded" }] }, { "retry-after": "600" }),
          jsonResponse(202, { reportId: "R-1" }),
        ],
      });
      const { runId } = await h.scheduler.requestRefresh(A, {
        syncKey: "listings.merchant-listings",
        scopeKey: MARKETPLACE,
      });
      const { delays } = await h.drain();
      expect(delays[0]).toBeGreaterThanOrEqual(600_000); // honoured Retry-After
      const run = (await repo.listRuns(A, t!.app.db)).find((r) => r.id === runId)!;
      expect(run.state).toBe("done");
      expect(run.attempts).toBe(0); // a throttle is not an attempt
      const state = await repo.findSyncState(
        A,
        t!.app.db,
        "listings.merchant-listings",
        MARKETPLACE,
      );
      expect((state?.cursor.lastRun as { throttles: number }).throttles).toBe(1);
      expect(state?.consecutiveFailures).toBe(0);
      expect(
        h.amazon.transport.callsTo({ method: "POST", path: "/reports/2021-06-30/reports" }),
      ).toHaveLength(2);
    });
  });

  describe("paged pull: cursors, crash recovery, partial failure", () => {
    function pagedDef(opts: {
      failOn?: number;
      failWith?: () => Error;
      calls: (string | undefined)[];
      upserted: string[];
    }) {
      const pages = [
        { rows: [{ id: "a" }, { id: "b" }], nextToken: "p2" },
        { rows: [{ id: "c" }], nextToken: "p3" },
        { rows: [{ id: "d" }] },
      ];
      let failed = false;
      return definePagedPull<{ id: string }>({
        key: "test.paged",
        family: "paged-pull",
        schedule: { every: "5m" },
        cursorOverlapMinutes: 15,
        async fetchPage(_ctx, token) {
          opts.calls.push(token);
          const idx = token ? Number(token.slice(1)) - 1 : 0;
          if (idx === opts.failOn && !failed) {
            failed = true;
            throw (opts.failWith ?? (() => new Error("boom")))();
          }
          return pages[idx] as (typeof pages)[number];
        },
        async upsert(_ctx, rows) {
          opts.upserted.push(...rows.map((r) => r.id));
        },
      }) satisfies PagedPullDefinition<{ id: string }>;
    }

    it("resumes from the stored page token after a crash instead of starting over", async () => {
      const calls: (string | undefined)[] = [];
      const upserted: string[] = [];
      const def = pagedDef({ failOn: 2, calls, upserted });
      const h = await makeEngine([def]);
      const { runId } = await h.scheduler.requestRefresh(A, { syncKey: "test.paged" });

      // first worker: page 1 and 2 committed, then the process "dies" on page 3 (the step throws)
      const first = h.queue.pending.shift()!;
      const r1 = await h.engine.processRun(first.payload);
      expect(r1.done).toBe(false); // retry scheduled with backoff
      const mid = await repo.findSyncState(A, t!.app.db, "test.paged", "");
      expect((mid?.cursor.runs as Record<string, { nextToken: string }>)[runId]?.nextToken).toBe(
        "p3",
      );
      expect(upserted).toEqual(["a", "b", "c"]);

      // a brand-new engine (new process) picks the run up again
      const h2 = await makeEngine([def]);
      await h2.engine.processRun(first.payload);
      expect(calls).toEqual([undefined, "p2", "p3", "p3"]); // pages 1-2 were not fetched again
      expect(upserted).toEqual(["a", "b", "c", "d"]);
      const run = (await repo.listRuns(A, t!.app.db)).find((r) => r.id === runId)!;
      expect(run.state).toBe("done");
      expect(run.rowsUpserted).toBe(4);
      expect(run.attempts).toBe(1);
      const state = await repo.findSyncState(A, t!.app.db, "test.paged", "");
      expect(state?.cursor.runs).toEqual({});
      // last-sync marker with overlap: the next run asks for changes since (start - 15 min), not everything
      const marker = new Date(state?.cursor.lastUpdatedAfter as string);
      expect(Date.now() - marker.getTime()).toBeGreaterThan(14 * 60_000);
      expect(Date.now() - marker.getTime()).toBeLessThan(20 * 60_000);
    });

    it("partial failure: committed pages stay, the run fails, the sync turns 'failing'", async () => {
      const calls: (string | undefined)[] = [];
      const upserted: string[] = [];
      const def = pagedDef({
        failOn: 1,
        calls,
        upserted,
        failWith: () =>
          new AmazonValidationError("bad request", { status: 400 }, "InvalidInput", {}),
      });
      const h = await makeEngine([def]);
      const { runId } = await h.scheduler.requestRefresh(A, { syncKey: "test.paged" });
      await h.drain();
      expect(upserted).toEqual(["a", "b"]);
      const run = (await repo.listRuns(A, t!.app.db)).find((r) => r.id === runId)!;
      expect(run.state).toBe("failed");
      expect(run.errorCode).toBe("AmazonValidationError");
      expect(run.errorDetail).toContain("bad request");
      const state = await repo.findSyncState(A, t!.app.db, "test.paged", "");
      expect(state?.status).toBe("failing");
      expect(state?.consecutiveFailures).toBe(1);
      expect(state?.lastFailureAt).toBeTruthy();
      const health = await getSyncHealth(A, t!.app.db, [def]);
      expect(health.items.find((i) => i.syncKey === "test.paged")?.freshness).toBe("failing");
    });

    it("a connection that needs reauth pauses every sync of that API and fails the run without retry", async () => {
      const def = definePagedPull<{ id: string }>({
        key: "test.reauth",
        family: "paged-pull",
        schedule: { every: "5m" },
        async fetchPage() {
          throw new ConnectionNeedsReauth({
            tenantId: A.tenantId,
            sellerAccountId: A.sellerAccountId as string,
            api: "sp",
            region: "na",
          });
        },
        async upsert() {},
      });
      const h = await makeEngine([def]);
      const { runId } = await h.scheduler.requestRefresh(A, { syncKey: "test.reauth" });
      await h.drain();
      const run = (await repo.listRuns(A, t!.app.db)).find((r) => r.id === runId)!;
      expect(run.state).toBe("failed");
      expect(run.errorCode).toBe("needs_reauth");
      const state = await repo.findSyncState(A, t!.app.db, "test.reauth", "");
      expect(state?.status).toBe("paused");
      expect(state?.pausedReason).toBe("needs_reauth");
    });
  });

  describe("scheduler", () => {
    it("claims due sync states once, creates one run each and does not double-enqueue on the next tick", async () => {
      const calls: (string | undefined)[] = [];
      const def = definePagedPull<{ id: string }>({
        key: "test.tick",
        family: "paged-pull",
        schedule: { every: "5m", jitter: "2m" },
        async fetchPage(_c, token) {
          calls.push(token);
          return { rows: [] };
        },
        async upsert() {},
      });
      const h = await makeEngine([def]);
      // jitter: rows were created staggered into the future, not due immediately
      const before = await repo.listSyncStates(A, t!.app.db);
      const mine = before.find((s) => s.syncKey === "test.tick")!;
      expect(mine.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      await sql`update ingest.sync_states set next_run_at = now() - interval '1 minute' where sync_key = 'test.tick'`.execute(
        t!.owner.db,
      );

      const first = await h.scheduler.tick();
      expect(first.leader).toBe(true);
      expect(first.enqueued).toBe(2); // one per fixture account (A and B)
      const second = await h.scheduler.tick();
      expect(second.enqueued).toBe(0); // leased: not due again
      await h.drain();
      expect(calls).toHaveLength(2);
      const after = await repo.findSyncState(A, t!.app.db, "test.tick", "");
      expect(after?.status).toBe("idle");
      expect(after?.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    });

    it("skips and pauses a connection that needs reauth; resumes it when the directory says it is healthy", async () => {
      const def = definePagedPull<{ id: string }>({
        key: "test.pause",
        family: "paged-pull",
        schedule: { every: "5m" },
        async fetchPage() {
          return { rows: [] };
        },
        async upsert() {},
      });
      await makeEngine([def], [target(A)]); // creates the sync state while the connection is healthy
      const s1 = await repo.findSyncState(A, t!.app.db, "test.pause", "");
      expect(s1?.status).toBe("idle");
      const paused = await makeEngine([def], [target(A, { paused: { sp: "needs_reauth" } })]);
      const s2 = await repo.findSyncState(A, t!.app.db, "test.pause", "");
      expect(s2?.status).toBe("paused");
      expect(s2?.pausedReason).toBe("needs_reauth");
      await sql`update ingest.sync_states set next_run_at = now() - interval '1 minute' where sync_key = 'test.pause'`.execute(
        t!.owner.db,
      );
      expect((await paused.scheduler.tick()).enqueued).toBe(0);

      const healthy = await makeEngine([def], [target(A)]);
      await healthy.scheduler.ensureStates();
      const s3 = await repo.findSyncState(A, t!.app.db, "test.pause", "");
      expect(s3?.status).toBe("idle");
      expect(s3?.pausedReason).toBeNull();
    });

    it("limits concurrent runs per seller account (the second waits with a delay, it does not fail)", async () => {
      const def = definePagedPull<{ id: string }>({
        key: "test.conc",
        family: "paged-pull",
        concurrency: 1,
        async fetchPage() {
          return { rows: [] };
        },
        async upsert() {},
      });
      const h = await makeEngine([def]);
      const lease = await h.amazon.runtime.gate.tryAcquire(
        `ingest:seller:${A.sellerAccountId}:paged-pull`,
        1,
        60_000,
      );
      expect(lease).not.toBeNull();
      const { runId } = await h.scheduler.requestRefresh(A, { syncKey: "test.conc" });
      const job = h.queue.pending.shift()!;
      const res = await h.engine.processRun(job.payload);
      expect(res.done).toBe(false);
      expect(res.delayMs).toBeGreaterThan(0);
      await lease!.release();
      const res2 = await h.engine.processRun(job.payload);
      expect(res2.done).toBe(true);
      expect((await repo.listRuns(A, t!.app.db)).find((r) => r.id === runId)?.state).toBe("done");
    });

    it("backfill splits the range into windows, newest first, at backfill priority", async () => {
      const def = definePagedPull<{ id: string }>({
        key: "test.backfill",
        family: "paged-pull",
        window: { lookbackDays: 3, backfillDays: 730, maxRangeDays: 31 },
        async fetchPage() {
          return { rows: [] };
        },
        async upsert() {},
      });
      const h = await makeEngine([def]);
      const to = new Date();
      const from = new Date(to.getTime() - 70 * 86_400_000);
      const res = await h.scheduler.backfill(A, { syncKey: "test.backfill", from, to });
      expect(res.windows).toBe(3);
      const runs = (await repo.listRuns(A, t!.app.db, { syncKey: "test.backfill" })).sort(
        (a, b) => (b.windowEnd as Date).getTime() - (a.windowEnd as Date).getTime(),
      );
      expect(runs.map((r) => r.priority)).toEqual(["backfill", "backfill", "backfill"]);
      expect(runs[0]?.windowEnd?.getTime()).toBe(to.getTime());
      // idempotent: asking again reuses the open runs
      const again = await h.scheduler.backfill(A, { syncKey: "test.backfill", from, to });
      expect(again.windows).toBe(3);
      expect(await repo.listRuns(A, t!.app.db, { syncKey: "test.backfill" })).toHaveLength(3);
      await h.drain();
      // a backfill never moves the live cursor
      const state = await repo.findSyncState(A, t!.app.db, "test.backfill", "");
      expect(state?.cursor.lastUpdatedAfter).toBeUndefined();
      await expect(
        h.scheduler.backfill(A, {
          syncKey: "test.backfill",
          from: new Date(to.getTime() - 900 * 86_400_000),
          to,
        }),
      ).rejects.toThrow(/too early/);
    });

    it("refresh after write: only the touched entities are fetched, at interactive priority (D62 a)", async () => {
      const fetched: string[][] = [];
      const upserted: string[] = [];
      const def = definePagedPull<{ id: string }>({
        key: "test.refresh",
        family: "paged-pull",
        schedule: { every: "6h" },
        async fetchPage() {
          throw new Error("the whole sync must not run for an entity refresh");
        },
        async refreshEntities(_ctx, ids) {
          fetched.push([...ids]);
          return ids.map((id) => ({ id }));
        },
        async upsert(_c, rows) {
          upserted.push(...rows.map((r) => r.id));
        },
      });
      const h = await makeEngine([def]);
      const r1 = await h.scheduler.requestRefresh(A, {
        syncKey: "test.refresh",
        entityIds: ["camp-2", "camp-1"],
      });
      const r2 = await h.scheduler.requestRefresh(A, {
        syncKey: "test.refresh",
        entityIds: ["camp-1", "camp-2"],
      });
      expect(r2.runId).toBe(r1.runId); // a double click is one run
      expect(h.queue.history[0]?.priority).toBe("interactive");
      await h.drain();
      expect(fetched).toEqual([["camp-1", "camp-2"]]);
      expect(upserted).toEqual(["camp-1", "camp-2"]);
      const run = (await repo.listRuns(A, t!.app.db, { syncKey: "test.refresh" }))[0]!;
      expect(run.family).toBe("entity-refresh");
      expect(run.state).toBe("done");
      // the scheduled cursor is untouched
      const state = await repo.findSyncState(A, t!.app.db, "test.refresh", "");
      expect(state?.lastSuccessAt).toBeNull();
    });
  });

  describe("tenant isolation (CLAUDE.md: a test proves it for every repository)", () => {
    it("tenant B cannot see, read, process or write tenant A's runs, sync states, raw index or inbox", async () => {
      const h = await makeEngine([merchantListings]);
      mockListingsReport(h.amazon.transport, fixtureTsv("merchant-listings.tsv"));
      const { runId } = await h.scheduler.requestRefresh(A, {
        syncKey: "listings.merchant-listings",
        scopeKey: MARKETPLACE,
      });
      await h.drain();
      const runA = (await repo.listRuns(A, t!.app.db)).find((r) => r.id === runId)!;
      await repo.insertInbox(A, t!.app.db, {
        source: "spapi-notification",
        messageId: "iso-1",
        messageType: "ORDER_CHANGE",
        payload: {},
        now: new Date(),
      });

      // repository reads under B's scope
      expect(await repo.getRun(B, t!.app.db, runId, runA.createdAt)).toBeNull();
      expect((await repo.listRuns(B, t!.app.db)).filter((r) => r.id === runId)).toEqual([]);
      expect(await repo.listRawObjects(B, t!.app.db, runId)).toEqual([]);
      expect(await repo.getSyncState(B, t!.app.db, runA.syncStateId as string)).toBeNull();
      expect(
        await repo.findSyncState(B, t!.app.db, "listings.merchant-listings", MARKETPLACE),
      ).not.toEqual(
        await repo.findSyncState(A, t!.app.db, "listings.merchant-listings", MARKETPLACE),
      );
      expect(await repo.claimInbox(B, t!.app.db, 10)).toEqual([]);
      const healthB = await getSyncHealth(B, t!.app.db, [merchantListings]);
      expect(healthB.recentRuns.find((r) => r.id === runId)).toBeUndefined();

      // processing A's payload under B's identity finds nothing
      const wrong = await h.engine.processRun({
        tenantId: B.tenantId,
        sellerAccountId: B.sellerAccountId as string,
        traceId: "x",
        runId,
        runCreatedAt: runA.createdAt.toISOString(),
        step: 99,
      });
      expect(wrong.state).toBe("missing");

      // raw SQL under B's scope sees none of A's rows in any ingest table
      for (const table of ["sync_states", "job_runs", "raw_objects", "inbox"]) {
        const n = await withScope(t!.app.db, B, async (trx) => {
          const r = await sql<{
            n: string;
          }>`select count(*) as n from ${sql.table(`ingest.${table}`)}
            where seller_account_id = ${A.sellerAccountId}`.execute(trx);
          return Number(r.rows[0]?.n);
        });
        expect(n, table).toBe(0);
      }
      // a write that claims A's tenant while scoped as B is rejected by RLS (WITH CHECK)
      await expect(
        withScope(t!.app.db, B, (trx) =>
          sql`insert into ingest.sync_states (id, tenant_id, seller_account_id, sync_key, scope_key)
              values (gen_random_uuid(), ${A.tenantId}, ${A.sellerAccountId}, 'evil', '')`.execute(
            trx,
          ),
        ),
      ).rejects.toThrow();
      // and with no scope at all the repository refuses to run
      await expect(
        repo.listSyncStates({ tenantId: "" } as SellerScope, t!.app.db),
      ).rejects.toBeInstanceOf(MissingScopeError);
    });
  });

  describe("push inbox (SQS stubbed): notification consumer seam", () => {
    const msg = (id: string, body: object = { notificationType: "FBA_INVENTORY" }): SqsMessage => ({
      messageId: `sqs-${id}`,
      receiptHandle: `rh-${id}`,
      body: JSON.stringify({ ...body, notificationId: id }),
    });

    it("ignores a duplicate notification, deletes from SQS only after the insert, and replays a failed row", async () => {
      await sql`delete from ingest.inbox`.execute(t!.owner.db); // leftovers of the isolation test
      const queue: SqsMessage[] = [msg("n-1"), msg("n-1"), msg("n-2")];
      const deleted: string[] = [];
      const sqs: SqsLike = {
        async receive(max) {
          return queue.splice(0, max);
        },
        async delete(rh) {
          deleted.push(rh);
        },
      };
      const out = await pollPushQueue({
        sqs,
        db: t!.app.db,
        source: "spapi-notification",
        log,
        parse: (m) => {
          const body = JSON.parse(m.body) as { notificationId: string; notificationType: string };
          return {
            messageId: body.notificationId,
            messageType: body.notificationType,
            payload: body,
            scope: A,
          };
        },
      });
      expect(out).toEqual({ received: 3, inserted: 2, duplicates: 1, dropped: 0 });
      expect(deleted).toHaveLength(3);

      let calls = 0;
      let failNext = true;
      const handler = definePush({
        key: "inventory.fba-change",
        family: "spapi-notification",
        messageType: "FBA_INVENTORY",
        async handle(_ctx, m) {
          calls++;
          if (m.messageId === "n-2" && failNext) throw new Error("fetch-after-notify failed");
        },
      });
      const first = await processInbox({ scope: A, db: t!.app.db, handlers: [handler], log });
      expect(first).toEqual({ done: 1, failed: 1 });
      expect(calls).toBe(2); // n-1 once (the duplicate never reached a handler), n-2 failed
      failNext = false;
      expect(await repo.replayInbox(A, t!.app.db)).toBe(1);
      const second = await processInbox({ scope: A, db: t!.app.db, handlers: [handler], log });
      expect(second).toEqual({ done: 1, failed: 0 });
      expect(calls).toBe(3);
      // processing the same inbox again does nothing: done rows are not claimed
      expect(await processInbox({ scope: A, db: t!.app.db, handlers: [handler], log })).toEqual({
        done: 0,
        failed: 0,
      });
    });

    it("drops a message it cannot route to a seller account, with a warning", async () => {
      const queue = [msg("x-1")];
      const out = await pollPushQueue({
        sqs: { receive: async (n) => queue.splice(0, n), delete: async () => {} },
        db: t!.app.db,
        source: "marketing-stream",
        log,
        parse: () => null,
      });
      expect(out.dropped).toBe(1);
    });
  });

  describe("retention (D64 a)", () => {
    it("drops job_runs/raw_objects partitions past the horizon and creates the next months", async () => {
      await sql`select core.ensure_monthly_partitions('ingest.job_runs'::regclass, '2025-01-01', '2025-02-01')`.execute(
        t!.owner.db,
      );
      const before = await sql<{
        n: string;
      }>`select count(*) as n from pg_inherits i join pg_class c on c.oid = i.inhrelid
        where i.inhparent = 'ingest.job_runs'::regclass and c.relname like 'job_runs_p2025%'`.execute(
        t!.owner.db,
      );
      expect(Number(before.rows[0]?.n)).toBe(2);
      const res = await repo.maintainPartitions(t!.owner.db, new Date(), {
        jobRunDays: 90,
        rawDays: 35,
      });
      expect(res.dropped).toEqual(
        expect.arrayContaining(["ingest.job_runs_p202501", "ingest.job_runs_p202502"]),
      );
      const after = await sql<{
        n: string;
      }>`select count(*) as n from pg_class where relname like 'job_runs_p2025%'`.execute(
        t!.owner.db,
      );
      expect(Number(after.rows[0]?.n)).toBe(0);
      // the current month's partition (holding today's runs) survives
      const cur = await sql<{ n: string }>`select count(*) as n from ingest.job_runs`.execute(
        t!.owner.db,
      );
      expect(Number(cur.rows[0]?.n)).toBeGreaterThan(0);
    });
  });
});
