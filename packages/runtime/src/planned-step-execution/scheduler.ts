import { estimateAttemptCostUsd, remainingBudgetUsdEstimate } from "@kiwi/core";
import { Initiative, KiwiPolicy, ModelEntry, RunnerNames, Step } from "@kiwi/contracts";
import { previewStepAttempt, saveSchedulerDecision, scheduleStepAttempt } from "../scheduler-policy";
import type { SchedulerDecision } from "../scheduler-policy";
import type { RunnerResolution } from "../runner-registry";
import type { ExecutePlannedStepInput, ExecutionMode } from "./types";
import { ExecutionPolicyResolver } from "./policy";

interface SchedulerDecisionInputParams {
  input: { cwd: string; runId: string };
  step: Step;
  initiative: Initiative;
  runnerResolution: RunnerResolution | null;
  isResearchStep: boolean;
}

export class SchedulerDecisionService {
  constructor(private readonly policyResolver = new ExecutionPolicyResolver()) {}

  scheduleCurrentStepAttempt(params: {
    input: ExecutePlannedStepInput;
    step: Step;
    initiative: Initiative;
    runnerResolution: RunnerResolution | null;
    isResearchStep: boolean;
    now: Date;
  }): SchedulerDecision {
    const decision = scheduleStepAttempt({
      ...this.decisionInput(params),
      now: params.now,
      ...(params.input.attemptId ? { attemptId: params.input.attemptId } : {}),
    });

    if (decision.status !== "scheduled") {
      throw new Error(`Step could not be scheduled: ${decision.blockedReason ?? "unknown"}`);
    }
    if (!decision.runner) {
      throw new Error("Scheduler selected no runner");
    }

    return decision;
  }

  previewStepDecision(params: {
    input: { cwd: string; runId: string; attemptId: string; now?: Date };
    step: Step;
    initiative: Initiative;
    runnerResolution: RunnerResolution | null;
    isResearchStep: boolean;
  }): SchedulerDecision {
    return previewStepAttempt({
      ...this.decisionInput(params),
      attemptId: params.input.attemptId,
      ...(params.input.now ? { now: params.input.now } : {}),
    });
  }

  enrich(params: {
    cwd: string;
    decision: SchedulerDecision;
    policy: KiwiPolicy;
    selectedModel: ModelEntry | null;
    selectedModelId: string | null;
    executorSelectionReason: string | null;
    isolation: ExecutionMode;
  }): SchedulerDecision {
    const enriched: SchedulerDecision = {
      ...params.decision,
      selectedModelId: params.selectedModelId,
      selectedProviderModel: params.selectedModel?.providerModel ?? null,
      selectedAccessMode: params.selectedModel?.accessMode ?? null,
      executorSelectionReason: params.executorSelectionReason,
      estimatedAttemptCostUsd: estimateAttemptCostUsd({
        modelId: params.selectedModelId,
        capability: params.decision.modelCapability,
        contextLevel: params.decision.contextLevel,
      }),
      executionOwner: this.policyResolver.executionOwner(params.policy),
      executionIsolation: params.isolation,
    };
    saveSchedulerDecision(params.cwd, enriched);

    return enriched;
  }

  private decisionInput(params: SchedulerDecisionInputParams) {
    return {
      cwd: params.input.cwd,
      runId: params.input.runId,
      step: params.step,
      initiative: params.initiative,
      budgetProfile: params.initiative.budgetProfile,
      budgetRemainingUsdEstimate: remainingBudgetUsdEstimate({
        cwd: params.input.cwd,
        runId: params.input.runId,
        budgetProfile: params.initiative.budgetProfile,
      }),
      blastRadius: params.initiative.riskProfile === "production" ? ("high" as const) : ("low" as const),
      securitySensitivity: params.initiative.riskProfile === "production" ? ("high" as const) : ("low" as const),
      contextSize: "small" as const,
      runnerAvailability: params.isResearchStep
        ? [RunnerNames.Api]
        : (params.runnerResolution?.runnerAvailability ?? []),
    };
  }
}
