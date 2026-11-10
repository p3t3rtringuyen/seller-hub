-- Up Migration
-- Source: db/design/01_ref.sql (P2-DATA, frozen reference). Verbatim copy; test/migrations-match-design.test.ts keeps them identical.
-- seller-hub data model — 01 ref (global reference data, no tenant, no RLS)
-- Slice: L0 (PLT-04). Marketplace facts are DATA, never code constants (conventions §5/§9, D4).
-- Read-only for sh_app. Seeded here; later changes are migrations.

create table ref.regions (
  code          text primary key check (code in ('NA', 'EU', 'FE')),
  name          text not null,
  -- Endpoints are configuration in packages/amazon-* (ADR-0006); kept here only for display.
  description   text
);
comment on table ref.regions is
  'Amazon API regions. Source: Ads AdvertiserAccounts RegionCode (catalog/ads/definitions/AmazonAdsAPIALLAdvertiserAccountsContract.json), SP-API regional endpoints (docs/discovery/spapi-domains.md cross-cutting rule 4).';

insert into ref.regions (code, name) values
  ('NA', 'North America'), ('EU', 'Europe'), ('FE', 'Far East');

create table ref.currencies (
  code            char(3) primary key,       -- ISO 4217
  minor_units     smallint not null check (minor_units between 0 and 4),
  name            text not null
);
comment on table ref.currencies is
  'ISO 4217 currencies used by Amazon marketplaces. Codes: SPCurrencyCode (catalog/ads/definitions/AmazonAdsAPISPCampaignsContract.json), Marketplace.defaultCurrencyCode (catalog/spapi/definitions/sellers@v1.json). minor_units drive rounding at the edge (conventions §5, JPY 0).';

insert into ref.currencies (code, minor_units, name) values
  ('USD', 2, 'US Dollar'), ('CAD', 2, 'Canadian Dollar'), ('MXN', 2, 'Mexican Peso'), ('BRL', 2, 'Brazilian Real'),
  ('GBP', 2, 'Pound Sterling'), ('EUR', 2, 'Euro'), ('SEK', 2, 'Swedish Krona'), ('PLN', 2, 'Zloty'),
  ('TRY', 2, 'Turkish Lira'), ('AED', 2, 'UAE Dirham'), ('SAR', 2, 'Saudi Riyal'), ('EGP', 2, 'Egyptian Pound'),
  ('INR', 2, 'Indian Rupee'), ('ZAR', 2, 'Rand'), ('JPY', 0, 'Yen'), ('AUD', 2, 'Australian Dollar'),
  ('SGD', 2, 'Singapore Dollar');

create table ref.marketplaces (
  id                 text primary key,                 -- SP-API marketplaceId, e.g. ATVPDKIKX0DER
  region_code        text not null references ref.regions (code),
  country_code       char(2) not null,                 -- ISO 3166-1 alpha-2 (GB, not UK)
  ads_country_code   text not null,                    -- Ads v3 profile countryCode (UK for GB)
  default_currency   char(3) not null references ref.currencies (code),
  time_zone          text not null,                    -- IANA; default, the linked Ads profile's timezone wins
  domain_name        text not null,
  name               text not null,
  is_enabled         boolean not null default false,   -- D4: US enabled first
  unique (country_code)
);
comment on table ref.marketplaces is
  'Amazon marketplaces. Fields follow Marketplace (catalog/spapi/definitions/sellers@v1.json: id, countryCode, defaultCurrencyCode, domainName, name); ads_country_code/time_zone follow Profile.countryCode/timezone (catalog/ads/definitions/profiles-3-0.json). Ids per region from refs/amazon/selling-partner-api-samples/local-ai-sandbox/src/marketplaceIds.ts. time_zone is a default: business dates use the linked Ads profile timezone when present (conventions §6); only US is confirmed by refs/amazon-ads/docs/guides/account-management/authorization/profiles.md.';
comment on column ref.marketplaces.time_zone is
  'Marketplace-local zone for business dates (facts.*.date). Default; core.ads_profiles.time_zone overrides per profile.';

