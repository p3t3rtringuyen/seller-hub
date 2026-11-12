// Region routing (D4: NA / EU / FE are data, not branches in code). Sources: docs/discovery/ads-domains.md §1
// (Ads hosts and LWA token endpoints), SP-API regional endpoints (catalog/spapi/apis.json `host`, operations `regions`).

export const REGIONS = ["na", "eu", "fe"] as const;
export type Region = (typeof REGIONS)[number];

export type ApiFamily = "sp" | "ads";

export interface RegionEndpoints {
  /** SP-API production host. */
  spApi: string;
  /** SP-API sandbox host. */
  spApiSandbox: string;
  /** Amazon Ads API host (there is no Ads sandbox host: Ads uses test accounts, EX-TEST-ACCOUNTS). */
  ads: string;
  /** Login with Amazon token endpoint for this region. */
  lwaToken: string;
}

export const REGION_ENDPOINTS: Readonly<Record<Region, RegionEndpoints>> = {
  na: {
    spApi: "https://sellingpartnerapi-na.amazon.com",
    spApiSandbox: "https://sandbox.sellingpartnerapi-na.amazon.com",
    ads: "https://advertising-api.amazon.com",
    lwaToken: "https://api.amazon.com/auth/o2/token",
  },
  eu: {
    spApi: "https://sellingpartnerapi-eu.amazon.com",
    spApiSandbox: "https://sandbox.sellingpartnerapi-eu.amazon.com",
    ads: "https://advertising-api-eu.amazon.com",
    lwaToken: "https://api.amazon.co.uk/auth/o2/token",
  },
  fe: {
    spApi: "https://sellingpartnerapi-fe.amazon.com",
    spApiSandbox: "https://sandbox.sellingpartnerapi-fe.amazon.com",
    ads: "https://advertising-api-fe.amazon.com",
    lwaToken: "https://api.amazon.co.jp/auth/o2/token",
  },
};

export function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (REGIONS as readonly string[]).includes(value);
}

export function parseRegion(value: string | undefined): Region {
  const v = value?.trim().toLowerCase();
  if (!isRegion(v))
    throw new Error(`unknown Amazon region "${value ?? ""}" (expected na | eu | fe)`);
  return v;
}

/** Operating mode (ADR-0006, `SH_AMAZON_MODE`). `replay` never touches the network. */
export const AMAZON_MODES = ["production", "sandbox", "replay"] as const;
export type AmazonMode = (typeof AMAZON_MODES)[number];

export function parseAmazonMode(value: string | undefined): AmazonMode {
  const v = (value ?? "production").trim().toLowerCase();
  if (!(AMAZON_MODES as readonly string[]).includes(v)) {
    throw new Error(`unknown SH_AMAZON_MODE "${value}" (expected production | sandbox | replay)`);
  }
  return v as AmazonMode;
}

export function baseUrlFor(api: ApiFamily, region: Region, mode: AmazonMode): string {
  const e = REGION_ENDPOINTS[region];
  if (api === "ads") return e.ads;
  return mode === "sandbox" ? e.spApiSandbox : e.spApi;
}

export function lwaTokenUrl(region: Region): string {
  return REGION_ENDPOINTS[region].lwaToken;
}
