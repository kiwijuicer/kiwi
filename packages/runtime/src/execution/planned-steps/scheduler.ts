import type { CoreServices } from "@kiwi/core";
import {
  RiskProfiles,
  RunnerNames,
  SchedulerDecisionStatuses,
  type Initiative,
  type KiwiPolicy,
  type ModelEntry,
} from "@kiwi/contracts";
import type { SchedulerDecision, SchedulerPolicyService } from "../../policies/scheduler-policy";
import {
  BlastRadii,
  ContextSizes,
  SecuritySensitivities,
  type BlastRadius,
  type ContextSize,
  type SecuritySensitivity,
} from "../../policies/scheduler-types";
import { ExecutionPolicyResolver } from "./policy";
import type { StepExecutionSession } from "./session";
import type { ExecutionMode } from "./types";

export class SchedulerDecisionService {
  constructor(
    private readonly policyResolver: ExecutionPolicyResolver,
    private readonly schedulerPolicy: SchedulerPolicyService,
    private readonly core: CoreServices,
  ) {}

  schedule(session: StepExecutionSession): SchedulerDecision {
    const decision = this.schedulerPolicy.scheduleStepAttempt({
      ...this.decisionInput(session),
      now: session.now,
      ...(session.input.attemptId ? { attemptId: session.input.attemptId } : {}),
    });

    if (decision.status !== SchedulerDecisionStatuses.Scheduled) {
      throw new Error(`Step could not be scheduled: ${decision.blockedReason ?? "unknown"}`);
    }
    if (!decision.runner) {
      throw new Error("Scheduler selected no runner");
    }
    session.setDecision(decision);

    return decision;
  }

  previewStepDecision(session: StepExecutionSession): SchedulerDecision {
    if (!session.input.attemptId) {
      throw new Error("Preview scheduler decision requires an attempt id");
    }

    return this.schedulerPolicy.previewStepAttempt({
      ...this.decisionInput(session),
      attemptId: session.input.attemptId,
      now: session.now,
    });
  }

  enrich(session: StepExecutionSession, isolation: ExecutionMode): SchedulerDecision {
    const enriched = this.enrichedDecision({
      cwd: session.cwd,
      decision: session.decision,
      policy: session.context.policy,
      selectedModel: session.runnerSelection.selectedModel,
      selectedModelId: session.runnerSelection.selectedModelId,
      executorSelectionReason: session.runnerSelection.executorSelectionReason,
      isolation,
    });
    session.setEnrichedDecision(enriched);

    return enriched;
  }

  private enrichedDecision(params: {
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
      estimatedAttemptCostUsd: this.core.budgets.estimateAttemptCostUsd({
        modelId: params.selectedModelId,
        capability: params.decision.modelCapability,
        contextLevel: params.decision.contextLevel,
      }),
      executionOwner: this.policyResolver.executionOwner(params.policy),
      executionIsolation: params.isolation,
    };
    this.schedulerPolicy.saveSchedulerDecision(params.cwd, enriched);

    return enriched;
  }

  private decisionInput(session: StepExecutionSession) {
    const risk = this.riskFor(session.context.initiative);

    return {
      cwd: session.cwd,
      runId: session.runId,
      step: session.step,
      initiative: session.context.initiative,
      budgetProfile: session.context.initiative.budgetProfile,
      budgetRemainingUsdEstimate: this.core.budgets.remainingUsdEstimate({
        cwd: session.cwd,
        runId: session.runId,
        budgetProfile: session.context.initiative.budgetProfile,
      }),
      blastRadius: risk.blastRadius,
      securitySensitivity: risk.securitySensitivity,
      contextSize: ContextSizes.Small,
      runnerAvailability: session.isResearchStep
        ? [RunnerNames.Api]
        : (session.runnerResolution?.runnerAvailability ?? []),
    };
  }

  private riskFor(initiative: Initiative): {
    blastRadius: BlastRadius;
    securitySensitivity: SecuritySensitivity;
    contextSize: ContextSize;
  } {
    const highRisk = initiative.riskProfile === RiskProfiles.Production;

    return {
      blastRadius: highRisk ? BlastRadii.High : BlastRadii.Low,
      securitySensitivity: highRisk ? SecuritySensitivities.High : SecuritySensitivities.Low,
      contextSize: ContextSizes.Small,
    };
  }
}
