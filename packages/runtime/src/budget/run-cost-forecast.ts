import {
  AccessModes,
  ContractValues,
  KiwiPolicy,
  ModelCapability,
  ModelEntry,
  ModelProviders,
  ModelRegistry,
  TaskGraph,
} from "@kiwi/contracts";
import { estimateAttemptCostUsd } from "@kiwi/core";
import { ReviewerProviderRegistry } from "../registries/reviewer-provider-registry.js";
import { RunnerRegistry } from "../registries/runner-registry.js";
import { RunCostForecastStatuses, type RunCostForecastStatus } from "./types.js";

export interface StepCostForecast {
  stepId: string;
  title: string;
  executionCostUsd: number;
  reviewCostUsd: number;
  totalCostUsd: number;
  executorModelId: string | null;
  reviewerModelId: string | null;
  blockedReasons: string[];
}

export interface RunCostForecast {
  status: RunCostForecastStatus;
  estimatedCostUsd: number;
  catalogVersion: string | null;
  blockedReasons: string[];
  phaseCostsUsd: {
    planner: number;
    execution: number;
    review: number;
  };
  selectedModels: {
    plannerModelId: string | null;
  };
  steps: StepCostForecast[];
}

export interface RunCostForecastInput {
  taskGraph: TaskGraph;
  policy: KiwiPolicy;
  registry: ModelRegistry;
  plannerCostUsd?: number;
  plannerModelId?: string | null;
  env?: Record<string, string | undefined>;
}

const CAPABILITY_RANK: Record<ModelCapability, number> = {
  cheap: 0,
  mid: 1,
  strong: 2,
  frontier: 3,
};

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

function forecastEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const next = { ...env };

  delete next.KIWI_TEST_ALLOW_STUB;
  if (next.KIWI_FORCE_ACCESS_MODE === AccessModes.Stub) {
    delete next.KIWI_FORCE_ACCESS_MODE;
  }

  return next;
}

function reviewCapabilityFor(executionCapability: ModelCapability): ModelCapability {
  if (CAPABILITY_RANK[executionCapability] >= CAPABILITY_RANK.strong) {
    return ContractValues.Strong;
  }

  return ContractValues.Mid;
}

function modelCost(model: ModelEntry, capability: ModelCapability): number {
  return estimateAttemptCostUsd({
    model,
    capability,
    contextLevel: "L0",
  });
}

function pricingBlockReason(model: ModelEntry): string | null {
  if (model.provider === ModelProviders.Stub) {
    return null;
  }
  const pricing = model.pricing;
  const missingMetadata =
    !pricing.source || !pricing.sourceUrl || !pricing.sourceVersion || !pricing.pricingLastVerifiedAt;
  const missingPrice = pricing.inputUsdPerMillion === 0 && pricing.outputUsdPerMillion === 0;

  return missingMetadata || missingPrice ? `Missing real pricing for model ${model.id}` : null;
}

export class RunCostForecastService {
  constructor(
    private readonly runnerRegistry = new RunnerRegistry(),
    private readonly reviewerRegistry = new ReviewerProviderRegistry(),
  ) {}

  build(input: RunCostForecastInput): RunCostForecast {
    const env = forecastEnv(input.env ?? process.env);
    const planner = roundUsd(input.plannerCostUsd ?? 0);
    const blockedReasons: string[] = [];
    const steps = input.taskGraph.steps.map((step): StepCostForecast => {
      const runnerResolution = this.runnerRegistry.resolve({
        registryModels: input.registry.models,
        step,
        requestedCapability: step.recommendedModelCapability,
        env,
        preferenceByRole: input.policy.routing.providerPreference,
      });
      const executorSelection = runnerResolution.selectExecutorModel(step.recommendedModelCapability);
      const reviewCapability = reviewCapabilityFor(step.recommendedModelCapability);
      const reviewerSelection = this.reviewerRegistry.select({
        registryModels: input.registry.models,
        policy: input.policy,
        env,
        requestedCapability: reviewCapability,
      });
      const stepBlocks: string[] = [];

      if (!executorSelection.model) {
        stepBlocks.push(`No available executor model for ${step.stepId} (${step.recommendedModelCapability})`);
      }
      if (!reviewerSelection?.model) {
        stepBlocks.push(`No available reviewer model for ${step.stepId} (${reviewCapability})`);
      }
      const executorPricingBlock = executorSelection.model ? pricingBlockReason(executorSelection.model) : null;
      const reviewerPricingBlock = reviewerSelection?.model ? pricingBlockReason(reviewerSelection.model) : null;

      if (executorPricingBlock) {
        stepBlocks.push(executorPricingBlock);
      }
      if (reviewerPricingBlock) {
        stepBlocks.push(reviewerPricingBlock);
      }
      blockedReasons.push(...stepBlocks);
      const executionCostUsd = executorSelection.model
        ? modelCost(executorSelection.model, step.recommendedModelCapability)
        : 0;
      const reviewCostUsd = reviewerSelection?.model ? modelCost(reviewerSelection.model, reviewCapability) : 0;

      return {
        stepId: step.stepId,
        title: step.title,
        executionCostUsd,
        reviewCostUsd,
        totalCostUsd: roundUsd(executionCostUsd + reviewCostUsd),
        executorModelId: executorSelection.model?.id ?? null,
        reviewerModelId: reviewerSelection?.model.id ?? null,
        blockedReasons: stepBlocks,
      };
    });
    const execution = roundUsd(steps.reduce((total, step) => total + step.executionCostUsd, 0));
    const review = roundUsd(steps.reduce((total, step) => total + step.reviewCostUsd, 0));

    return {
      status: blockedReasons.length > 0 ? RunCostForecastStatuses.Blocked : RunCostForecastStatuses.Ok,
      estimatedCostUsd: roundUsd(planner + execution + review),
      catalogVersion: input.registry.catalogVersion ?? null,
      blockedReasons,
      phaseCostsUsd: {
        planner,
        execution,
        review,
      },
      selectedModels: {
        plannerModelId: input.plannerModelId ?? null,
      },
      steps,
    };
  }
}
