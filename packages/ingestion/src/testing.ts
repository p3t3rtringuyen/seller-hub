import { createAdsClient, createAdsReports } from "@seller-hub/amazon-ads";
import { createSpClient } from "@seller-hub/amazon-sp";
import { createTestRuntime, type TestRuntime } from "@seller-hub/amazon-core/testing";
import { createLogger } from "@seller-hub/core";
import type { Database } from "@seller-hub/db";
import { staticSellerDirectory } from "./directory";
import { createEngine, type Engine, type EngineConfig } from "./engine";
import { MemoryObjectStore } from "./object-store";
import { createScheduler, type Scheduler } from "./scheduler";
import type { DataKioskPort, IngestDefinition, RunEnqueuer, RunPayload, SyncTarget } from "./types";

// Test support for the engine and for slices' sync definitions: an in-memory queue that runs jobs inline, the Amazon
// mock transport from `@seller-hub/amazon-core/testing`, an in-memory object store. No network, no Redis, no clock waits.

export interface QueuedRun {
  payload: RunPayload;
  priority: string;
  delayMs: number;
  jobId: string;
}

export class InlineQueue implements RunEnqueuer {
  readonly pending: QueuedRun[] = [];
  readonly history: QueuedRun[] = [];
  async enqueue(
    payload: RunPayload,
    options: { priority: string; delayMs?: number; jobId: string },
  ): Promise<void> {
    // BullMQ ignores a job whose id is already in the queue: so does this.
    if (this.pending.some((p) => p.jobId === options.jobId)) return;
    const item = {
      payload,
      priority: options.priority,
      delayMs: options.delayMs ?? 0,
      jobId: options.jobId,
    };
    this.pending.push(item);
    this.history.push(item);
  }
}

export interface TestEngine {
  engine: Engine;
  scheduler: Scheduler;
  queue: InlineQueue;
  store: MemoryObjectStore;
  amazon: TestRuntime;
  /** Processes queued jobs (highest priority first, delays skipped) until the queue is empty or `maxSteps` is hit. */
  drain(maxSteps?: number): Promise<{ steps: number; delays: number[] }>;
}

const PRIORITY_ORDER: Record<string, number> = { interactive: 0, scheduled: 1, backfill: 2 };

export function createTestEngine(o: {
  /** `sh_app` handle (RLS applies). */
  app: Database;
  /** `sh_owner` handle (the scheduler's system view). */
  owner: Database;
  definitions: readonly IngestDefinition[];
  targets: SyncTarget[];
  kiosk?: DataKioskPort;
  config?: Partial<EngineConfig>;
}): TestEngine {
  const amazon = createTestRuntime();
  const sp = createSpClient(amazon.runtime.client);
  const ads = createAdsClient(amazon.runtime.client);
  const adsReports = createAdsReports({ ads, gate: amazon.runtime.gate });
  const queue = new InlineQueue();
  const store = new MemoryObjectStore();
  const engine = createEngine({
    db: o.app,
    system: o.owner,
    directory: staticSellerDirectory(o.targets),
    definitions: o.definitions,
    amazon: {
      sp,
      ads,
      adsReports,
      gate: amazon.runtime.gate,
      ...(o.kiosk ? { kiosk: o.kiosk } : {}),
    },
    objectStore: store,
    enqueuer: queue,
    logger: createLogger({ name: "ingestion-test", level: "silent" }),
    random: () => 0.5,
    config: {
      polling: { spPollMs: 1_000, adsPollMs: 1_000, kioskPollMs: 1_000 },
      backoffBaseMs: 1_000,
      ...o.config,
    },
  });
  const scheduler = createScheduler(engine);

  async function drain(maxSteps = 200): Promise<{ steps: number; delays: number[] }> {
    let steps = 0;
    const delays: number[] = [];
    while (queue.pending.length && steps < maxSteps) {
      queue.pending.sort(
        (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
      );
      const next = queue.pending.shift() as QueuedRun;
      const res = await engine.processRun(next.payload);
      steps++;
      if (!res.done) {
        delays.push(res.delayMs ?? 0);
        await queue.enqueue(next.payload, {
          priority: next.priority,
          jobId: `${next.payload.runId}-r${steps}`,
        });
      }
    }
    return { steps, delays };
  }
  return { engine, scheduler, queue, store, amazon, drain };
}
