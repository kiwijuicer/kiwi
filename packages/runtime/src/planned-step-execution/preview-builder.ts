import {
  estimateAttemptCostUsd,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  loadInitiative,
  loadPolicy,
  loadRegistry,
  loadTaskGraph,
} from "@kiwi/core";
import { Initiative, KiwiPolicy, ModelEntry, Step } from "@kiwi/contracts";
import { ExecutionPolicyResolver } from "./policy";
import { SchedulerDecisionService } from "./scheduler";
import { StepRunnerSelector } from "./runner-selection";
import type { ExecutionMode, RunExecutionPreview, RunExecutionPreviewStep } from "./types";

export class RunExecutionPreviewBuilder {
  private readonly policyResolver = new ExecutionPolicyResolver();
  private readonly runnerSelector = new StepRunnerSelector(this.policyResolver);
  private readonly schedulerDecisionService = new SchedulerDecisionService(this.policyResolver);

  build(params: {
    cwd: string;
    runId: string;
    fromStep?: string;
    maxConcurrency?: number;
    now?: Date;
  }): RunExecutionPreview {
    const policy = loadPolicy(kiwiPolicyPath(params.cwd));
    const registry = loadRegistry(kiwiModelRegistryPath(params.cwd));
    const initiative = loadInitiative(params.runId, params.cwd);
    const taskGraph = loadTaskGraph(params.runId, params.cwd);
    const startIndex = params.fromStep ? taskGraph.steps.findIndex((step) => step.stepId === params.fromStep) : 0;

    if (startIndex < 0) {
      throw new Error(`Step not found: ${params.fromStep}`);
    }
    const isolation = this.policyResolver.executionMode(policy);

    return {
      runId: params.runId,
      executionOwner: this.policyResolver.executionOwner(policy),
      executionIsolation: isolation,
      maxConcurrency: params.maxConcurrency ?? 2,
      subPlans: taskGraph.subPlans ?? [],
      steps: taskGraph.steps.slice(startIndex).map((step) =>
        this.stepPreview({
          input: { cwd: params.cwd, runId: params.runId, ...(params.now ? { now: params.now } : {}) },
          step,
          initiative,
          registryModels: registry.models,
          policy,
          isolation,
        }),
      ),
    };
  }

  private stepPreview(params: {
    input: { cwd: string; runId: string; now?: Date };
    step: Step;
    initiative: Initiative;
    registryModels: ModelEntry[];
    policy: KiwiPolicy;
    isolation: ExecutionMode;
  }): RunExecutionPreviewStep {
    const isResearchStep = params.step.type === "context_discovery";
    const runnerResolution = this.runnerSelector.resolveRunnerResolution({
      isResearchStep,
      registryModels: params.registryModels,
      step: params.step,
      policy: params.policy,
    });
    const decision = this.schedulerDecisionService.previewStepDecision({
      input: {
        cwd: params.input.cwd,
        runId: params.input.runId,
        attemptId: `attempt_preview_${params.step.stepId.replace("step_", "")}`,
        ...(params.input.now ? { now: params.input.now } : {}),
      },
      step: params.step,
      initiative: params.initiative,
      runnerResolution,
      isResearchStep,
    });
    const selection = this.runnerSelector.previewSelection({
      decision,
      isResearchStep,
      registryModels: params.registryModels,
      policy: params.policy,
      runnerResolution,
    });
    const preview: RunExecutionPreviewStep = {
      stepId: params.step.stepId,
      title: params.step.title,
      type: params.step.type,
      status: decision.status,
      agentRole: decision.agentRole,
      modelCapability: decision.modelCapability,
      runner: decision.runner,
      selectedModelId: selection.selectedModelId,
      selectedProviderModel: selection.selectedModel?.providerModel ?? null,
      selectedAccessMode: selection.selectedModel?.accessMode ?? null,
      executorSelectionReason: selection.reason,
      estimatedAttemptCostUsd: estimateAttemptCostUsd({
        modelId: selection.selectedModelId,
        capability: decision.modelCapability,
        contextLevel: decision.contextLevel,
      }),
      reviewDepth: decision.reviewDepth,
      requiredGates: decision.requiredGates,
      routingReason: decision.routingReason,
      contextLevel: decision.contextLevel,
      executionOwner: this.policyResolver.executionOwner(params.policy),
      executionIsolation: params.isolation,
    };

    if (decision.blockedReason) {
      preview.blockedReason = decision.blockedReason;
    }

    return preview;
  }
}
