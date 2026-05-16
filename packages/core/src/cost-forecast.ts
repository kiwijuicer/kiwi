import { ContractValues, ModelCapability, TaskGraph } from "@kiwi/contracts";
import { BUDGET_PROFILE_LIMITS, estimateAttemptCostUsd } from "./budget-policy";

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

export function buildRunCostForecast(params: { taskGraph: TaskGraph; plannerCostUsd?: number }): RunCostForecast {
  const planner = roundUsd(params.plannerCostUsd ?? 0);
  const steps = params.taskGraph.steps.map((step): StepCostForecast => {
    const executionCostUsd = estimateAttemptCostUsd({
      modelId: null,
      capability: step.recommendedModelCapability,
      contextLevel: "L0",
    });
    const reviewCostUsd = estimateAttemptCostUsd({
      modelId: null,
      capability: reviewCapabilityFor(step.recommendedModelCapability),
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
    if (limit.hardCapUsd === null || limit.hardCapUsd >= estimatedCostUsd) return profile;
  }
  return null;
}
