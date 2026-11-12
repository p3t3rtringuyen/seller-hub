import type { AdsClient } from "../ads-client";
import { createEntityAdapter } from "../ports/entity";
import type { BodyOf, EntityPort, ItemOf, ResponseOf } from "../ports/entity";

// v1 adapter for Sponsored Products ads (D53 default). Types come from the generated Amazon spec.
export type AdQuery = BodyOf<"SPQueryAd">;
export type AdCreate = ItemOf<BodyOf<"SPCreateAd">, "ads">;
export type AdUpdate = ItemOf<BodyOf<"SPUpdateAd">, "ads">;
export type Ad = ItemOf<ResponseOf<"SPQueryAd">, "ads">;

export type AdsPort = EntityPort<AdQuery, AdCreate, AdUpdate, Ad>;

export const createAdsPort = (ads: AdsClient): AdsPort =>
  createEntityAdapter(ads, {
    query: "SPQueryAd",
    create: "SPCreateAd",
    update: "SPUpdateAd",
    delete: "SPDeleteAd",
    listKey: "ads",
  });
