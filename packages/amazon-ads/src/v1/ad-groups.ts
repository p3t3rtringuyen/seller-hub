import type { AdsClient } from "../ads-client";
import { createEntityAdapter } from "../ports/entity";
import type { BodyOf, EntityPort, ItemOf, ResponseOf } from "../ports/entity";

// v1 adapter for Sponsored Products ad groups (D53 default). Types come from the generated Amazon spec.
export type AdGroupQuery = BodyOf<"SPQueryAdGroup">;
export type AdGroupCreate = ItemOf<BodyOf<"SPCreateAdGroup">, "adGroups">;
export type AdGroupUpdate = ItemOf<BodyOf<"SPUpdateAdGroup">, "adGroups">;
export type AdGroup = ItemOf<ResponseOf<"SPQueryAdGroup">, "adGroups">;

export type AdGroupsPort = EntityPort<AdGroupQuery, AdGroupCreate, AdGroupUpdate, AdGroup>;

export const createAdGroupsPort = (ads: AdsClient): AdGroupsPort =>
  createEntityAdapter(ads, {
    query: "SPQueryAdGroup",
    create: "SPCreateAdGroup",
    update: "SPUpdateAdGroup",
    delete: "SPDeleteAdGroup",
    listKey: "adGroups",
  });
