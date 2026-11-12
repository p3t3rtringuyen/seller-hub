// EX-CHANGE-HISTORY (D53 named exception) - Ads v0 Changehistory: getHistory (POST /history; SP and SB campaigns).
// Why v0: no v1 history entity. Watch: any v1 events/history entity in the release notes.
import type { AdsCallOptions, AdsClient, AdsScope } from "../../ads-client";
import type { ArgsOf, BodyOfResponse } from "../common";

export const EX_CHANGE_HISTORY = "EX-CHANGE-HISTORY";

export interface HistoryPort {
  get(
    scope: AdsScope,
    request: ArgsOf<"getHistory">,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"getHistory">>;
}

export const createHistoryPort = (ads: AdsClient): HistoryPort => ({
  get: async (scope, request, options) => (await ads.getHistory(scope, request, options)).body,
});
