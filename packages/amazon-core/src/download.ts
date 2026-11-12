import { gunzipSync } from "node:zlib";
import type { Clock, Random } from "./clock";
import { systemClock } from "./clock";
import { AmazonApiError, AmazonUpstreamError } from "./errors";
import { DEFAULT_RETRY_POLICY, classifyStatus, fullJitterDelayMs } from "./retry";
import type { RetryPolicy } from "./retry";
import type { HttpTransport } from "./types";

// Report and export documents live behind pre-signed URLs (S3). They take NO Authorization header (sending one
// breaks the signature), are fetched with plain GET, retried on 5xx/network, and are usually gzip.

export interface DownloadOptions {
  transport: HttpTransport;
  url: string;
  /** `auto` (default) sniffs the gzip magic number; `gzip` insists; `none` returns the bytes as they are. */
  compression?: "auto" | "gzip" | "none";
  /** Refuse bodies larger than this after decompression (guards against a decompression bomb). Default 512 MiB. */
  maxBytes?: number;
  clock?: Clock;
  random?: Random;
  retry?: RetryPolicy;
}

export const isGzip = (b: Uint8Array): boolean => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

export async function downloadDocument(options: DownloadOptions): Promise<Uint8Array> {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? Math.random;
  const retry = options.retry ?? DEFAULT_RETRY_POLICY;
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    let body: Uint8Array | undefined;
    try {
      const res = await options.transport.send({
        method: "GET",
        url: options.url,
        headers: { accept: "*/*" },
        timeoutMs: 300_000,
      });
      lastStatus = res.status;
      if (res.status >= 200 && res.status < 300) body = res.body;
      else if (classifyStatus(res.status) === "never") {
        // The URL expired or was never valid: the caller must ask Amazon for a fresh one.
        throw new AmazonApiError(
          `document download answered ${res.status}`,
          { status: res.status },
          undefined,
          undefined,
          false,
        );
      }
    } catch (error) {
      if (error instanceof AmazonApiError) throw error;
      if (attempt >= retry.maxAttempts)
        throw new AmazonUpstreamError("document download failed", {}, true, { cause: error });
    }
    if (body) return decode(body, options.compression ?? "auto", maxBytes);
    if (attempt < retry.maxAttempts) await clock.sleep(fullJitterDelayMs(attempt, retry, random));
  }
  throw new AmazonUpstreamError(
    `document download kept failing (last status ${lastStatus})`,
    { status: lastStatus },
    true,
  );
}

function decode(
  body: Uint8Array,
  compression: "auto" | "gzip" | "none",
  maxBytes: number,
): Uint8Array {
  const gz = compression === "gzip" || (compression === "auto" && isGzip(body));
  if (!gz) {
    if (body.length > maxBytes) throw new Error("document larger than the allowed size");
    return body;
  }
  // maxOutputLength makes zlib throw instead of inflating without bound.
  return new Uint8Array(gunzipSync(body, { maxOutputLength: maxBytes }));
}
