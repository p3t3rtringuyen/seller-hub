// EX-EXPORTS (D53 named exception) - Ads v0 AmazonAdsAPIExports: Campaign/AdGroup/Ad/Target export + GetExport.
// Why v0: v1 has no bulk metadata export. Limits: 202 then poll `GET /exports/{id}`; at most 5 jobs in
// progress per endpoint; the download URL is valid ~1 h (regenerable by GetExport for 24 h); not for real-time.
// Watch: refs/amazon-ads/docs/release-notes/deprecations.md (stated "not affected").
import type { ConcurrencyGate } from "@seller-hub/amazon-core";
import { AmazonClientError, LocalRateLimitError } from "@seller-hub/amazon-core";
import type { AdsCallOptions, AdsClient, AdsScope } from "../../ads-client";
import type { ArgsOf } from "../common";

export const EX_EXPORTS = "EX-EXPORTS";

export type ExportKind = "campaigns" | "adGroups" | "ads" | "targets";

const CREATE: Record<
  ExportKind,
  { op: "CampaignExport" | "AdGroupExport" | "AdExport" | "TargetExport"; accept: string }
> = {
  campaigns: { op: "CampaignExport", accept: "application/vnd.campaignsexport.v1+json" },
  adGroups: { op: "AdGroupExport", accept: "application/vnd.adgroupsexport.v1+json" },
  ads: { op: "AdExport", accept: "application/vnd.adsexport.v1+json" },
  targets: { op: "TargetExport", accept: "application/vnd.targetsexport.v1+json" },
};

export interface ExportStatus {
  exportId: string;
  status: string;
  /** Present when COMPLETED. */
  url?: string;
  urlExpiresAt?: string;
  generatedAt?: string;
  failureReason?: string;
}

export class ExportFailedError extends AmazonClientError {
  constructor(
    readonly exportId: string,
    readonly reason: string | undefined,
  ) {
    super(`export ${exportId} failed${reason ? `: ${reason}` : ""}`);
  }
}

export interface RunExportOptions extends AdsCallOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface ExportsPort {
  /** Starts an export (202). Returns the export id. */
  create(
    scope: AdsScope,
    kind: ExportKind,
    body: unknown,
    options?: AdsCallOptions,
  ): Promise<string>;
  get(
    scope: AdsScope,
    kind: ExportKind,
    exportId: string,
    options?: AdsCallOptions,
  ): Promise<ExportStatus>;
  /** create → poll → download → gunzip → parse JSON. Holds one of the 5 slots of this export kind. */
  run(
    scope: AdsScope,
    kind: ExportKind,
    body: unknown,
    options?: RunExportOptions,
  ): Promise<unknown>;
}

export function createExportsPort(
  ads: AdsClient,
  gate: ConcurrencyGate,
  gateKeyPrefix = "ads:export",
): ExportsPort {
  const get: ExportsPort["get"] = async (scope, kind, exportId, options) => {
    const res = await ads.GetExport(scope, { path: { exportId } } as ArgsOf<"GetExport">, {
      idempotent: true,
      accept: CREATE[kind].accept,
      ...options,
    });
    const b = (res.body ?? {}) as unknown as Record<string, string | undefined> & {
      error?: { message?: string };
    };
    return {
      exportId: b.exportId ?? exportId,
      status: b.status ?? "UNKNOWN",
      ...(b.url ? { url: b.url } : {}),
      ...(b.urlExpiresAt ? { urlExpiresAt: b.urlExpiresAt } : {}),
      ...(b.generatedAt ? { generatedAt: b.generatedAt } : {}),
      ...(b.error?.message ? { failureReason: b.error.message } : {}),
    };
  };
  const create: ExportsPort["create"] = async (scope, kind, body, options) => {
    const c = CREATE[kind];
    const res = await ads.call(c.op, scope, { body } as never, { accept: c.accept, ...options });
    const id = (res.body as { exportId?: string } | undefined)?.exportId;
    if (!id) throw new AmazonClientError(`${c.op} returned no exportId`);
    return id;
  };
  return {
    create,
    get,
    async run(scope, kind, body, options = {}) {
      const lease = await gate.tryAcquire(`${gateKeyPrefix}:${kind}`, 5, 60 * 60_000);
      if (!lease) {
        throw new LocalRateLimitError(
          `5 ${kind} exports are already in progress`,
          { api: "ads", operation: CREATE[kind].op },
          30_000,
        );
      }
      try {
        const exportId = await create(scope, kind, body, options);
        const started = ads.now();
        let poll = options.pollIntervalMs ?? 5_000;
        for (;;) {
          const s = await get(scope, kind, exportId, options);
          if (s.status === "COMPLETED" && s.url) {
            const bytes = await ads.download(s.url, { compression: "auto" });
            return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
          }
          if (s.status === "FAILED") throw new ExportFailedError(exportId, s.failureReason);
          if (ads.now() - started + poll > (options.timeoutMs ?? 30 * 60_000)) {
            throw new ExportFailedError(exportId, "timed out waiting for the export");
          }
          await ads.sleep(poll);
          poll = Math.min(60_000, poll * 2);
        }
      } finally {
        await lease.release();
      }
    },
  };
}
