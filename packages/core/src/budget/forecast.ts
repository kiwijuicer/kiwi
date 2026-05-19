import { AgentRole, ContractValues, ModelCapability, ModelEntry, TaskGraph } from "@kiwi/contracts";
import { BUDGET_PROFILE_LIMITS, estimateAttemptCostUsd } from "./policy";

export interface StepCostForecast {
  stepId: string;
  title: string;
  executionCostUsd: number;
  reviewCostUsd: number;
  totalCostUsd: number;
}

export interface RunCostForecast {
  estimatedCostUsd: number;
  phaseCostsUsd: {
    planner: number;
    execution: number;
    review: number;
  };
  steps: StepCostForecast[];
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

function reviewCapabilityFor(executionCapability: ModelCapability): ModelCapability {
  if (executionCapability === ContractValues.Frontier || executionCapability === ContractValues.Strong) {
    return ContractValues.Strong;
  }

  return ContractValues.Mid;
}

const CAPABILITY_RANK: Record<ModelCapability, number> = {
  cheap: 0,
  mid: 1,
  strong: 2,
  frontier: 3,
};

function cheapestModelFor(params: {
  models: ModelEntry[];
  role: AgentRole;
  capability: ModelCapability;
}): ModelEntry | null {
  const requestedRank = CAPABILITY_RANK[params.capability];
  const candidates = params.models
    .filter(
      (model) =>
        model.enabled &&
        model.roles.includes(params.role) &&
        CAPABILITY_RANK[model.capability] >= requestedRank,
    )
    .sort((a, b) => {
      const aCost = estimateAttemptCostUsd({ model: a, capability: params.capability, contextLevel: "L0" });
      const bCost = estimateAttemptCostUsd({ model: b, capability: params.capability, contextLevel: "L0" });

      return aCost - bCost;
    });

  return candidates[0] ?? null;
}

function zeroPriceModel(): Pick<ModelEntry, "pricing"> {
  return { pricing: { currency: "USD", inputUsdPerMillion: 0, outputUsdPerMillion: 0 } };
}

export function buildRunCostForecast(params: {
  taskGraph: TaskGraph;
  plannerCostUsd?: number;
  registryModels?: ModelEntry[];
}): RunCostForecast {
  const planner = roundUsd(params.plannerCostUsd ?? 0);
  const steps = params.taskGraph.steps.map((step): StepCostForecast => {
    const registryModels = params.registryModels ?? [];
    const executionModel = cheapestModelFor({
      models: registryModels,
      role: ContractValues.Executor,
      capability: step.recommendedModelCapability,
    });
    const reviewCapability = reviewCapabilityFor(step.recommendedModelCapability);
    const reviewerModel = cheapestModelFor({
      models: registryModels,
      role: ContractValues.Reviewer,
      capability: reviewCapability,
    });
    const executionCostUsd = estimateAttemptCostUsd({
      model: executionModel ?? zeroPriceModel(),
      capability: step.recommendedModelCapability,
      contextLevel: "L0",
    });
    const reviewCostUsd = estimateAttemptCostUsd({
      model: reviewerModel ?? zeroPriceModel(),
      capability: reviewCapability,
      contextLevel: "L0",
    });

    return {
      stepId: step.stepId,
      title: step.title,
      executionCostUsd,
      reviewCostUsd,
      totalCostUsd: roundUsd(executionCostUsd + reviewCostUsd),
    };
  });
  const execution = roundUsd(steps.reduce((total, step) => total + step.executionCostUsd, 0));
  const review = roundUsd(steps.reduce((total, step) => total + step.reviewCostUsd, 0));

  return {
    estimatedCostUsd: roundUsd(planner + execution + review),
    phaseCostsUsd: {
      planner,
      execution,
      review,
    },
    steps,
  };
}

export function firstBudgetProfileForCost(estimatedCostUsd: number): string | null {
  for (const [profile, limit] of Object.entries(BUDGET_PROFILE_LIMITS)) {
    if (limit.hardCapUsd === null || limit.hardCapUsd >= estimatedCostUsd) {
      return profile;
    }
  }

  return null;
}
