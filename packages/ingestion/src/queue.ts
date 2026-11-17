import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import {
  PRIORITY_CLASSES,
  PRIORITY_NUMBER,
  type PriorityClass,
  type RunEnqueuer,
  type RunPayload,
} from "./types";

// The BullMQ binding of the run queues, shared by every process that enqueues (worker scheduler, API refresh route,
// command executor): they all add to the same three queues. Entry point `@seller-hub/ingestion/queue`, kept apart
// from the main entry so code that only needs the engine types does not load BullMQ.

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
    options: {
      priority: PriorityClass;
      delayMs?: number;
      jobId: string;
      replaceFinished?: boolean;
    },
  ): Promise<void> {
    if (options.replaceFinished) {
      // BullMQ ignores an add whose id still exists in ANY state, failed included (kept 24 h): free a finished one.
      const existing = await this.queues[options.priority].getJob(options.jobId);
      if (existing && ["failed", "completed"].includes(await existing.getState()))
        await existing.remove();
    }
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
