import { BudgetProfile, BudgetProfileLimit, ContextLevel, ModelCapability, ModelEntry } from "@kiwi/contracts";
import { BudgetExceededError } from "../errors";
import { readModelInvocations } from "../ledger/model-invocations";

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

  if (limit.hardCapUsd === null) {
    return null;
  }

  return Math.max(0, limit.hardCapUsd - estimatedSpentUsd(params.cwd, params.runId));
}

export function remainingBudgetAfterEstimatedCost(params: {
  budgetProfile: BudgetProfile;
  estimatedCostUsd: number;
}): number | null {
  const limit = budgetLimitForProfile(params.budgetProfile);

  if (limit.hardCapUsd === null) {
    return null;
  }

  return Math.max(0, limit.hardCapUsd - params.estimatedCostUsd);
}

export function budgetSoftCapExceeded(params: {
  budgetProfile: BudgetProfile;
  remainingUsdEstimate: number | null;
}): boolean {
  const limit = budgetLimitForProfile(params.budgetProfile);

  if (limit.hardCapUsd === null || params.remainingUsdEstimate === null) {
    return false;
  }

  return limit.hardCapUsd - params.remainingUsdEstimate >= limit.softCapUsd;
}

// Conservative context-level input token budgets for pre-flight guarding.
const INPUT_TOKENS_BY_CONTEXT_LEVEL: Record<ContextLevel, number> = {
  L0: 2_000,
  L1: 8_000,
  L2: 20_000,
  L3: 40_000,
};

// Conservative output token budgets by capability tier.
const OUTPUT_TOKENS_BY_CAPABILITY: Record<ModelCapability, number> = {
  cheap: 1_000,
  mid: 2_000,
  strong: 4_000,
  frontier: 6_000,
};

export function estimateAttemptCostUsd(params: {
  model: Pick<ModelEntry, "pricing">;
  capability: ModelCapability;
  contextLevel: ContextLevel;
}): number {
  const price = params.model.pricing;
  const inputTokens = INPUT_TOKENS_BY_CONTEXT_LEVEL[params.contextLevel];
  const outputTokens = OUTPUT_TOKENS_BY_CAPABILITY[params.capability];
  const usd = (inputTokens * price.inputUsdPerMillion + outputTokens * price.outputUsdPerMillion) / 1_000_000;

  return Number(usd.toFixed(8));
}

export function assertWithinBudgetEstimate(params: {
  budgetProfile: BudgetProfile;
  remainingUsdEstimate: number | null;
  model: Pick<ModelEntry, "id" | "providerModel" | "pricing">;
  modelCapability: ModelCapability;
  contextLevel: ContextLevel;
  estimateAttemptCostUsdValue?: number;
}): void {
  if (params.remainingUsdEstimate === null) {
    return;
  }
  const estimate =
    params.estimateAttemptCostUsdValue ??
    estimateAttemptCostUsd({
      model: params.model,
      capability: params.modelCapability,
      contextLevel: params.contextLevel,
    });

  if (params.remainingUsdEstimate >= estimate) {
    return;
  }

  throw new BudgetExceededError({
    budgetProfile: params.budgetProfile,
    remainingUsdEstimate: params.remainingUsdEstimate,
    estimatedAttemptCostUsd: estimate,
    modelId: params.model.providerModel ?? params.model.id,
    modelCapability: params.modelCapability,
    contextLevel: params.contextLevel,
  });
}
