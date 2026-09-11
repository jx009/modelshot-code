import { CATALOG } from "../domain/billing/catalog.js";
import { usageSummary } from "../domain/billing/ledger.js";

export const SUBSCRIPTION_PLANS = {
  free: { id: "free", name: "Free", monthlyQuota: 10, priceUsd: 0 },
  ...Object.fromEntries(Object.values(CATALOG).filter(plan => plan.type === "subscription").map(plan => [plan.plan, { id: plan.plan, name: plan.name, monthlyQuota: plan.quota, priceUsd: plan.amountMinor / 100 }])),
};
export const UserService = { getUsageSummary: usageSummary };
