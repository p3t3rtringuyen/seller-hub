import { uuidv7 } from "@seller-hub/core";
import { sql } from "kysely";
import { parseTsv } from "../parsers";
import { defineSpReport } from "../types";

// DEMO definition (not registered: it lives in this package, outside modules/**). It is what a slice's
// `modules/listings/src/sync/<key>/merchant-listings.sync.ts` looks like: the SP-API report
// GET_MERCHANT_LISTINGS_ALL_DATA -> parse the tab-separated file -> upsert into `catalog.listings`.
// The engine tests run it end to end from fixtures (create -> poll -> download -> gunzip -> land -> parse -> upsert).
//
// Columns of the report: catalog/spapi/reports.json (GET_MERCHANT_LISTINGS_ALL_DATA).

export interface ListingRow {
  sku: string;
  asin: string | null;
  title: string | null;
  price: string | null;
  status: string | null;
  fulfillmentChannel: string | null;
  openDate: string | null;
}

const orNull = (v: string | undefined): string | null => (v && v.trim() !== "" ? v.trim() : null);

export default defineSpReport<ListingRow>({
  key: "listings.merchant-listings",
  family: "spapi-report",
  description: "Merchant listings (full report)",
  appliesTo: { api: "sp", accountTypes: ["seller"] },
  scopeKind: "marketplace",
  schedule: { every: "6h", jitter: "30m" },
  operations: ["reports.createReport", "reports.getReport", "reports.getReportDocument"],
  report: (ctx) => ({
    reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
    marketplaceIds: [ctx.scopeKey],
  }),
  parse: (text) =>
    parseTsv(text)
      .filter((r) => (r["seller-sku"] ?? "") !== "")
      .map((r) => ({
        sku: r["seller-sku"] as string,
        asin: orNull(r["asin1"]),
        title: orNull(r["item-name"]),
        price: orNull(r["price"]),
        status: orNull(r["status"]),
        fulfillmentChannel: orNull(r["fulfillment-channel"]),
        openDate: orNull(r["open-date"]),
      })),
  async upsert(ctx, rows) {
    // One multi-row statement per batch (a slice must not copy an N+1 insert: 100k SKUs would be 100k round trips).
    // A report can list a SKU twice; ON CONFLICT cannot touch a row twice in one statement, so keep the last.
    const bySku = new Map(rows.map((r) => [r.sku, r]));
    if (bySku.size === 0) return;
    const values = [...bySku.values()].map(
      (r) =>
        sql`(${uuidv7()}, ${ctx.scope.tenantId}, ${ctx.scope.sellerAccountId}, ${ctx.scopeKey}, ${r.sku},
             ${r.asin}, ${r.title}, ${r.price}::numeric, ${r.status}, ${r.fulfillmentChannel},
             ${r.openDate}::timestamptz, ${ctx.now()})`,
    );
    await sql`
      insert into catalog.listings
        (id, tenant_id, seller_account_id, marketplace_id, seller_sku, asin, item_name, price_amount,
         report_status, fulfillment_channel, open_date, synced_at)
      values ${sql.join(values)}
      on conflict (seller_account_id, marketplace_id, seller_sku) do update set
        asin = excluded.asin, item_name = excluded.item_name, price_amount = excluded.price_amount,
        report_status = excluded.report_status, fulfillment_channel = excluded.fulfillment_channel,
        open_date = excluded.open_date, synced_at = excluded.synced_at, deleted_at = null`.execute(
      ctx.trx,
    );
  },
});
