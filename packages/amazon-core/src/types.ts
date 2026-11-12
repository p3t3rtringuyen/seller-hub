import type { ApiFamily, Region } from "./regions";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** What the client layer needs to know about one Amazon operation. Generated from `catalog/**` (tools/codegen). */
export interface OperationMeta {
  /** `<api>.<operationId>` for SP-API, the catalogue operationId for Ads. Unique inside a package. */
  readonly id: string;
  readonly api: ApiFamily;
  /** API family inside the catalogue (`reports`, `AmazonAdsAPISPCampaignsContract`). */
  readonly family: string;
  readonly method: HttpMethod;
  /** Path template with `{param}` placeholders. */
  readonly path: string;
  /** SP-API: documented steady rate (requests/second) and burst. Absent for 87 operations (use the default). */
  readonly rateLimit?: { readonly rate: number; readonly burst: number };
  /** SP-API: calls that return PII need a Restricted Data Token (D11: refused). */
  readonly restricted?: boolean;
  readonly restrictedReason?: string | null;
  /** SP-API regions per Amazon role pages. ADVISORY ONLY: incomplete for some operations, never enforced (the seller account region routes). */
  readonly regions?: readonly Region[];
  readonly audience?: "seller" | "vendor";
  /** Ads: `v1` or `v0` (v0 only for the named exceptions, D53). */
  readonly generation?: "v1" | "v0";
  /** Ads: exception id (EX-…) for v0 operations that are allowed. */
  readonly exception?: string | null;
  /** Ads: the 207 mapping applies. */
  readonly multiStatus207?: boolean;
  readonly batchField?: string | null;
  readonly batchMax?: number | null;
  /** Ads: media types from the catalogue. */
  readonly accept?: readonly string[];
  readonly contentType?: readonly string[];
  /** Ads: header names this operation takes (client id header differs between v1 and v0). */
  readonly headers?: readonly { readonly name: string; readonly required: boolean }[];
  /** Safe to repeat after a 5xx / timeout without a duplicate effect (reads, and writes with a natural key). */
  readonly idempotent?: boolean;
}

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  /** String (JSON / form) or bytes; undefined for no body. */
  body?: string | Uint8Array | undefined;
  /** Abort after this many ms. */
  timeoutMs?: number | undefined;
}

export interface HttpResponse {
  status: number;
  /** Header names lower-cased. */
  headers: Record<string, string>;
  body: Uint8Array;
}

/** The only door to the network. Production uses `fetchTransport`; tests and `replay` mode use `@seller-hub/amazon-core/testing`. */
export interface HttpTransport {
  send(request: HttpRequest): Promise<HttpResponse>;
}

export const textOf = (body: Uint8Array): string => new TextDecoder().decode(body);

export function jsonOf(response: HttpResponse): unknown {
  const text = textOf(response.body);
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);