insert into ref.marketplaces (id, region_code, country_code, ads_country_code, default_currency, time_zone, domain_name, name, is_enabled) values
  ('ATVPDKIKX0DER',  'NA', 'US', 'US', 'USD', 'America/Los_Angeles', 'www.amazon.com',     'Amazon.com',    true),
  ('A2EUQ1WTGCTBG2', 'NA', 'CA', 'CA', 'CAD', 'America/Los_Angeles', 'www.amazon.ca',      'Amazon.ca',     false),
  ('A1AM78C64UM0Y8', 'NA', 'MX', 'MX', 'MXN', 'America/Los_Angeles', 'www.amazon.com.mx',  'Amazon.com.mx', false),
  ('A2Q3Y263D00KWC', 'NA', 'BR', 'BR', 'BRL', 'America/Sao_Paulo',   'www.amazon.com.br',  'Amazon.com.br', false),
  ('A1F83G8C2ARO7P', 'EU', 'GB', 'UK', 'GBP', 'Europe/London',       'www.amazon.co.uk',   'Amazon.co.uk',  false),
  ('A1PA6795UKMFR9', 'EU', 'DE', 'DE', 'EUR', 'Europe/Paris',        'www.amazon.de',      'Amazon.de',     false),
  ('A13V1IB3VIYZZH', 'EU', 'FR', 'FR', 'EUR', 'Europe/Paris',        'www.amazon.fr',      'Amazon.fr',     false),
  ('APJ6JRA9NG5V4',  'EU', 'IT', 'IT', 'EUR', 'Europe/Paris',        'www.amazon.it',      'Amazon.it',     false),
  ('A1RKKUPIHCS9HS', 'EU', 'ES', 'ES', 'EUR', 'Europe/Paris',        'www.amazon.es',      'Amazon.es',     false),
  ('A1805IZSGTT6HS', 'EU', 'NL', 'NL', 'EUR', 'Europe/Amsterdam',    'www.amazon.nl',      'Amazon.nl',     false),
  ('AMEN7PMS3EDWL',  'EU', 'BE', 'BE', 'EUR', 'Europe/Brussels',     'www.amazon.com.be',  'Amazon.com.be', false),
  ('A28R8C7NBKEWEA', 'EU', 'IE', 'IE', 'EUR', 'Europe/Dublin',       'www.amazon.ie',      'Amazon.ie',     false),
  ('A2NODRKZP88ZB9', 'EU', 'SE', 'SE', 'SEK', 'Europe/Stockholm',    'www.amazon.se',      'Amazon.se',     false),
  ('A1C3SOZRARQ6R3', 'EU', 'PL', 'PL', 'PLN', 'Europe/Warsaw',       'www.amazon.pl',      'Amazon.pl',     false),
  ('A33AVAJ2PDY3EV', 'EU', 'TR', 'TR', 'TRY', 'Europe/Istanbul',     'www.amazon.com.tr',  'Amazon.com.tr', false),
  ('A2VIGQ35RCS4UG', 'EU', 'AE', 'AE', 'AED', 'Asia/Dubai',          'www.amazon.ae',      'Amazon.ae',     false),
  ('A17E79C6D8DWNP', 'EU', 'SA', 'SA', 'SAR', 'Asia/Riyadh',         'www.amazon.sa',      'Amazon.sa',     false),
  ('ARBP9OOSHTCHU',  'EU', 'EG', 'EG', 'EGP', 'Africa/Cairo',        'www.amazon.eg',      'Amazon.eg',     false),
  ('A21TJRUUN4KGV',  'EU', 'IN', 'IN', 'INR', 'Asia/Kolkata',        'www.amazon.in',      'Amazon.in',     false),
  ('AE08WJ6YKNBMC',  'EU', 'ZA', 'ZA', 'ZAR', 'Africa/Johannesburg', 'www.amazon.co.za',   'Amazon.co.za',  false),
  ('A1VC38T7YXB528', 'FE', 'JP', 'JP', 'JPY', 'Asia/Tokyo',          'www.amazon.co.jp',   'Amazon.co.jp',  false),
  ('A39IBJ37TRP1C6', 'FE', 'AU', 'AU', 'AUD', 'Australia/Sydney',    'www.amazon.com.au',  'Amazon.com.au', false),
  ('A19VAU5U5O7RUS', 'FE', 'SG', 'SG', 'SGD', 'Asia/Singapore',      'www.amazon.sg',      'Amazon.sg',     false);

