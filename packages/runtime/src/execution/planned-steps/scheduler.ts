import type { CoreServices } from "@kiwi/core";
import {
  RiskProfiles,
  RunnerNames,
  SchedulerDecisionStatuses,
  StepTypes,
  type Initiative,
  type KiwiPolicy,
  type ModelEntry,
  type Step,
} from "@kiwi/contracts";
import type { SchedulerDecision, SchedulerPolicyService } from "../../policies/scheduler-policy.js";
import {
  BlastRadii,
  ContextSizes,
  SecuritySensitivities,
  type BlastRadius,
  type ContextSize,
  type SecuritySensitivity,
} from "../../policies/scheduler-types.js";
import { CONTEXT_RETRIEVAL_STRATEGY_VERSION, ExecutionContextRetriever } from "./context-retriever.js";
import { ExecutionPolicyResolver } from "./policy.js";
import type { StepExecutionSession } from "./session.js";
import type { ExecutionMode } from "./types.js";

export class SchedulerDecisionService {
  constructor(
    private readonly policyResolver: ExecutionPolicyResolver,
    private readonly schedulerPolicy: SchedulerPolicyService,
    private readonly core: CoreServices,
    private readonly contextRetriever = new ExecutionContextRetriever(),
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
      ...(params.selectedModel
        ? {
            estimatedAttemptCostUsd: this.core.budgets.estimateAttemptCostUsd({
              model: params.selectedModel,
              capability: params.decision.modelCapability,
              contextLevel: params.decision.contextLevel,
            }),
          }
        : {}),
      executionOwner: this.policyResolver.executionOwner(params.policy),
      executionIsolation: params.isolation,
    };
    this.schedulerPolicy.saveSchedulerDecision(params.cwd, enriched);
    this.saveEnrichedContextPackage(params.cwd, enriched);

    return enriched;
  }

  private saveEnrichedContextPackage(cwd: string, decision: SchedulerDecision): void {
    const contextPackage = this.schedulerPolicy.loadContextPackage({
      cwd,
      runId: decision.runId,
      stepId: decision.stepId,
      attemptId: decision.attemptId,
    });
    this.schedulerPolicy.saveContextPackage(cwd, {
      ...contextPackage,
      budget: {
        modelCapability: decision.modelCapability,
        contextLevel: decision.contextLevel,
        selectedModelId: decision.selectedModelId ?? null,
        selectedProviderModel: decision.selectedProviderModel ?? null,
        estimatedAttemptCostUsd: decision.estimatedAttemptCostUsd ?? null,
      },
    });
  }

  private decisionInput(session: StepExecutionSession) {
    const retrieved = this.contextRetriever.retrieve({
      repoPath: session.context.repoPath,
      initiative: session.context.initiative,
      step: session.step,
    });
    const relevantFiles = retrieved.relevantFiles;
    const risk = this.riskFor(session.context.initiative, session.context.policy, session.step, relevantFiles);

    return {
      cwd: session.cwd,
      runId: session.runId,
      step: session.step,
      initiative: session.context.initiative,
      taskGraph: session.context.taskGraph,
      policy: session.context.policy,
      budgetProfile: session.context.initiative.budgetProfile,
      budgetRemainingUsdEstimate: this.core.budgets.remainingUsdEstimate({
        cwd: session.cwd,
        runId: session.runId,
        budgetProfile: session.context.initiative.budgetProfile,
      }),
      blastRadius: risk.blastRadius,
      securitySensitivity: risk.securitySensitivity,
      contextSize: risk.contextSize,
      runnerAvailability: session.isResearchStep
        ? [RunnerNames.Api]
        : (session.runnerResolution?.runnerAvailability ?? []),
      explicitCommand: Boolean(session.input.command?.length),
      relevantFiles,
      testFiles: retrieved.testFiles,
      recentDiffFiles: retrieved.recentDiffFiles,
      symbolHits: retrieved.symbolHits,
      traces: retrieved.traces,
      architectureFiles: retrieved.architectureFiles,
      retrieval: {
        strategyVersion: CONTEXT_RETRIEVAL_STRATEGY_VERSION,
        files: retrieved.retrievalFiles,
      },
    };
  }

  private riskFor(
    initiative: Initiative,
    policy: KiwiPolicy,
    step: Step,
    relevantFiles: string[],
  ): {
    blastRadius: BlastRadius;
    securitySensitivity: SecuritySensitivity;
    contextSize: ContextSize;
  } {
    const text = `${initiative.rawInput}\n${step.title}`.toLowerCase();
    const riskZonePatterns = policy.riskZones.high;
    const touchesRiskZone = relevantFiles.some((file) =>
      riskZonePatterns.some((pattern) => this.pathMatches(file, pattern)),
    );
    const sensitiveText = /\b(auth|payment|secret|token|credential|migration|infra|workflow|deploy)\b/.test(text);
    const highRisk = initiative.riskProfile === RiskProfiles.Production || touchesRiskZone || sensitiveText;
    const broadContext = relevantFiles.length > 8 || step.type === StepTypes.Refactoring;

    return {
      blastRadius: highRisk ? BlastRadii.High : BlastRadii.Low,
      securitySensitivity: highRisk ? SecuritySensitivities.High : SecuritySensitivities.Low,
      contextSize:
        highRisk || broadContext
          ? ContextSizes.Large
          : relevantFiles.length > 2
            ? ContextSizes.Medium
            : ContextSizes.Small,
    };
  }

  private pathMatches(filePath: string, pattern: string): boolean {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");

    return new RegExp(`^${escaped}$`).test(filePath);
  }
}
