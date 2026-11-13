import { AmazonClientError } from "@seller-hub/amazon-core";
import { fetchDocument, ReportFailedError } from "@seller-hub/amazon-sp";
import { AdsReportFailedError } from "@seller-hub/amazon-ads";
import type {
  AdsExportDefinition,
  AdsReportDefinition,
  DataKioskDefinition,
  PullDefinition,
  RunContext,
  SpReportDefinition,
} from "../types";

// The create → poll → download shape shared by SP-API reports, Ads v1 reports, Ads exports and Data Kiosk queries.
// An adapter does ONE Amazon step per call and never sleeps: the engine persists the request id and re-enqueues
// with a delay (ADR-0008 decision 3: "polling uses delayed re-enqueue, no sleeping workers").

export interface LandedDocument {
  bytes: Uint8Array;
  contentType: string;
  /** Report type / export type / query, kept in `raw_objects.source_ref`. */
  sourceRef: string;
}

export type PollResult =
  { ready: false; retryAfterMs: number } | { ready: true; documentId: string };

export interface AsyncJobAdapter<D extends PullDefinition = PullDefinition> {
  create(ctx: RunContext, def: D): Promise<string>;
  poll(ctx: RunContext, def: D, requestId: string): Promise<PollResult>;
  download(
    ctx: RunContext,
    def: D,
    requestId: string,
    documentId: string,
  ): Promise<LandedDocument[]>;
}

export interface PollingConfig {
  /** Delay between polls. SP-API reports take minutes; Ads reports seconds to minutes. */
  spPollMs: number;
  adsPollMs: number;
  kioskPollMs: number;
}

export const DEFAULT_POLLING: PollingConfig = {
  spPollMs: 30_000,
  adsPollMs: 15_000,
  kioskPollMs: 30_000,
};

