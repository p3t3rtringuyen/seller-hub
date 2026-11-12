/* eslint-disable no-console -- a CLI that talks to the terminal */
// Live check against the SP-API SANDBOX with YOUR credentials from .env.local (names in .env.example).
//   pnpm --filter @seller-hub/amazon-sp run sandbox        (root alias `pnpm amazon:sandbox`, see docs/reports/P3-CLIENTS.md)
// One read-only call (sellers.getMarketplaceParticipations). Prints counts and status, never a token or secret.
// Not part of the gate: CI has no credentials and makes no live call (D30).
import { loadEnvFile } from "@seller-hub/config";
import {
  createAmazonRuntime,
  envCredentialSource,
  envRegion,
  parseAmazonMode,
} from "@seller-hub/amazon-core";
import { createSpClient } from "./sp-client";

loadEnvFile();
const mode = parseAmazonMode(process.env.SH_AMAZON_MODE ?? "sandbox");
if (mode === "replay")
  throw new Error("SH_AMAZON_MODE=replay makes no live call; use sandbox or production");

const missing = [
  "SPAPI_LWA_CLIENT_ID",
  "SPAPI_LWA_CLIENT_SECRET",
  "SPAPI_REFRESH_TOKEN",
  "SPAPI_REGION",
].filter((n) => !process.env[n]);
if (missing.length) {
  console.error(
    `amazon:sandbox (SP-API): set ${missing.join(", ")} in .env.local first (names only shown).`,
  );
  process.exit(2);
}

const region = envRegion("sp");
const { client } = createAmazonRuntime({ credentials: envCredentialSource(), mode });
const sp = createSpClient(client);
const res = await sp.sellers.getMarketplaceParticipations({
  tenantId: "sandbox",
  sellerAccountId: "sandbox",
  region,
});
console.log(
  `SP-API ${mode}/${region}: HTTP ${res.status}, ${res.body?.payload?.length ?? 0} marketplace participation(s), request ${res.requestId ?? "-"}`,
);
