import type { JobPayloadBase } from "@seller-hub/core";

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
