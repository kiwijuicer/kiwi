import { BudgetProfile, BudgetProfileLimit } from "@kiwi/contracts";
import { readModelInvocations } from "./model-invocations";

export const BUDGET_PROFILE_LIMITS: Record<BudgetProfile, BudgetProfileLimit> = {
  tiny: { profile: "tiny", softCapUsd: 0.25, hardCapUsd: 0.5 },
  small: { profile: "small", softCapUsd: 1, hardCapUsd: 2 },
  normal: { profile: "normal", softCapUsd: 5, hardCapUsd: 10 },
  large: { profile: "large", softCapUsd: 20, hardCapUsd: 50 },
  critical: { profile: "critical", softCapUsd: 100, hardCapUsd: 250 },
};

export function budgetLimitForProfile(profile: BudgetProfile): BudgetProfileLimit {
  return BUDGET_PROFILE_LIMITS[profile];
}

export function estimatedSpentUsd(cwd: string, runId: string): number {
  return readModelInvocations(cwd, runId).reduce((total, invocation) => total + (invocation.estimatedCostUsd ?? 0), 0);
}

export function remainingBudgetUsdEstimate(params: {
  cwd: string;
  runId: string;
  budgetProfile: BudgetProfile;
}): number | null {
  const limit = budgetLimitForProfile(params.budgetProfile);
  if (limit.hardCapUsd === null) return null;
  return Math.max(0, limit.hardCapUsd - estimatedSpentUsd(params.cwd, params.runId));
}

export function remainingBudgetAfterEstimatedCost(params: {
  budgetProfile: BudgetProfile;
  estimatedCostUsd: number;
}): number | null {
  const limit = budgetLimitForProfile(params.budgetProfile);
  if (limit.hardCapUsd === null) return null;
  return Math.max(0, limit.hardCapUsd - params.estimatedCostUsd);
}

export function budgetSoftCapExceeded(params: {
  budgetProfile: BudgetProfile;
  remainingUsdEstimate: number | null;
}): boolean {
  const limit = budgetLimitForProfile(params.budgetProfile);
  if (limit.hardCapUsd === null || params.remainingUsdEstimate === null) return false;
  return limit.hardCapUsd - params.remainingUsdEstimate >= limit.softCapUsd;
}