export class AsyncJobFailedError extends AmazonClientError {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

// --- SP-API reports ------------------------------------------------------------------------------------------

function spReportRequest(ctx: RunContext, def: SpReportDefinition) {
  const r = def.report(ctx);
  const start = r.dataStartTime ?? ctx.window.start?.toISOString();
  const end = r.dataEndTime ?? ctx.window.end?.toISOString();
  return {
    reportType: r.reportType,
    marketplaceIds: [...(r.marketplaceIds ?? ctx.marketplaceIds)],
    ...(start ? { dataStartTime: start } : {}),
    ...(end ? { dataEndTime: end } : {}),
    ...(r.reportOptions ? { reportOptions: r.reportOptions } : {}),
  };
}

export const spReportAdapter = (polling: PollingConfig): AsyncJobAdapter<SpReportDefinition> => ({
  async create(ctx, def) {
    const res = await ctx.sp.reports.createReport(ctx.spScope, { body: spReportRequest(ctx, def) });
    const reportId = (res.body as { reportId?: string } | undefined)?.reportId;
    if (!reportId)
      throw new AsyncJobFailedError("createReport returned no reportId", "no_report_id");
    return reportId;
  },
  async poll(ctx, _def, reportId) {
    const res = await ctx.sp.reports.getReport(ctx.spScope, { path: { reportId } });
    const body = res.body as { processingStatus?: string; reportDocumentId?: string };
    const status = body.processingStatus ?? "UNKNOWN";
    if (status === "DONE") {
      if (!body.reportDocumentId) throw new ReportFailedError(reportId, "DONE_WITHOUT_DOCUMENT");
      return { ready: true, documentId: body.reportDocumentId };
    }
    if (status === "CANCELLED" || status === "FATAL") throw new ReportFailedError(reportId, status);
    return { ready: false, retryAfterMs: polling.spPollMs };
  },
  async download(ctx, def, reportId, documentId) {
    const reportType = def.report(ctx).reportType;
    const out = await fetchDocument(ctx.sp, ctx.spScope, reportId, documentId, reportType);
    return [
      { bytes: out.document, contentType: "text/tab-separated-values", sourceRef: reportType },
    ];
  },
});

// --- Ads v1 reports (D57 a: there is no Reporting v3 here) ------------------------------------------------------

export const adsReportAdapter = (polling: PollingConfig): AsyncJobAdapter<AdsReportDefinition> => ({
  create(ctx, def) {
    return ctx.adsReports.create(
      ctx.adsScope,
      def.buildRequest(ctx) as Parameters<typeof ctx.adsReports.create>[1],
    );
  },
  async poll(ctx, _def, reportId) {
    const report = await ctx.adsReports.retrieve(ctx.adsScope, reportId);
    if (report.status === "COMPLETED") return { ready: true, documentId: reportId };
    if (report.status === "FAILED")
      throw new AdsReportFailedError(reportId, report.failureCode, report.failureReason);
    return { ready: false, retryAfterMs: polling.adsPollMs };
  },
  async download(ctx, _def, reportId) {
    const report = await ctx.adsReports.retrieve(ctx.adsScope, reportId);
    const outcome = await ctx.adsReports.download(reportId, report);
    const type = outcome.format.includes("CSV") ? "text/csv" : "application/json";
    return outcome.parts.map((bytes) => ({ bytes, contentType: type, sourceRef: "ads-v1-report" }));
  },
});

// --- Ads export snapshots ------------------------------------------------------------------------------------------

const EXPORT_MEDIA: Record<AdsExportDefinition["exportOperation"], string> = {
  CampaignExport: "application/vnd.campaignsexport.v1+json",
  AdGroupExport: "application/vnd.adgroupsexport.v1+json",
  AdExport: "application/vnd.adsexport.v1+json",
  TargetExport: "application/vnd.targetsexport.v1+json",
};

interface ExportShape {
  exportId?: string;
  status?: string;
  url?: string;
  error?: { message?: string };
}

export const adsExportAdapter = (polling: PollingConfig): AsyncJobAdapter<AdsExportDefinition> => ({
  async create(ctx, def) {
    const res = await ctx.ads.call(def.exportOperation, ctx.adsScope, {
      body: def.buildRequest(ctx),
    } as never);
    const exportId = (res.body as ExportShape | undefined)?.exportId;
    if (!exportId) throw new AsyncJobFailedError("export returned no exportId", "no_export_id");
    return exportId;
  },
  async poll(ctx, def, exportId) {
    const res = await ctx.ads.call("GetExport", ctx.adsScope, { path: { exportId } } as never, {
      accept: EXPORT_MEDIA[def.exportOperation],
      idempotent: true,
    });
    const body = (res.body ?? {}) as ExportShape;
    if (body.status === "COMPLETED") {
      if (!body.url) throw new AsyncJobFailedError("export completed without a url", "no_url");
      return { ready: true, documentId: body.url };
    }
    if (body.status === "FAILED")
      throw new AsyncJobFailedError(`export ${exportId} failed`, "export_failed");
    return { ready: false, retryAfterMs: polling.adsPollMs };
  },
  async download(ctx, def, _exportId, url) {
    const bytes = await ctx.ads.download(url, { compression: "auto" });
    return [{ bytes, contentType: "application/json", sourceRef: def.exportOperation }];
  },
});

// --- Data Kiosk -------------------------------------------------------------------------------------------------------

export const dataKioskAdapter = (polling: PollingConfig): AsyncJobAdapter<DataKioskDefinition> => ({
  async create(ctx, def) {
    if (!ctx.kiosk)
      throw new AsyncJobFailedError(
        "Data Kiosk is not configured for this worker",
        "kiosk_unavailable",
      );
    return (await ctx.kiosk.createQuery(ctx.spScope, def.query(ctx))).queryId;
  },
  async poll(ctx, _def, queryId) {
    if (!ctx.kiosk)
      throw new AsyncJobFailedError("Data Kiosk is not configured", "kiosk_unavailable");
    const q = await ctx.kiosk.getQuery(ctx.spScope, queryId);
    if (q.status === "DONE") {
      if (!q.documentId)
        throw new AsyncJobFailedError("query DONE without a document", "no_document");
      return { ready: true, documentId: q.documentId };
    }
    if (q.status === "FATAL" || q.status === "CANCELLED")
      throw new AsyncJobFailedError(`query ${queryId} ended as ${q.status}`, "query_failed");
    return { ready: false, retryAfterMs: polling.kioskPollMs };
  },
  async download(ctx, _def, _queryId, documentId) {
    if (!ctx.kiosk)
      throw new AsyncJobFailedError("Data Kiosk is not configured", "kiosk_unavailable");
    const { url } = await ctx.kiosk.getDocument(ctx.spScope, documentId);
    const bytes = await ctx.sp.download(url, { compression: "auto" });
    return [{ bytes, contentType: "application/jsonl", sourceRef: "data-kiosk" }];
  },
});

export function adapterFor(
  family: PullDefinition["family"],
  polling: PollingConfig,
): AsyncJobAdapter<never> | null {
  switch (family) {
    case "spapi-report":
      return spReportAdapter(polling) as AsyncJobAdapter<never>;
    case "ads-report":
      return adsReportAdapter(polling) as AsyncJobAdapter<never>;
    case "ads-export":
      return adsExportAdapter(polling) as AsyncJobAdapter<never>;
    case "data-kiosk":
      return dataKioskAdapter(polling) as AsyncJobAdapter<never>;
    default:
      return null;
  }
}
