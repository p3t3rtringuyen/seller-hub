import { PiiDisabled } from "@seller-hub/amazon-core";

// D11: no PII flows in the MVP. The catalogue flags 30 SP-API operations `restricted` (they need a Restricted
// Data Token to return buyer data). The transport refuses all of them by default (fail closed). This file holds
// the few cases where a restricted operation is safe to call *because the request itself carries no PII data
// element*, and the report types the client will not create.
//
// Without an RDT, Amazon answers restricted operations with redacted data (docs/discovery/spapi-domains.md
// cross-cutting 3), so a mistake here degrades to redacted data, not to a PII leak - but the client still
// refuses, so nothing relies on that.

export interface RestrictionVerdict {
  /** `null` = nothing to refuse; the string is why the request was judged PII-free. */
  allowedBecause: string | null;
  /** Set when the call must not be made. */
  refuse?: string;
}

/** `includedData` values on orders@2026-01-01 that return buyer or recipient data. */
const ORDER_PII_ELEMENTS = new Set(["BUYER", "RECIPIENT"]);

/**
 * Report types that return buyer data (shipping address, invoicing/tax details, Easy Ship, end-user data).
 * Conservative pattern list, held as data: it refuses MORE than Amazon's restricted-reports list, never less.
 * Confirm against Amazon's current "restricted reports" list when D11 changes.
 */
export const PII_REPORT_TYPE_PATTERNS: readonly RegExp[] = [
  /_(SHIPPING|INVOICING|TAX)$/,
  /ACTIONABLE_ORDER_DATA/,
  /^GET_EASYSHIP_/,
  /^GET_GST_MTR_/,
  /^GET_VAT_TRANSACTION_DATA$/,
  /^SC_VAT_TAX_REPORT$/,
  /^END_USER_DATA_REPORT$/,
  /^GET_AMAZON_FULFILLED_SHIPMENTS_DATA_/,
  /CUSTOMER_SHIPMENT/,
];

export const isPiiReportType = (reportType: string): boolean =>
  PII_REPORT_TYPE_PATTERNS.some((p) => p.test(reportType));

function includedData(query: unknown): string[] {
  if (typeof query !== "object" || query === null) return [];
  const v = (query as Record<string, unknown>).includedData;
  if (Array.isArray(v)) return v.map((e) => String(e).trim().toUpperCase());
  if (typeof v === "string") return v.split(",").map((e) => e.trim().toUpperCase());
  return [];
}

/** Decides what a restricted-or-sensitive operation may do. Pure; the SP client calls it before every call. */
export function checkRestriction(
  operationId: string,
  restricted: boolean,
  request: { query?: unknown; body?: unknown },
  context: { reportType?: string | undefined } = {},
): RestrictionVerdict {
  if (operationId === "tokens.createRestrictedDataToken") {
    return { allowedBecause: null, refuse: "Restricted Data Token flow is disabled (D11)" };
  }
  if (operationId === "reports.createReport" || operationId === "reports.createReportSchedule") {
    const type = (request.body as { reportType?: unknown } | undefined)?.reportType;
    if (typeof type === "string" && isPiiReportType(type)) {
      return { allowedBecause: null, refuse: `report type ${type} returns buyer data (D11)` };
    }
    return { allowedBecause: null };
  }
  if (operationId === "orders.getOrder" || operationId === "orders.searchOrders") {
    const bad = includedData(request.query).filter((e) => ORDER_PII_ELEMENTS.has(e));
    return bad.length
      ? { allowedBecause: null, refuse: `includedData ${bad.join(",")} returns buyer data (D11)` }
      : { allowedBecause: "no BUYER/RECIPIENT in includedData" };
  }
  if (operationId === "reports.getReportDocument") {
    // A document id can come from createReport, a schedule or getReports, so its report type must be stated by
    // the caller and be non-PII. An unknown type is refused (fail closed, M1).
    const type = context.reportType;
    if (!type) {
      return {
        allowedBecause: null,
        refuse:
          "getReportDocument needs the report type (pass { reportType }) to prove the report has no buyer data (D11)",
      };
    }
    if (isPiiReportType(type)) {
      return { allowedBecause: null, refuse: `report type ${type} returns buyer data (D11)` };
    }
    return { allowedBecause: `document of non-PII report type ${type}` };
  }
  if (!restricted) return { allowedBecause: null };

  return { allowedBecause: null, refuse: "operation is flagged restricted in the catalogue (D11)" };
}

/** Stub for the Restricted Data Token flow. Wired only if D11 turns PII on; until then it always refuses. */
export function withRestrictedDataToken(_dataElements: readonly string[]): never {
  throw new PiiDisabled("tokens.createRestrictedDataToken", "RDT flow not enabled (D11)");
}
