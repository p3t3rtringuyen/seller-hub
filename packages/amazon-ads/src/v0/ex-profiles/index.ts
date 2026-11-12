// EX-PROFILES (D53 named exception) - Ads v0 `profiles-3-0`: listProfiles, getProfileById, updateProfiles.
// Why v0: the profile id is still the scope header on every call and v1 `alternateIds` is unverified.
// Watch: refs/amazon-ads/docs/guides/get-started/getting-started.md (docs/discovery/ads-domains.md §4).
// Swap path: replace this adapter by a v1 QueryAdvertiserAccount-based one; `ProfilesPort` stays.
import type { AdsCallOptions, AdsClient, AdsScope } from "../../ads-client";
import type { ArgsOf, BodyOfResponse } from "../common";

export const EX_PROFILES = "EX-PROFILES";

export type ProfileList = BodyOfResponse<"listProfiles">;
export type ProfileUpdate = ArgsOf<"updateProfiles">;

export interface ProfilesPort {
  list(
    scope: AdsScope,
    query?: ArgsOf<"listProfiles">,
    options?: AdsCallOptions,
  ): Promise<ProfileList>;
  get(
    scope: AdsScope,
    profileId: string | number,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"getProfileById">>;
  update(
    scope: AdsScope,
    request: ProfileUpdate,
    options?: AdsCallOptions,
  ): Promise<BodyOfResponse<"updateProfiles">>;
}

export const createProfilesPort = (ads: AdsClient): ProfilesPort => ({
  list: async (scope, query, options) =>
    (await ads.listProfiles(scope, query, { idempotent: true, ...options })).body,
  get: async (scope, profileId, options) =>
    (
      await ads.getProfileById(
        scope,
        { path: { profileId: Number(profileId) } } as ArgsOf<"getProfileById">,
        {
          idempotent: true,
          ...options,
        },
      )
    ).body,
  // A profile update is a PUT of the full item: repeating it converges, so it is safe to retry.
  update: async (scope, request, options) =>
    (await ads.updateProfiles(scope, request, { idempotent: true, ...options })).body,
});
