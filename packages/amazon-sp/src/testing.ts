import { fileURLToPath } from "node:url";
import type { Fixture } from "@seller-hub/amazon-core/testing";
import { loadFixtureDir } from "@seller-hub/amazon-core/testing";

/**
 * Replay fixtures for SP-API operations (shaped from the Amazon models in `catalog/spapi`). Feed them to
 * `createReplayTransport({ fixtures: spFixtures() })` for `SH_AMAZON_MODE=replay`, Storybook data and slice tests.
 * Add a JSON file under `packages/amazon-sp/fixtures/` to cover another operation.
 */
export function spFixtures(): Fixture[] {
  return loadFixtureDir(fileURLToPath(new URL("../fixtures", import.meta.url)));
}
