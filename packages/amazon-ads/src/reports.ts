import type {
  AmazonItemError,
  ConcurrencyGate,
  GateLease,
  OperationArgs,
} from "@seller-hub/amazon-core";
import {
  AmazonClientError,
  AmazonUpstreamError,
  LocalRateLimitError,
  mapMultiStatus,
} from "@seller-hub/amazon-core";
import type { AdsClient, AdsScope } from "./ads-client";
import type { AdsOperationTypes } from "./generated/operations";

// Ads v1 reports (D57 a): create → poll → download → decompress. There is NO Reporting v3 anywhere in this
// package (v3 shuts off 2027-06-30). Report creation can be limited to 1 concurrent request per client app
// (refs/amazon-ads/docs/guides/reporting/ads-v1/limits.md), so the helper holds a lease on a shared gate from
// creation until the report is finished; with Redis behind the gate that is one lease across all workers.

export type CreateReportBody = NonNullable<
  OperationArgs<AdsOperationTypes["AdsApiv1CreateReport"]> extends { body: infer B } ? B : never
>;

export interface AdsReportsOptions {
  ads: AdsClient;
  gate: ConcurrencyGate;
  /** Gate key shared by every process that uses the same Ads client application. */
  gateKey?: string;
  /** How many reports may run at once per client app. Default 1 (the documented floor). */
  concurrency?: number;
  /** A lease the owner never releases (crash) expires after this long. Default 2 h. */
  leaseMs?: number;
}

export interface RunAdsReportOptions {
  /** First poll delay; doubles up to `maxPollMs`. Default 5 s → 60 s. */
  pollIntervalMs?: number;
  maxPollMs?: number;
  /** Give up after this long (the lease is released). Default 60 min. */
  timeoutMs?: number;
  /** How long to wait for a free report slot before throwing `LocalRateLimitError`. `0` = fail fast. Default 0. */
  waitForSlotMs?: number;
}

export interface AdsReportOutcome {
  reportId: string;
  format: string;
  /** One entry per downloaded part, already decompressed. */
  parts: Uint8Array[];
  /** All parts as text, concatenated (CSV parts repeat their header line: split `parts` for partitioned CSV). */
  text(): string;
}

export class AdsReportCreateError extends AmazonClientError {
  constructor(readonly errors: AmazonItemError[]) {
    super(`Amazon rejected the report request: ${errors.map((e) => e.code).join(", ")}`);
  }
}

export class AdsReportFailedError extends AmazonClientError {
  constructor(
    readonly reportId: string,
    readonly failureCode: string | undefined,
    readonly failureReason: string | undefined,
  ) {
    super(`report ${reportId} failed${failureCode ? ` (${failureCode})` : ""}`);
  }
}

export class AdsReportTimeoutError extends AmazonUpstreamError {
  constructor(readonly reportId: string) {
    super(`report ${reportId} was not ready in time`, { api: "ads" }, true);
  }
}

interface ReportShape {
  reportId?: string;
  status?: string;
  format?: string;
  failureCode?: string;
  failureReason?: string;
  completedReportParts?: { url: string; sizeInBytes?: number }[];
}

export function createAdsReports(options: AdsReportsOptions) {
  const { ads, gate } = options;
  const gateKey = options.gateKey ?? "ads:v1-reports";
  const limit = options.concurrency ?? 1;
  const leaseMs = options.leaseMs ?? 2 * 60 * 60_000;

  async function takeSlot(waitMs: number): Promise<GateLease> {
    const started = ads.now();
    for (;;) {
      const lease = await gate.tryAcquire(gateKey, limit, leaseMs);
      if (lease) return lease;
      if (ads.now() - started + 5_000 > waitMs) {
        throw new LocalRateLimitError(
          "all report slots for this Ads client app are in use",
          { api: "ads", operation: "AdsApiv1CreateReport" },
          30_000,
        );
      }
      await ads.sleep(5_000);
    }
  }

  return {
    /** Create, wait, download. Holds a report slot for the whole run. */
    async run(
      scope: AdsScope,
      body: CreateReportBody,
      run: RunAdsReportOptions = {},
    ): Promise<AdsReportOutcome> {
      const lease = await takeSlot(run.waitForSlotMs ?? 0);
      try {
        const reportId = await this.create(scope, body);
        return await this.waitAndDownload(scope, reportId, run);
      } finally {
        await lease.release();
      }
    },

    /** Step 1: create. The caller owns slot management when it uses the steps separately. */
    async create(scope: AdsScope, body: CreateReportBody): Promise<string> {
      const res = await ads.AdsApiv1CreateReport(scope, { body });
      const mapped = mapMultiStatus([body], res.body);
      const item = mapped.items[0];
      if (!item || !item.ok) throw new AdsReportCreateError(item && !item.ok ? item.errors : []);
      const reportId = (item.entity as ReportShape).reportId;
      if (!reportId) throw new AdsReportCreateError([{ code: "missing_report_id" }]);
      return reportId;
    },

    /** Step 2 + 3 + 4: poll until COMPLETED / FAILED, then download and decompress every part. */
    async waitAndDownload(
      scope: AdsScope,
      reportId: string,
      run: RunAdsReportOptions = {},
    ): Promise<AdsReportOutcome> {
      const started = ads.now();
      const timeoutMs = run.timeoutMs ?? 60 * 60_000;
      const maxPoll = run.maxPollMs ?? 60_000;
      let poll = run.pollIntervalMs ?? 5_000;
      for (;;) {
        const report = await this.retrieve(scope, reportId);
        if (report.status === "COMPLETED") return this.download(reportId, report);
        if (report.status === "FAILED")
          throw new AdsReportFailedError(reportId, report.failureCode, report.failureReason);
        if (ads.now() - started + poll > timeoutMs) throw new AdsReportTimeoutError(reportId);
        await ads.sleep(poll);
        poll = Math.min(maxPoll, poll * 2);
      }
    },

    async retrieve(scope: AdsScope, reportId: string): Promise<ReportShape> {
      const res = await ads.AdsApiv1RetrieveReport(
        scope,
        { body: { reportIds: [reportId] } },
        { idempotent: true },
      );
      const item = mapMultiStatus([reportId], res.body).items[0];
      if (!item || !item.ok)
        throw new AdsReportCreateError(
          item && !item.ok ? item.errors : [{ code: "missing_result" }],
        );
      return item.entity as ReportShape;
    },

    async download(reportId: string, report: ReportShape): Promise<AdsReportOutcome> {
      const parts: Uint8Array[] = [];
      for (const part of report.completedReportParts ?? [])
        parts.push(await ads.download(part.url, { compression: "auto" }));
      const decoder = new TextDecoder();
      return {
        reportId,
        format: report.format ?? "UNKNOWN",
        parts,
        text: () => parts.map((p) => decoder.decode(p)).join(""),
      };
    },
  };
}

export type AdsReports = ReturnType<typeof createAdsReports>;
