import { createLogger } from "@seller-hub/core";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { systemPayload } from "../src/payload";
import { runJob } from "../src/runtime";

const logger = createLogger({ name: "test", level: "silent" });

describe("runJob (S1: scheduled jobs carry a system payload)", () => {
  it("runs a scheduled tick through processScheduled with the system payload", async () => {
    const processScheduled = vi.fn(async () => "ticked");
    const process = vi.fn(async () => "account");
    const def = { queue: "m.relay", schedule: { every: "1m" }, process, processScheduled };
    await expect(runJob(def, systemPayload("m.relay"), "j1", logger)).resolves.toBe("ticked");
    expect(processScheduled).toHaveBeenCalledWith(
      expect.objectContaining({ data: { system: true, traceId: "schedule:m.relay" } }),
    );
    expect(process).not.toHaveBeenCalled();
  });

  it("still rejects an account job without tenantId/sellerAccountId/traceId, without retry", async () => {
    const def = { queue: "m.job", process: vi.fn(async () => 1) };
    await expect(runJob(def, {}, "j2", logger)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(def.process).not.toHaveBeenCalled();
  });

  it("runs an account job with a complete payload", async () => {
    const def = { queue: "m.job", process: vi.fn(async () => "done") };
    const data = { tenantId: "t", sellerAccountId: "s", traceId: "x" };
    await expect(runJob(def, data, "j3", logger)).resolves.toBe("done");
  });

  it("rejects a system tick for a job that declares no processScheduled", async () => {
    const def = { queue: "m.job", process: vi.fn(async () => 1) };
    await expect(runJob(def, systemPayload("m.job"), "j4", logger)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
