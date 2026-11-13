// EX-TARGETING-RECS (D53 named exception) - Ads v0 SponsoredProducts recommendations used by the MVP:
// theme-based bid recommendations, ranked keyword recommendations, product recommendations (ADS-04/06/08).
// Why v0: v1 Recommendations has only 4 types. Watch: the Ads recommendation-types guide in the release notes.
// Pass `accept` to pick a media-type version (the catalogue lists several, newest last).
import type { AdsCallOptions, AdsClient, AdsScope } from "../../ads-client";
import type { ArgsOf, BodyOfResponse } from "../common";

export const EX_TARGETING_RECS = "EX-TARGETING-RECS";

type BidOp = "GetThemeBasedBidRecommendationForAdGroup_v1";

export interface TargetingRecsPort {
  bidRecommendations(
    scope: AdsScope,
    request: ArgsOf<BidOp>,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<BidOp>>;
  keywordRecommendations(
    scope: AdsScope,
    request: ArgsOf<"getRankedKeywordRecommendation">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"getRankedKeywordRecommendation">>;
  productRecommendations(
    scope: AdsScope,
    request: ArgsOf<"getProductRecommendations">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"getProductRecommendations">>;
}

export const createTargetingRecsPort = (ads: AdsClient): TargetingRecsPort => ({
  bidRecommendations: async (scope, request, options) =>
    (await ads.GetThemeBasedBidRecommendationForAdGroup_v1(scope, request, options)).body,
  keywordRecommendations: async (scope, request, options) =>
    (await ads.getRankedKeywordRecommendation(scope, request, options)).body,
  productRecommendations: async (scope, request, options) =>
    (await ads.getProductRecommendations(scope, request, options)).body,
});
