import type { JobPayloadBase, SystemJobPayload } from "@seller-hub/core";

/** Conventions §8: every job payload carries tenantId, sellerAccountId and traceId; otherwise it is rejected. */
export function assertJobPayload(data: unknown): JobPayloadBase {
  const d = data as Partial<JobPayloadBase> | null;
  for (const field of ["tenantId", "sellerAccountId", "traceId"] as const) {
    if (!d || typeof d[field] !== "string" || d[field] === "") {
      throw new Error(`job payload is missing "${field}"`);
    }
  }
  return d as JobPayloadBase;
}

/** Deterministic job id (conventions §8): a duplicate enqueue is a no-op. */
export const jobId = (queue: string, sellerAccountId: string, windowOrKey: string): string =>
  `${queue}:${sellerAccountId}:${windowOrKey}`;

export const isSystemPayload = (data: unknown): data is SystemJobPayload =>
  !!data &&
  typeof data === "object" &&
  (data as { system?: unknown }).system === true &&
  typeof (data as { traceId?: unknown }).traceId === "string";

/** The payload scheduler ticks carry (BullMQ job schedulers create jobs from this template). */
export const systemPayload = (queue: string): SystemJobPayload => ({
  system: true,
  traceId: `schedule:${queue}`,
});
