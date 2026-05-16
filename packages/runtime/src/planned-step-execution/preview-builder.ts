import { estimateAttemptCostUsd } from "@kiwi/core";
import type { Step } from "@kiwi/contracts";
import { ExecutionContextLoader } from "./context";
import { ExecutionPolicyResolver } from "./policy";
import { SchedulerDecisionService } from "./scheduler";
import { StepRunnerSelector } from "./runner-selection";
import { StepExecutionSession } from "./session";
import type { ExecutionRunContext } from "./context";
import {
  PREVIEW_ATTEMPT_ID_PREFIX,
  type ExecutionMode,
  type RunExecutionPreview,
  type RunExecutionPreviewStep,
} from "./types";

export class RunExecutionPreviewBuilder {
  constructor(
    private readonly contextLoader: ExecutionContextLoader,
    private readonly policyResolver: ExecutionPolicyResolver,
    private readonly runnerSelector: StepRunnerSelector,
    private readonly schedulerDecisionService: SchedulerDecisionService,
  ) {}

  build(params: {
    cwd: string;
    runId: string;
    fromStep?: string;
    maxConcurrency?: number;
    now?: Date;
  }): RunExecutionPreview {
    const context = this.contextLoader.load(params);
    const startIndex = params.fromStep
      ? context.taskGraph.steps.findIndex((step) => step.stepId === params.fromStep)
      : 0;

    if (startIndex < 0) {
      throw new Error(`Step not found: ${params.fromStep}`);
    }
    const isolation = this.policyResolver.executionMode(context.policy);

    return {
      runId: context.runId,
      executionOwner: this.policyResolver.executionOwner(context.policy),
      executionIsolation: isolation,
      maxConcurrency: params.maxConcurrency ?? 2,
      subPlans: context.taskGraph.subPlans ?? [],
      steps: context.taskGraph.steps.slice(startIndex).map((step) => this.stepPreview(context, step, isolation)),
    };
  }

  private stepPreview(context: ExecutionRunContext, step: Step, isolation: ExecutionMode): RunExecutionPreviewStep {
    const session = new StepExecutionSession(
      {
        cwd: context.cwd,
        runId: context.runId,
        stepId: step.stepId,
        attemptId: `${PREVIEW_ATTEMPT_ID_PREFIX}${step.stepId.replace("step_", "")}`,
        now: context.now,
      },
      context,
      step,
    );
    session.setRunnerResolution(this.runnerSelector.resolveRunnerResolution(session));
    const decision = this.schedulerDecisionService.previewStepDecision(session);
    session.setDecision(decision);
    const selection = this.runnerSelector.previewSelection({
      decision,
      isResearchStep: session.isResearchStep,
      registryModels: context.registry.models,
      policy: context.policy,
      runnerResolution: session.runnerResolution,
    });
    const preview: RunExecutionPreviewStep = {
      stepId: step.stepId,
      title: step.title,
      type: step.type,
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
      executionOwner: this.policyResolver.executionOwner(context.policy),
      executionIsolation: isolation,
    };

    if (decision.blockedReason) {
      preview.blockedReason = decision.blockedReason;
    }

    return preview;
  }
}
