// EX-BUDGET-RULES (D53 named exception) - Ads v0 budget rules, READ ONLY: list the advertiser's rules, get one
// rule, the campaigns attached to a rule, the rules attached to a campaign - for SP, SB and SD. No create /
// update / associate / disassociate operation is generated or exposed: rule writes are not part of the MVP and
// would be a separate exception review. Why v0: Amazon says "keep using v3/v4" for budget rules.
// Watch: refs/amazon-ads/docs/release-notes/ads-api-v1.md for a budget-rule entity.
import type { AdsCallOptions, AdsClient, AdsScope } from "../../ads-client";

export const EX_BUDGET_RULES = "EX-BUDGET-RULES";

export type BudgetRulesProduct = "SP" | "SB" | "SD";

export interface BudgetRulesReadPort {
  list(scope: AdsScope, product: BudgetRulesProduct, options?: AdsCallOptions): Promise<unknown>;
  get(
    scope: AdsScope,
    product: BudgetRulesProduct,
    budgetRuleId: string,
    options?: AdsCallOptions,
  ): Promise<unknown>;
  campaignsOfRule(
    scope: AdsScope,
    product: BudgetRulesProduct,
    budgetRuleId: string,
    options?: AdsCallOptions,
  ): Promise<unknown>;
  rulesOfCampaign(
    scope: AdsScope,
    product: BudgetRulesProduct,
    campaignId: string,
    options?: AdsCallOptions,
  ): Promise<unknown>;
}

export const BUDGET_RULE_READ_OPERATIONS = {
  SP: {
    list: "GetSPBudgetRulesForAdvertiser",
    get: "GetBudgetRuleByRuleIdForSPCampaigns",
    campaigns: "GetCampaignsAssociatedWithSPBudgetRule",
    rules: "ListAssociatedBudgetRulesForSPCampaigns",
  },
  SB: {
    list: "GetSBBudgetRulesForAdvertiser",
    get: "GetBudgetRuleByRuleIdForSBCampaigns",
    campaigns: "GetCampaignsAssociatedWithSBBudgetRule",
    rules: "ListAssociatedBudgetRulesForSBCampaigns",
  },
  SD: {
    list: "GetSDBudgetRulesForAdvertiser",
    get: "GetBudgetRuleByRuleIdForSDCampaigns",
    campaigns: "GetCampaignsAssociatedWithSDBudgetRule",
    rules: "ListAssociatedBudgetRulesForSDCampaigns",
  },
} as const;

export const createBudgetRulesReadPort = (ads: AdsClient): BudgetRulesReadPort => {
  const run = async (op: string, scope: AdsScope, args: unknown, options?: AdsCallOptions) =>
    (
      await ads.call(op as "GetSPBudgetRulesForAdvertiser", scope, args as never, {
        idempotent: true,
        ...options,
      })
    ).body;
  const ops = BUDGET_RULE_READ_OPERATIONS;
  return {
    list: (scope, product, options) => run(ops[product].list, scope, {}, options),
    get: (scope, product, id, options) =>
      run(ops[product].get, scope, { path: { budgetRuleId: id } }, options),
    campaignsOfRule: (scope, product, id, options) =>
      run(ops[product].campaigns, scope, { path: { budgetRuleId: id } }, options),
    rulesOfCampaign: (scope, product, id, options) =>
      run(ops[product].rules, scope, { path: { campaignId: id } }, options),
  };
};