-- Ads bid / budget bounds by marketplace x ad product x account type (conventions §5, PLT-04, UX-14).
create table ref.ads_limits (
  marketplace_id   text not null references ref.marketplaces (id),
  ad_product       text not null check (ad_product in ('SPONSORED_PRODUCTS', 'SPONSORED_BRANDS', 'SPONSORED_DISPLAY')),
  limit_kind       text not null check (limit_kind in ('keyword_bid', 'default_bid', 'daily_budget', 'lifetime_budget')),
  account_type     text not null default 'any' check (account_type in ('any', 'seller', 'vendor')),
  currency         char(3) not null references ref.currencies (code),
  min_value        numeric(18,4) not null,
  max_value        numeric(18,4) not null,
  source           text not null,
  primary key (marketplace_id, ad_product, limit_kind, account_type),
  check (min_value <= max_value)
);
comment on table ref.ads_limits is
  'Bid/budget bounds as data. Source: refs/amazon-ads/docs/reference/concepts/limits.md ("Bid constraints by marketplace", "Budget constraints by marketplace"). Seeded for SP (MVP); SB/SD rows come with their slices. default_bid for SP ad groups uses the same SP bid range. D59: console validation detail is incomplete — extra limits are added as rows, not code.';

-- SP bids (limits.md "Bid constraints by marketplace", column "Min / Max bid for SP") and
-- SP daily budgets (limits.md "Budget constraints by marketplace / Sponsored Products", "Seller, vendor").
insert into ref.ads_limits (marketplace_id, ad_product, limit_kind, currency, min_value, max_value, source)
select m.id, 'SPONSORED_PRODUCTS', k.kind, m.default_currency, v.bid_min, v.bid_max,
       'refs/amazon-ads/docs/reference/concepts/limits.md#bid-constraints-by-marketplace'
  from (values
    ('US', 0.02, 1000), ('CA', 0.02, 1000), ('MX', 0.1, 20000), ('BR', 0.07, 3700),
    ('GB', 0.02, 1000), ('DE', 0.02, 1000), ('FR', 0.02, 1000), ('IT', 0.02, 1000), ('ES', 0.02, 1000),
    ('NL', 0.02, 1000), ('BE', 0.02, 1000), ('IE', 0.02, 1000), ('SE', 0.18, 9300), ('PL', 0.04, 2000),
    ('TR', 0.05, 2500), ('AE', 0.24, 184), ('SA', 0.10, 3670), ('EG', 0.15, 5.50), ('IN', 1, 5000),
    ('ZA', 1, 7000), ('JP', 2, 100000), ('AU', 0.02, 1410), ('SG', 0.02, 1100)
  ) as v(country, bid_min, bid_max)
  join ref.marketplaces m on m.country_code = v.country
  cross join (values ('keyword_bid'), ('default_bid')) as k(kind);

insert into ref.ads_limits (marketplace_id, ad_product, limit_kind, currency, min_value, max_value, source)
select m.id, 'SPONSORED_PRODUCTS', 'daily_budget', m.default_currency, v.b_min, v.b_max,
       'refs/amazon-ads/docs/reference/concepts/limits.md#budget-constraints-by-marketplace'
  from (values
    ('US', 1, 1000000), ('CA', 1, 1000000), ('MX', 1, 21000000), ('BR', 1.32, 5300000),
    ('GB', 1, 1000000), ('DE', 1, 1000000), ('FR', 1, 1000000), ('IT', 1, 1000000), ('ES', 1, 1000000),
    ('NL', 1, 1000000), ('BE', 1, 1000000), ('IE', 1, 1000000), ('SE', 9, 9300000), ('PL', 2, 2000000),
    ('TR', 2, 2500000), ('AE', 4, 3700000), ('SA', 4, 3700000), ('EG', 7, 7400000), ('IN', 50, 21000000),
    ('ZA', 20, 7000000), ('JP', 100, 21000000), ('AU', 1.4, 1500000), ('SG', 1.39, 1300000)
  ) as v(country, b_min, b_max)
  join ref.marketplaces m on m.country_code = v.country;
-- Note: EG SP max bid 5.50 is copied verbatim from limits.md (looks like a doc typo next to SD 7400); verify before EG launch.

