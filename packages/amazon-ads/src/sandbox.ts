/* eslint-disable no-console -- a CLI that talks to the terminal */
// Live check against the Amazon Ads API with YOUR credentials from .env.local (names in .env.example).
//   pnpm --filter @seller-hub/amazon-ads run sandbox       (root alias `pnpm amazon:sandbox`, see docs/reports/P3-CLIENTS.md)
// There is no Ads sandbox host (ADR-0006): this is a read-only `listProfiles` (EX-PROFILES) on the real host of
// your region - use a test account (EX-TEST-ACCOUNTS) if you do not want to touch a live one. It prints counts
// and country codes, never a token, secret or profile id. Not part of the gate (D30).
import { loadEnvFile } from "@seller-hub/config";
import {
  createAmazonRuntime,
  envCredentialSource,
  envRegion,
  parseAmazonMode,
} from "@seller-hub/amazon-core";
import { createAdsClient } from "./ads-client";
import { createProfilesPort } from "./v0";

loadEnvFile();
const mode = parseAmazonMode(process.env.SH_AMAZON_MODE ?? "sandbox");
if (mode === "replay")
  throw new Error("SH_AMAZON_MODE=replay makes no live call; use sandbox or production");

const missing = [
  "ADS_LWA_CLIENT_ID",
  "ADS_LWA_CLIENT_SECRET",
  "ADS_REFRESH_TOKEN",
  "ADS_REGION",
].filter((n) => !process.env[n]);
if (missing.length) {
  console.error(
    `amazon:sandbox (Ads API): set ${missing.join(", ")} in .env.local first (names only shown).`,
  );
  process.exit(2);
}

const region = envRegion("ads");
const { client } = createAmazonRuntime({ credentials: envCredentialSource(), mode });
const profiles = await createProfilesPort(createAdsClient(client)).list({
  tenantId: "sandbox",
  sellerAccountId: "sandbox",
  region,
});
const countries = [...new Set((profiles ?? []).map((p) => p.countryCode))].sort();
console.log(
  `Ads API ${region}: ${(profiles ?? []).length} profile(s) in ${countries.join(", ") || "-"}`,
);
