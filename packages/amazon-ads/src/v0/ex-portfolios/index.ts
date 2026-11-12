// EX-PORTFOLIOS (D53 named exception) - Ads v0 Portfolios: ListPortfolios, CreatePortfolios, UpdatePortfolios,
// portfolioBudgetUsage. Why v0: v1 has no portfolio entity (campaigns only carry `portfolioId`).
// Watch: refs/amazon-ads/docs/release-notes/ads-api-v1.md ("future vision").
import type { AdsCallOptions, AdsClient, AdsScope } from "../../ads-client";
import type { BatchResult } from "@seller-hub/amazon-core";
import type { BodyOf, ItemOf, ResponseOf } from "../../ports/entity";
import type { ArgsOf, BodyOfResponse } from "../common";

export const EX_PORTFOLIOS = "EX-PORTFOLIOS";

export type PortfolioCreate = ItemOf<BodyOf<"CreatePortfolios">, "portfolios">;
export type PortfolioUpdate = ItemOf<BodyOf<"UpdatePortfolios">, "portfolios">;
/** What a successful create/update item carries back (with `Prefer: return=representation`). */
export type PortfolioItem = ItemOf<ResponseOf<"ListPortfolios">, "portfolios">;

export interface PortfoliosPort {
  list(
    scope: AdsScope,
    request: ArgsOf<"ListPortfolios">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"ListPortfolios">>;
  /** Chunked by the catalogue `batchMax` (100); one result per input, 207 never counts as success as a whole. */
  create(
    scope: AdsScope,
    items: readonly PortfolioCreate[],
    options?: AdsCallOptions,
  ): Promise<BatchResult<PortfolioCreate, PortfolioItem>>;
  update(
    scope: AdsScope,
    items: readonly PortfolioUpdate[],
    options?: AdsCallOptions,
  ): Promise<BatchResult<PortfolioUpdate, PortfolioItem>>;
  budgetUsage(
    scope: AdsScope,
    request: ArgsOf<"portfolioBudgetUsage">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"portfolioBudgetUsage">>;
}

export const createPortfoliosPort = (ads: AdsClient): PortfoliosPort => ({
  list: async (scope, request, options) => (await ads.ListPortfolios(scope, request, options)).body,
  // Writes go through ads.batch: chunking, `Prefer: return=representation`, per-item results (M4).
  create: (scope, items, options) =>
    ads.batch<PortfolioCreate, PortfolioItem>("CreatePortfolios", scope, items, options),
  update: (scope, items, options) =>
    ads.batch<PortfolioUpdate, PortfolioItem>("UpdatePortfolios", scope, items, options),
  budgetUsage: async (scope, request, options) =>
    (await ads.portfolioBudgetUsage(scope, request, options)).body,
});
