import { defineJob, type JobDefinition, type Logger } from "@seller-hub/core";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { assertJobPayload, isSystemPayload, systemPayload } from "./payload";

// The worker's queue plumbing. P3-INGEST owns the runner code from here on (scheduler tick, sync
// families, report runner); this file is the minimal skeleton: one BullMQ Worker per registered job
// definition, payload validation, graceful close.

/** The skeleton's own no-op job: proves the connection and the payload rules end to end. */
export const noopJob = defineJob({
  queue: "platform.noop",
  async process({ data, log }) {
    log.debug({ tenantId: data.tenantId }, "noop job");
    return { ok: true };
  },
});

/**
 * Runs one job. Scheduled ticks (system payload) go to `processScheduled`; every other job must carry
 * tenantId, sellerAccountId and traceId or it is rejected without retry.
 */
export async function runJob(
  def: JobDefinition<any>, // eslint-disable-line @typescript-eslint/no-explicit-any -- payload types differ per job
  raw: unknown,
  jobId: string,
  logger: Logger,
): Promise<unknown> {
  if (isSystemPayload(raw)) {
    if (!def.processScheduled) throw new UnrecoverableError(`${def.queue} has no processScheduled`);
    const log = logger.child({ queue: def.queue, jobId, traceId: raw.traceId, system: true });
    return def.processScheduled({ data: raw, log, jobId });
  }
  let data;
  try {
    data = assertJobPayload(raw);
  } catch (e) {
    throw new UnrecoverableError((e as Error).message); // no retry for a malformed job
  }
  const log = logger.child({
    queue: def.queue,
    jobId,
    tenantId: data.tenantId,
    sellerAccountId: data.sellerAccountId,
    traceId: data.traceId,
  });
  return def.process({ data: raw as never, log, jobId });
}

export interface RunningWorkers {
  queues: Map<string, Queue>;
  close(): Promise<void>;
}

export async function startWorkers(options: {
  connection: Redis;
  logger: Logger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload types differ per job
  jobs: readonly JobDefinition<any>[];
}): Promise<RunningWorkers> {
  const { connection, logger } = options;
  const queues = new Map<string, Queue>();
  const workers: Worker[] = [];

  for (const def of [noopJob, ...options.jobs]) {
    const queue = new Queue(def.queue, { connection });
    queues.set(def.queue, queue);
    const worker = new Worker(def.queue, (job) => runJob(def, job.data, job.id ?? "", logger), {
      connection,
      concurrency: def.concurrency ?? 1,
    });
    worker.on("failed", (job, err) =>
      logger.warn({ queue: def.queue, jobId: job?.id, err: err.message }, "job failed"),
    );
    workers.push(worker);
    if (def.schedule) {
      await queue.upsertJobScheduler(
        `${def.queue}:schedule`,
        { every: parseEveryMs(def.schedule.every) },
        { name: def.queue, data: systemPayload(def.queue) },
      );
    }
  }

  return {
    queues,
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all([...queues.values()].map((q) => q.close()));
    },
  };
}

/** "30s" | "5m" | "6h" | "1d" -> milliseconds. */
export function parseEveryMs(every: string): number {
  const m = /^(\d+)(s|m|h|d)$/.exec(every);
  if (!m) throw new Error(`invalid schedule interval "${every}" (use 30s, 5m, 6h, 1d)`);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "s" | "m" | "h" | "d"];
  return Number(m[1]) * unit;
}
