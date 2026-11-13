import { createAdsClient, createAdsReports } from "@seller-hub/amazon-ads";
import {
  createAmazonRuntime,
  MemoryTokenCache,
  RedisBucketStore,
  RedisConcurrencyGate,
  type CredentialSource,
} from "@seller-hub/amazon-core";
import { createSpClient } from "@seller-hub/amazon-sp";
import type { AppConfig } from "@seller-hub/config";
import type { Logger, SyncDefinition } from "@seller-hub/core";
import { createDb, type DbHandle } from "@seller-hub/db";
import {
  createEngine,
  createDbSellerDirectory,
  accountsWithPendingInbox,
  createScheduler,
  PRIORITY_CLASSES,
  PRIORITY_NUMBER,
  processInbox,
  S3ObjectStore,
  toIngestDefinitions,
  isPush,
  type DataKioskPort,
  type Engine,
  type EngineConfig,
  type IngestDefinition,
  type ObjectStore,
  type PriorityClass,
  type PushDefinition,
  type RunEnqueuer,
  type RunPayload,
  type Scheduler,
  type SellerDirectory,
} from "@seller-hub/ingestion";
import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { assertJobPayload } from "./payload";

// Composition root of the ingestion engine inside the worker: builds the Amazon runtime, the engine and scheduler,
// and (in `startIngest`) one BullMQ worker per priority queue plus the tick, inbox and maintenance schedules.
// The engine itself lives in packages/ingestion; this file only binds it to BullMQ, Redis, Postgres and S3.

export const RUN_QUEUES: Record<PriorityClass, string> = {
  interactive: "ingest.interactive",
  scheduled: "ingest.scheduled",
  backfill: "ingest.backfill",
};

export class BullRunEnqueuer implements RunEnqueuer {
  readonly queues: Record<PriorityClass, Queue>;
  constructor(connection: Redis) {
    this.queues = Object.fromEntries(
      PRIORITY_CLASSES.map((p) => [p, new Queue(RUN_QUEUES[p], { connection })]),
    ) as Record<PriorityClass, Queue>;
  }
  async enqueue(
    payload: RunPayload,
    options: { priority: PriorityClass; delayMs?: number; jobId: string },
  ): Promise<void> {
    await this.queues[options.priority].add("run", payload, {
      jobId: options.jobId, // a repeated enqueue of the same step is a no-op (conventions §8)
      priority: PRIORITY_NUMBER[options.priority],
      ...(options.delayMs ? { delay: options.delayMs } : {}),
      removeOnComplete: { age: 3_600 },
      removeOnFail: { age: 86_400 },
      attempts: 1, // retries are the engine's (state is in ingest.job_runs), not BullMQ's
    });
  }
  async close(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((q) => q.close()));
  }
}

/**
 * Credentials for Amazon calls. The vault (ADR-0005) belongs to P3-IDENTITY; until it exposes a `CredentialSource`
 * the worker has none, and a live run fails with this message instead of reading credentials from the environment.
 * `SH_AMAZON_MODE=replay` (dev, fixtures) needs none.
 */
export function missingVaultCredentialSource(): CredentialSource {
  return {
    async getCredential() {
      throw new Error(
        "no credential vault is wired into the worker yet (P3-IDENTITY provides the CredentialSource)",
      );
    },
  };
}

export interface IngestOptions {
  config: AppConfig;
  logger: Logger;
  connection: Redis;
  /** Everything the registry found: `syncs.map((s) => s.value)`. */
  definitions: readonly SyncDefinition[];
  credentials?: CredentialSource;
  directory?: SellerDirectory;
  objectStore?: ObjectStore;
  kiosk?: DataKioskPort;
  /** Overrides for the engine's tunables (tests shorten the poll delays). */
  engineConfig?: Partial<EngineConfig>;
}

export interface Ingest {
  engine: Engine;
  scheduler: Scheduler;
  enqueuer: BullRunEnqueuer;
  definitions: IngestDefinition[];
  app: DbHandle;
  system: DbHandle;
  close(): Promise<void>;
}

