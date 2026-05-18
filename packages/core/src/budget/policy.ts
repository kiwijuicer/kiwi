import { BudgetProfile, BudgetProfileLimit, ContextLevel, ModelCapability } from "@kiwi/contracts";
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

interface PricePerMillionTokens {
  input: number;
  output: number;
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

const DEFAULT_MODEL_BY_CAPABILITY: Record<ModelCapability, string> = {
  cheap: "claude-haiku-4-5",
  mid: "claude-haiku-4-5",
  strong: "claude-sonnet-4-6",
  frontier: "claude-opus-4-6",
};

function priceForModel(modelId: string): PricePerMillionTokens {
  if (modelId.includes("opus-4-6") || modelId.includes("opus-4-7") || modelId.includes("opus-4-5")) {
    return { input: 5, output: 25 };
  }
  if (modelId.includes("sonnet")) {
    return { input: 3, output: 15 };
  }
  if (modelId.includes("haiku-4-5")) {
    return { input: 1, output: 5 };
  }
  if (modelId.includes("haiku")) {
    return { input: 0.25, output: 1.25 };
  }

  return { input: 3, output: 15 };
}

export function estimateAttemptCostUsd(params: {
  modelId: string | null;
  capability: ModelCapability;
  contextLevel: ContextLevel;
}): number {
  const modelId = params.modelId ?? DEFAULT_MODEL_BY_CAPABILITY[params.capability];
  const price = priceForModel(modelId);
  const inputTokens = INPUT_TOKENS_BY_CONTEXT_LEVEL[params.contextLevel];
  const outputTokens = OUTPUT_TOKENS_BY_CAPABILITY[params.capability];
  const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;

  return Number(usd.toFixed(8));
}

export function assertWithinBudgetEstimate(params: {
  budgetProfile: BudgetProfile;
  remainingUsdEstimate: number | null;
  modelId: string | null;
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
      modelId: params.modelId,
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
    modelId: params.modelId,
    modelCapability: params.modelCapability,
    contextLevel: params.contextLevel,
  });
}
