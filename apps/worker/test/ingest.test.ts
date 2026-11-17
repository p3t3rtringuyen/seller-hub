import { loadConfig, loadEnvFile } from "@seller-hub/config";
import { createLogger, type SellerScope } from "@seller-hub/core";
import { withScope } from "@seller-hub/db";
import {
  defineSpReport,
  MemoryObjectStore,
  parseTsv,
  staticSellerDirectory,
  type SyncTarget,
} from "@seller-hub/ingestion";
import { FIXTURE, seedFixtures, tryCreateTestDb } from "@seller-hub/testing";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUN_QUEUES } from "@seller-hub/ingestion/queue";
import { startIngest, type RunningIngest } from "../src/ingest";

// The whole path on the real stack: BullMQ + Redis queues, Postgres with RLS, the Amazon runtime in replay mode
// (fixtures from packages/amazon-sp/fixtures/reports.json, no network), raw landing in memory. Skipped without
// the stack; SH_REQUIRE_DB=1 turns the skip into a failure.

loadEnvFile();
const cfg = loadConfig({ ...process.env, NODE_ENV: "test" });
const t = await tryCreateTestDb();
let redis: Redis | null = null;
try {
  redis = new Redis(cfg.redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  redis.on("error", () => undefined);
  await redis.connect();
} catch (e) {
  if (process.env.SH_REQUIRE_DB === "1") throw e;
  console.warn("[worker test] no Redis reachable; ingestion queue test skipped");
  redis = null;
}

const A: SellerScope = { tenantId: FIXTURE.tenantId, sellerAccountId: FIXTURE.sellerAccountId };
const target: SyncTarget = {
  tenantId: A.tenantId,
  sellerAccountId: A.sellerAccountId as string,
  accountType: "seller",
  region: "na",
  marketplaceIds: ["ATVPDKIKX0DER"],
  adsProfiles: [],
  paused: {},
};

const fixtureReport = defineSpReport<{ sku: string; asin: string; price: string }>({
  key: "listings.fixture-report",
  family: "spapi-report",
  scopeKind: "marketplace",
  schedule: { every: "6h" },
  report: (ctx) => ({
    reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
    marketplaceIds: [ctx.scopeKey],
  }),
  parse: (text) => parseTsv(text) as { sku: string; asin: string; price: string }[],
  async upsert(ctx, rows) {
    for (const r of rows) {
      await sql`insert into catalog.listings (id, tenant_id, seller_account_id, marketplace_id, seller_sku, asin, price_amount, synced_at)
        values (gen_random_uuid(), ${ctx.scope.tenantId}, ${ctx.scope.sellerAccountId}, ${ctx.scopeKey}, ${r.sku}, ${r.asin}, ${r.price}::numeric, ${ctx.now()})
        on conflict (seller_account_id, marketplace_id, seller_sku) do update set asin = excluded.asin`.execute(
        ctx.trx,
      );
    }
  },
});

describe.skipIf(!t || !redis)("ingestion on the worker (BullMQ + Postgres + replay Amazon)", () => {
  let ingest: RunningIngest;
  const store = new MemoryObjectStore();
  beforeAll(async () => {
    process.env.SH_AMAZON_MODE = "replay";
    await seedFixtures(t!);
    ingest = await startIngest({
      config: { ...cfg, databaseUrl: t!.appUrl, databaseOwnerUrl: t!.ownerUrl },
      logger: createLogger({ name: "test", level: "silent" }),
      connection: redis!,
      definitions: [fixtureReport as never],
      directory: staticSellerDirectory([target]),
      objectStore: store,
      engineConfig: { polling: { spPollMs: 300, adsPollMs: 300, kioskPollMs: 300 } },
    });
  });
  afterAll(async () => {
    await ingest?.close();
    for (const q of Object.values(RUN_QUEUES)) await redis!.del(`bull:${q}:meta`);
    delete process.env.SH_AMAZON_MODE;
    redis?.disconnect();
    await t?.drop();
  });

  it("an interactive refresh runs through the queue: create, poll (delayed re-enqueue), download, land, parse, upsert", async () => {
    await ingest.scheduler.ensureStates();
    const { runId } = await ingest.scheduler.requestRefresh(A, {
      syncKey: "listings.fixture-report",
      scopeKey: "ATVPDKIKX0DER",
    });
    let state = "";
    for (let i = 0; i < 80 && state !== "done" && state !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const r = await sql<{
        state: string;
      }>`select state from ingest.job_runs where id = ${runId}`.execute(t!.owner.db);
      state = r.rows[0]?.state ?? "";
    }
    expect(state).toBe("done");
    const listings = await withScope(t!.app.db, A, async (trx) =>
      (
        await sql<{
          seller_sku: string;
        }>`select seller_sku from catalog.listings order by seller_sku`.execute(trx)
      ).rows.map((r) => r.seller_sku),
    );
    expect(listings).toEqual(["SKU-1", "SKU-2"]);
    expect([...store.objects.keys()].some((k) => k.includes(runId))).toBe(true);
    const run = await sql<{
      rows_upserted: number;
      attempts: number;
    }>`select rows_upserted, attempts from ingest.job_runs where id = ${runId}`.execute(
      t!.owner.db,
    );
    expect(run.rows[0]).toMatchObject({ rows_upserted: 2, attempts: 0 });
  }, 30_000);
});
