import { BUDGET_PROFILE_LIMITS } from "./policy.js";

export function firstBudgetProfileForCost(estimatedCostUsd: number): string | null {
  for (const [profile, limit] of Object.entries(BUDGET_PROFILE_LIMITS)) {
    if (limit.hardCapUsd === null || limit.hardCapUsd >= estimatedCostUsd) {
      return profile;
    }
  }

  return null;
}
