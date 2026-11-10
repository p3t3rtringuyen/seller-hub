# ERD — `core` (with `identity` links)

DDL: `db/design/03_core.sql`. Key columns only; every table except `tenants` carries `tenant_id`
(composite FKs `(tenant_id, x_id)`). `identity.*` is drawn in [erd-identity.md](erd-identity.md).

```mermaid
erDiagram
  users ||--o{ memberships : "has"
  tenants ||--o{ memberships : "has"
  memberships ||--o{ role_grants : "has"
  tenants ||--o{ invitations : "issues"
  tenants ||--o{ seller_accounts : "owns"
  seller_accounts ||--o{ role_grants : "scopes (NULL = all)"
  seller_accounts ||--o{ connections : "spapi | ads"
  connections ||--o{ credentials : "encrypted refresh token"
  connections ||--o{ ads_profiles : "lists"
  seller_accounts ||--o{ seller_account_marketplaces : "sells in"
  ads_profiles |o--o| seller_account_marketplaces : "linked to"
  tenants ||--o{ connect_states : "connect flow"
  tenants ||--o{ user_preferences : "per user"

  tenants {
    uuid id PK
    text name
    bool automation_paused
  }
  memberships {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    text status
  }
  role_grants {
    uuid id PK
    uuid membership_id FK
    text role "owner|admin|manager|analyst|viewer"
    uuid seller_account_id FK "NULL = all"
    text marketplace_id "seam"
  }
  invitations {
    uuid id PK
    text email
    text role
    bytea token_hash
    timestamptz expires_at
  }
  seller_accounts {
    uuid id PK
    uuid tenant_id FK
    text region_code "NA|EU|FE"
    text account_type "seller|vendor"
    text selling_partner_id
  }
  connections {
    uuid id PK
    uuid seller_account_id FK
    text api "spapi|ads"
    text status
  }
  credentials {
    uuid id PK
    uuid connection_id FK
    text kind
    bytea ciphertext "AES-256-GCM"
  }
  ads_profiles {
    uuid id PK
    text amazon_profile_id UK
    text account_type
    text marketplace_id FK
    text time_zone
  }
  seller_account_marketplaces {
    uuid seller_account_id PK
    text marketplace_id PK
    uuid ads_profile_id FK
  }
  connect_states {
    uuid id PK
    bytea state_hash
  }
  user_preferences {
    uuid user_id PK
    text pref_key PK
    jsonb value
  }
```