export async function createIngest(o: IngestOptions): Promise<Ingest> {
  const definitions = toIngestDefinitions(o.definitions); // throws on a bad registry: the worker must not boot
  const app = createDb(o.config.databaseUrl, { max: 10 });
  const system = createDb(o.config.databaseOwnerUrl, { max: 3 });

  const mode = (process.env.SH_AMAZON_MODE ?? "production") as "production" | "sandbox" | "replay";
  const replay = mode === "replay";
  const testing = replay ? await import("@seller-hub/amazon-core/testing") : null;
  const spTesting = replay ? await import("@seller-hub/amazon-sp/testing") : null;
  const adsTesting = replay ? await import("@seller-hub/amazon-ads/testing") : null;
  const runtime = createAmazonRuntime({
    credentials:
      o.credentials ??
      (testing ? testing.fakeCredentialSource() : missingVaultCredentialSource()),
    mode,
    ...(testing && spTesting && adsTesting
      ? {
          transport: testing.createReplayTransport({
            fixtures: [...spTesting.spFixtures(), ...adsTesting.adsFixtures()],
          }),
        }
      : {}),
    // Limits and report slots are shared by every worker process through Redis (ADR-0006).
    bucketStore: new RedisBucketStore(o.connection),
    gate: new RedisConcurrencyGate(o.connection),
    tokenCache: new MemoryTokenCache(),
    logger: o.logger,
  });
  const sp = createSpClient(runtime.client);
  const ads = createAdsClient(runtime.client);

  let objectStore = o.objectStore;
  if (!objectStore) {
    const s3 = new S3ObjectStore({
      endpoint: o.config.s3Endpoint,
      region: o.config.env.SH_S3_REGION,
      bucket: o.config.env.SH_S3_BUCKET,
      accessKey: o.config.env.SH_S3_ACCESS_KEY,
      secretKey: o.config.env.SH_S3_SECRET_KEY,
    });
    await s3.ensureBucket().catch((e: Error) => {
      o.logger.warn({ err: e.message }, "object store not reachable yet; raw landing will retry per run");
    });
    objectStore = s3;
  }

  const enqueuer = new BullRunEnqueuer(o.connection);
  const engine = createEngine({
    db: app.db,
    system: system.db,
    directory: o.directory ?? createDbSellerDirectory(system.db),
    definitions,
    amazon: {
      sp,
      ads,
      adsReports: createAdsReports({ ads, gate: runtime.gate }),
      gate: runtime.gate,
      ...(o.kiosk ? { kiosk: o.kiosk } : {}),
    },
    objectStore,
    enqueuer,
    logger: o.logger,
    config: { rawRetentionDays: o.config.env.SH_RAW_RETENTION_DAYS, ...o.engineConfig },
  });
  const scheduler = createScheduler(engine);
  return {
    engine,
    scheduler,
    enqueuer,
    definitions,
    app,
    system,
    async close() {
      await enqueuer.close();
      await app.close();
      await system.close();
    },
  };
}

export interface RunningIngest extends Ingest {
  workers: Worker[];
}

const TICK_QUEUE = "ingest.tick";
const INBOX_QUEUE = "ingest.inbox";
const MAINTENANCE_QUEUE = "ingest.maintenance";

/** Concurrency per priority queue: interactive work is never starved by a backfill (ADR-0008 decision 1). */
const WORKER_CONCURRENCY: Record<PriorityClass, number> = { interactive: 4, scheduled: 4, backfill: 2 };

export async function startIngest(o: IngestOptions): Promise<RunningIngest> {
  const ingest = await createIngest(o);
  const { engine, scheduler, enqueuer } = ingest;
  const log = o.logger.child({ component: "ingest" });
  const workers: Worker[] = [];
  const extraQueues: Queue[] = [];

  for (const priority of PRIORITY_CLASSES) {
    const w = new Worker(
      RUN_QUEUES[priority],
      async (job) => {
        const base = assertJobPayload(job.data);
        const payload = job.data as RunPayload;
        const result = await engine.processRun(payload);
        if (!result.done) {
          // Polling, throttling and backoff are delayed re-enqueues: no worker sleeps (ADR-0008 decision 3).
          const step = payload.step + 1;
          await enqueuer.enqueue(
            { ...payload, step },
            { priority, jobId: `${payload.runId}-${step}`, delayMs: result.delayMs ?? 0 },
          );
        }
        return { runId: base.traceId, state: result.state };
      },
      { connection: o.connection, concurrency: WORKER_CONCURRENCY[priority] },
    );
    w.on("failed", (job, err) =>
      log.error({ queue: RUN_QUEUES[priority], jobId: job?.id, err: err.message }, "ingest job crashed"),
    );
    workers.push(w);
  }

  const pushHandlers: PushDefinition[] = ingest.definitions.filter(isPush);

  async function every(queueName: string, everyMs: number, run: () => Promise<unknown>): Promise<void> {
    const queue = new Queue(queueName, { connection: o.connection });
    extraQueues.push(queue);
    await queue.upsertJobScheduler(`${queueName}:schedule`, { every: everyMs }, { name: queueName, data: {} });
    workers.push(
      new Worker(queueName, async () => run(), { connection: o.connection, concurrency: 1 }),
    );
  }

  await every(TICK_QUEUE, 60_000, async () => {
    const r = await scheduler.tick();
    if (r.enqueued || r.resumed) log.info(r, "scheduler tick");
    return r;
  });
  await every(INBOX_QUEUE, 30_000, async () => {
    if (pushHandlers.length === 0) return { accounts: 0 };
    const accounts = await accountsWithPendingInbox(ingest.system.db);
    for (const a of accounts)
      await processInbox({ scope: a, db: ingest.app.db, handlers: pushHandlers, log });
    return { accounts: accounts.length };
  });
  await every(MAINTENANCE_QUEUE, 24 * 3_600_000, async () => {
    const r = await scheduler.maintenance();
    log.info(r, "ingest partition maintenance");
    return r;
  });

  log.info(
    {
      syncDefinitions: ingest.definitions.length,
      pushHandlers: pushHandlers.length,
      queues: [...Object.values(RUN_QUEUES), TICK_QUEUE, INBOX_QUEUE, MAINTENANCE_QUEUE],
    },
    "ingestion engine started",
  );

  return {
    ...ingest,
    workers,
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(extraQueues.map((q) => q.close()));
      await ingest.close();
    },
  };
}
