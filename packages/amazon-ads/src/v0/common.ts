import type { OperationArgs, OperationResponse } from "@seller-hub/amazon-core";
import type { AdsOperationId, AdsOperationTypes } from "../generated/operations";

/** Request arguments (`path` / `query` / `body`) of a generated operation. */
export type ArgsOf<K extends AdsOperationId> = OperationArgs<AdsOperationTypes[K]>;
/** Success body of a generated operation. */
export type BodyOfResponse<K extends AdsOperationId> = OperationResponse<AdsOperationTypes[K]>;
