// The D53 exception table, as code. Every v0 operation the package can call must appear in the generated
// `ADS_V0_EXCEPTIONS` under one of these named exceptions; a test compares this table with the generated
// operations and with the catalogue (domain-map.json), so adding a v0 call without naming its exception fails.
import { EX_BUDGET_RULES } from "./ex-budget-rules";
import { EX_CHANGE_HISTORY } from "./ex-change-history";
import { EX_EXPORTS } from "./ex-exports";
import { EX_PORTFOLIOS } from "./ex-portfolios";
import { EX_PROFILES } from "./ex-profiles";
import { EX_TARGETING_DISCOVERY } from "./ex-targeting-discovery";
import { EX_TARGETING_RECS } from "./ex-targeting-recs";

export interface ExceptionEntry {
  id: string;
  /** Folder under src/v0/. */
  adapter: string;
  /** Where Amazon will announce the v1 equivalent (docs/discovery/ads-domains.md §4 "Watch"). */
  watch: string;
}

export const V0_EXCEPTIONS: readonly ExceptionEntry[] = [
  { id: EX_PROFILES, adapter: "ex-profiles", watch: "docs/guides/get-started/getting-started.md" },
  { id: EX_EXPORTS, adapter: "ex-exports", watch: "docs/release-notes/deprecations.md" },
  { id: EX_PORTFOLIOS, adapter: "ex-portfolios", watch: "docs/release-notes/ads-api-v1.md" },
  { id: EX_TARGETING_RECS, adapter: "ex-targeting-recs", watch: "recommendation-types.md" },
  {
    id: EX_TARGETING_DISCOVERY,
    adapter: "ex-targeting-discovery",
    watch: "v1 Targets contracts (release notes)",
  },
  {
    id: EX_CHANGE_HISTORY,
    adapter: "ex-change-history",
    watch: "docs/release-notes/ads-api-v1.md (events/history)",
  },
  {
    id: EX_BUDGET_RULES,
    adapter: "ex-budget-rules",
    watch: "docs/release-notes/ads-api-v1.md (budget-rule entity)",
  },
];
