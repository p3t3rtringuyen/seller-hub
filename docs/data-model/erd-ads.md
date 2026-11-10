# ERD — `ads` (Sponsored Products mirror)

DDL: `db/design/05_ads.sql`. All rows carry `tenant_id`, `seller_account_id`; parents are referenced by our
UUID **and** the Amazon id is kept for joins with facts. Metrics are in [erd-facts.md](erd-facts.md).

```mermaid
erDiagram
  ads_profiles ||--o{ portfolios : "v0 EX-PORTFOLIOS"
  ads_profiles ||--o{ sp_campaigns : "v1"
  portfolios |o--o{ sp_campaigns : "portfolioId"
  sp_campaigns ||--o{ sp_campaign_placement_adjustments : "bidAdjustments"
  sp_campaigns ||--o{ sp_ad_groups : "has"
  sp_ad_groups ||--o{ sp_ads : "product ads"
  sp_ad_groups ||--o{ sp_targets : "AD_GROUP level"
  sp_campaigns ||--o{ sp_targets : "CAMPAIGN level negatives"

  portfolios {
    uuid id PK
    text amazon_portfolio_id UK
    text name
    text budget_policy
    numeric budget_amount
  }
  sp_campaigns {
    uuid id PK
    text amazon_campaign_id UK
    text name
    text state "ENABLED|PAUSED|ARCHIVED"
    text_array delivery_reasons
    numeric daily_budget
    text bid_strategy
    bool auto_create_targets
  }
  sp_campaign_placement_adjustments {
    uuid campaign_id PK
    text placement PK
    int percentage "0..900"
  }
  sp_ad_groups {
    uuid id PK
    text amazon_ad_group_id UK
    text name
    text state
    numeric default_bid
  }
  sp_ads {
    uuid id PK
    text amazon_ad_id UK
    text asin
    text sku "NULL for vendors"
    text state
  }
  sp_targets {
    uuid id PK
    text amazon_target_id UK
    text target_level "AD_GROUP|CAMPAIGN"
    text target_type "KEYWORD|PRODUCT|PRODUCT_CATEGORY|THEME|LOCATION"
    bool negative
    text keyword_text
    text match_type
    numeric bid
    jsonb target_details
  }
  ads_profiles {
    uuid id PK
  }
```
