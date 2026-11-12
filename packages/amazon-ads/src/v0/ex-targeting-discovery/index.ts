// EX-TARGETING-DISCOVERY (D53 named exception) - Ads v0 SponsoredProducts lookups for the campaign builder:
// targetable categories, category refinements, targetable ASIN counts, category recommendations for ASINs,
// brand search (ADS-06/08). Why v0: v1 has no lookup operations. Watch: v1 Targets contracts in the release notes.
import type { AdsCallOptions, AdsClient, AdsScope } from "../../ads-client";
import type { ArgsOf, BodyOfResponse } from "../common";

export const EX_TARGETING_DISCOVERY = "EX-TARGETING-DISCOVERY";

export interface TargetingDiscoveryPort {
  categories(
    scope: AdsScope,
    request?: ArgsOf<"getTargetableCategories">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"getTargetableCategories">>;
  refinements(
    scope: AdsScope,
    request: ArgsOf<"getRefinementsForCategory">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"getRefinementsForCategory">>;
  asinCounts(
    scope: AdsScope,
    request: ArgsOf<"getTargetableASINCounts">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"getTargetableASINCounts">>;
  categoryRecommendations(
    scope: AdsScope,
    request: ArgsOf<"getCategoryRecommendationsForASINs">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"getCategoryRecommendationsForASINs">>;
  searchBrands(
    scope: AdsScope,
    request: ArgsOf<"searchBrands">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"searchBrands">>;
}

export const createTargetingDiscoveryPort = (ads: AdsClient): TargetingDiscoveryPort => ({
  categories: async (scope, request, options) =>
    (await ads.getTargetableCategories(scope, request, options)).body,
  refinements: async (scope, request, options) =>
    (await ads.getRefinementsForCategory(scope, request, options)).body,
  asinCounts: async (scope, request, options) =>
    (await ads.getTargetableASINCounts(scope, request, options)).body,
  categoryRecommendations: async (scope, request, options) =>
    (await ads.getCategoryRecommendationsForASINs(scope, request, options)).body,
  searchBrands: async (scope, request, options) =>
    (await ads.searchBrands(scope, request, options)).body,
});
