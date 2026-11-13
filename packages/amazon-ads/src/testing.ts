import { fileURLToPath } from "node:url";
import type { Fixture } from "@seller-hub/amazon-core/testing";
import { loadFixtureDir } from "@seller-hub/amazon-core/testing";

/**
 * Replay fixtures for Ads operations (shaped from the Amazon models in `catalog/ads`). Feed them to
 * `createReplayTransport({ fixtures: adsFixtures() })` for `SH_AMAZON_MODE=replay`, Storybook data and slice tests.
 * Add a JSON file under `packages/amazon-ads/fixtures/` to cover another operation.
 */
export function adsFixtures(): Fixture[] {
  return loadFixtureDir(fileURLToPath(new URL("../fixtures", import.meta.url)));
}
