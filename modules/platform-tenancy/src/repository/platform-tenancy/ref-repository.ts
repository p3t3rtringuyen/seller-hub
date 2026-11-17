import type { Database } from "@seller-hub/db";
import { sql } from "kysely";

// `ref.*` is global read-only reference data (no tenant, no RLS; sh_app has SELECT only). PLT-04: marketplace facts
// and Ads limits are data, never constants. This is the only repository that takes no Scope: there is no tenant data.

export interface MarketplaceRef {
  id: string;
  regionCode: "NA" | "EU" | "FE";
  countryCode: string;
  adsCountryCode: string;
  currency: string;
  timeZone: string;
  domainName: string;
  name: string;
  isEnabled: boolean;
}

export interface AdsLimitRef {
  marketplaceId: string;
  adProduct: string;
  limitKind: string;
  accountType: string;
  currency: string;
  minValue: string;
  maxValue: string;
  source: string;
}

export function refRepository(db: Database) {
  return {
    async listMarketplaces(): Promise<MarketplaceRef[]> {
      const { rows } = await sql<{
        id: string;
        region_code: "NA" | "EU" | "FE";
        country_code: string;
        ads_country_code: string;
        default_currency: string;
        time_zone: string;
        domain_name: string;
        name: string;
        is_enabled: boolean;
      }>`select id, region_code, country_code, ads_country_code, default_currency, time_zone, domain_name, name, is_enabled
           from ref.marketplaces order by country_code`.execute(db);
      return rows.map((r) => ({
        id: r.id,
        regionCode: r.region_code,
        countryCode: r.country_code,
        adsCountryCode: r.ads_country_code,
        currency: r.default_currency,
        timeZone: r.time_zone,
        domainName: r.domain_name,
        name: r.name,
        isEnabled: r.is_enabled,
      }));
    },

    async listAdsLimits(marketplaceId?: string): Promise<AdsLimitRef[]> {
      const { rows } = await sql<{
        marketplace_id: string;
        ad_product: string;
        limit_kind: string;
        account_type: string;
        currency: string;
        min_value: string;
        max_value: string;
        source: string;
      }>`select marketplace_id, ad_product, limit_kind, account_type, currency,
                min_value::text, max_value::text, source
           from ref.ads_limits
          where (${marketplaceId ?? null}::text is null or marketplace_id = ${marketplaceId ?? null})
          order by marketplace_id, ad_product, limit_kind, account_type`.execute(db);
      return rows.map((r) => ({
        marketplaceId: r.marketplace_id,
        adProduct: r.ad_product,
        limitKind: r.limit_kind,
        accountType: r.account_type,
        currency: r.currency,
        minValue: r.min_value,
        maxValue: r.max_value,
        source: r.source,
      }));
    },
  };
}
export type RefRepository = ReturnType<typeof refRepository>;
