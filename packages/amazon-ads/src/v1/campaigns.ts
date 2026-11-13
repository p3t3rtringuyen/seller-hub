import type { AdsClient } from "../ads-client";
import { createEntityAdapter } from "../ports/entity";
import type { BodyOf, EntityPort, ItemOf, ResponseOf } from "../ports/entity";

// v1 adapter for Sponsored Products campaigns (D53 default). Types come from the generated Amazon spec.
export type CampaignQuery = BodyOf<"SPQueryCampaign">;
export type CampaignCreate = ItemOf<BodyOf<"SPCreateCampaign">, "campaigns">;
export type CampaignUpdate = ItemOf<BodyOf<"SPUpdateCampaign">, "campaigns">;
export type Campaign = ItemOf<ResponseOf<"SPQueryCampaign">, "campaigns">;

export type CampaignsPort = EntityPort<CampaignQuery, CampaignCreate, CampaignUpdate, Campaign>;

export const createCampaignsPort = (ads: AdsClient): CampaignsPort =>
  createEntityAdapter(ads, {
    query: "SPQueryCampaign",
    create: "SPCreateCampaign",
    update: "SPUpdateCampaign",
    delete: "SPDeleteCampaign",
    listKey: "campaigns",
  });
