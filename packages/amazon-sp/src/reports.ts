import { AmazonClientError, AmazonUpstreamError } from "@seller-hub/amazon-core";
import type { SpClient, SpScope } from "./sp-client";

// SP-API report flow: createReport → poll getReport → getReportDocument → download → gunzip.
// createReport is rate-limited hard (0.0167 rps, burst 15), so this helper creates exactly once, then only polls
// getReport (2 rps). The caller decides how long it may wait; a worker that cannot block should call the three
// steps separately and persist the reportId between job runs.

export interface RunReportRequest {
  reportType: string;
  marketplaceIds: readonly string[];
  dataStartTime?: string;
  dataEndTime?: string;
  reportOptions?: Record<string, string>;
}

export interface ReportOutcome {
  reportId: string;
  reportDocumentId: string;
  document: Uint8Array;
  text(): string;
}

export interface RunReportOptions {
  /** Poll interval. Default 30 s: reports take minutes, getReport is cheap but pointless to hammer. */
  pollIntervalMs?: number;
  /** Give up after this long. Default 30 min. */
  timeoutMs?: number;
}

export class ReportFailedError extends AmazonClientError {
  constructor(
    readonly reportId: string,
    readonly processingStatus: string,
  ) {
    super(`report ${reportId} ended as ${processingStatus}`);
  }
}

export class ReportTimeoutError extends AmazonUpstreamError {
  constructor(readonly reportId: string) {
    super(`report ${reportId} was not ready in time`, {}, true);
  }
}

interface ReportDocumentBody {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: "GZIP";
}

export async function runReport(
  sp: SpClient,
  scope: SpScope,
  request: RunReportRequest,
  options: RunReportOptions = {},
): Promise<ReportOutcome> {
  const pollMs = options.pollIntervalMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const started = sp.now();

  const created = await sp.reports.createReport(scope, {
    body: {
      reportType: request.reportType,
      marketplaceIds: [...request.marketplaceIds],
      ...(request.dataStartTime ? { dataStartTime: request.dataStartTime } : {}),
      ...(request.dataEndTime ? { dataEndTime: request.dataEndTime } : {}),
      ...(request.reportOptions ? { reportOptions: request.reportOptions } : {}),
    },
  });
  const reportId = (created.body as { reportId?: string } | undefined)?.reportId;
  if (!reportId)
    throw new AmazonUpstreamError(
      "createReport returned no reportId",
      { operation: "reports.createReport", api: "sp" },
      true,
    );

  for (;;) {
    const report = (await sp.reports.getReport(scope, { path: { reportId } })).body as {
      processingStatus?: string;
      reportDocumentId?: string;
    };
    const status = report.processingStatus ?? "UNKNOWN";
    if (status === "DONE") {
      if (!report.reportDocumentId) throw new ReportFailedError(reportId, "DONE_WITHOUT_DOCUMENT");
      return await fetchDocument(sp, scope, reportId, report.reportDocumentId, request.reportType);
    }
    if (status === "CANCELLED" || status === "FATAL") throw new ReportFailedError(reportId, status);
    if (sp.now() - started + pollMs > timeoutMs) throw new ReportTimeoutError(reportId);
    await sp.sleep(pollMs);
  }
}

export async function fetchDocument(
  sp: SpClient,
  scope: SpScope,
  reportId: string,
  reportDocumentId: string,
  reportType: string,
): Promise<ReportOutcome> {
  const doc = (
    await sp.reports.getReportDocument(scope, { path: { reportDocumentId } }, { reportType })
  ).body as ReportDocumentBody;
  const document = await sp.download(doc.url, {
    compression: doc.compressionAlgorithm === "GZIP" ? "auto" : "none",
  });
  return { reportId, reportDocumentId, document, text: () => new TextDecoder().decode(document) };
}
