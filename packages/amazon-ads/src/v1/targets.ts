import type { AdsClient } from "../ads-client";
import { createEntityAdapter } from "../ports/entity";
import type { BodyOf, EntityPort, ItemOf, ResponseOf } from "../ports/entity";

// v1 adapter for Sponsored Products targets (D53 default). Types come from the generated Amazon spec.
export type TargetQuery = BodyOf<"SPQueryTarget">;
export type TargetCreate = ItemOf<BodyOf<"SPCreateTarget">, "targets">;
export type TargetUpdate = ItemOf<BodyOf<"SPUpdateTarget">, "targets">;
export type Target = ItemOf<ResponseOf<"SPQueryTarget">, "targets">;

export type TargetsPort = EntityPort<TargetQuery, TargetCreate, TargetUpdate, Target>;

export const createTargetsPort = (ads: AdsClient): TargetsPort =>
  createEntityAdapter(ads, {
    query: "SPQueryTarget",
    create: "SPCreateTarget",
    update: "SPUpdateTarget",
    delete: "SPDeleteTarget",
    listKey: "targets",
  });
