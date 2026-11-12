import { createFetchTransport } from "./fetch-transport";
import type { AmazonMode } from "./regions";
import { parseAmazonMode } from "./regions";
import type { HttpTransport } from "./types";

/**
 * Resolves mode + transport. Mode comes from the option, else `SH_AMAZON_MODE`, else `production`.
 * `replay` never defaults to the network: it needs an explicit (fixture) transport.
 */
export function fetchTransportFromEnv(
  mode: AmazonMode | undefined,
  transport: HttpTransport | undefined,
  env: Record<string, string | undefined> = process.env,
): { mode: AmazonMode; transport: HttpTransport } {
  const resolved = mode ?? parseAmazonMode(env.SH_AMAZON_MODE);
  if (resolved === "replay") {
    if (!transport) {
      throw new Error(
        "SH_AMAZON_MODE=replay needs a fixture transport (import { createReplayTransport } from '@seller-hub/amazon-core/testing')",
      );
    }
    return { mode: resolved, transport };
  }
  return { mode: resolved, transport: transport ?? createFetchTransport() };
}
