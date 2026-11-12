// EX-PORTFOLIOS (D53 named exception) - Ads v0 Portfolios: ListPortfolios, CreatePortfolios, UpdatePortfolios,
// portfolioBudgetUsage. Why v0: v1 has no portfolio entity (campaigns only carry `portfolioId`).
// Watch: refs/amazon-ads/docs/release-notes/ads-api-v1.md ("future vision").
import type { AdsCallOptions, AdsClient, AdsScope } from "../../ads-client";
import type { ArgsOf, BodyOfResponse } from "../common";

export const EX_PORTFOLIOS = "EX-PORTFOLIOS";

export interface PortfoliosPort {
  list(
    scope: AdsScope,
    request: ArgsOf<"ListPortfolios">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"ListPortfolios">>;
  create(
    scope: AdsScope,
    request: ArgsOf<"CreatePortfolios">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"CreatePortfolios">>;
  update(
    scope: AdsScope,
    request: ArgsOf<"UpdatePortfolios">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"UpdatePortfolios">>;
  budgetUsage(
    scope: AdsScope,
    request: ArgsOf<"portfolioBudgetUsage">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"portfolioBudgetUsage">>;
}

export const createPortfoliosPort = (ads: AdsClient): PortfoliosPort => ({
  list: async (scope, request, options) => (await ads.ListPortfolios(scope, request, options)).body,
  create: async (scope, request, options) =>
    (await ads.CreatePortfolios(scope, request, options)).body,
  update: async (scope, request, options) =>
    (await ads.UpdatePortfolios(scope, request, options)).body,
  budgetUsage: async (scope, request, options) =>
    (await ads.portfolioBudgetUsage(scope, request, options)).body,
});
