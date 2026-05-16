import {
  Artifact,
  ContractValues,
  EvidenceSubject,
  GateResult,
  GateResultSchema,
  ExecutionIsolations,
  GateTypes,
  NextActionTypes,
  ReviewVerdict,
  ReviewVerdictSchema,
  SchedulerDecisionSchema,
  StepAttemptStatus,
} from "@kiwi/contracts";
import {
  appendAuditEvent,
  assertWithinBudgetEstimate,
  BudgetExceededError,
  ensureRunLayout,
  estimateAttemptCostUsd,
  resolveRunArtifactPath,
  writeJsonSafely,
} from "@kiwi/core";
import {
  AttemptDiff,
  loadAttemptDiff,
  ReviewEngine,
  ReviewExecutionMetadata,
  saveReviewVerdict,
  StubReviewEngine,
} from "./review-engine";
import { loadContextPackage } from "./scheduler-policy";
import { auditAttemptFinished, auditStepAttemptStarted } from "./step-attempt/audit";
import { coordinateAttemptGates, mapRunnerStatusToAttemptStatus } from "./step-attempt/gates";
import { recordAttemptModelCost } from "./step-attempt/model-cost";
import { markAttemptRunning, persistAttemptCompletion } from "./step-attempt/persistence";
import { loadStepAttempt, saveRunnerCostReport } from "./step-attempt-artifacts";
import { nextActionFromReview, runAttemptReview } from "./step-attempt/review";
import {
  executeStepRunner,
  ensureIsolatedWorktree,
  ensureRunnerMatchesDecision,
  ensureWorktreeIsNotSource,
} from "./step-attempt/runner";
import type {
  ExecuteStepAttemptInput,
  StepAttemptNextAction,
  StepRunnerExecutionError,
  StepRunnerExecutionOutput,
  StepRunnerExecutionStatus,
} from "./step-runner-types";

export type {
  ExecuteStepAttemptInput,
  StepAttemptNextAction,
  StepAttemptRunner,
  StepRunnerExecutionError,
  StepRunnerExecutionInput,
  StepRunnerExecutionOutput,
  StepRunnerExecutionStatus,
  StepRunnerExecutionTimeouts,
  StepRunnerModelUsage,
} from "./step-runner-types";

export interface StepAttemptOrchestrationResult {
  runId: string;
  stepId: string;
  attemptId: string;
  status: StepAttemptStatus;
  runnerStatus: StepRunnerExecutionStatus;
  artifactRefs: Artifact[];
  gateResults: GateResult[];
  gateResultsRef: string;
  reviewVerdict: ReviewVerdict;
  reviewReportRef: string;
  attemptRef: string;
  nextAction: StepAttemptNextAction;
  error?: StepRunnerExecutionError;
}

interface AttemptScope {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}
type AttemptReviewExecutionResult = Awaited<ReturnType<typeof runAttemptReview>>;

function ensureRunnerExecutionPath(input: ExecuteStepAttemptInput): void {
  if (input.executionMode === ExecutionIsolations.Direct) {
    return;
  }
  ensureIsolatedWorktree(input.cwd, input.worktreePath);
  if (input.repoPath) {
    ensureWorktreeIsNotSource(input.repoPath, input.worktreePath);
  }
}

async function reviewAttemptWithFallback<TCommandPolicy>(params: {
  input: ExecuteStepAttemptInput<TCommandPolicy>;
  attemptScope: AttemptScope;
  runnerOutput: StepRunnerExecutionOutput;
  gateResults: GateResult[];
  attemptDiff: AttemptDiff | null;
  diffSubject: EvidenceSubject | null;
  defaultReviewEngine?: ReviewEngine;
}): Promise<{ reviewResult: AttemptReviewExecutionResult; reviewError?: StepRunnerExecutionError }> {
  try {
    const runnerNeedsDeterministicReview =
      params.runnerOutput.status !== ContractValues.Completed || !params.attemptDiff;

    return {
      reviewResult: await runAttemptReview({
        ...params.attemptScope,
        step: params.input.step,
        gateResults: params.gateResults,
        attemptDiff: params.attemptDiff,
        diffSubject: params.diffSubject,
        reviewDepth: params.input.schedulerDecision.reviewDepth,
        reviewEngine: runnerNeedsDeterministicReview
          ? new StubReviewEngine()
          : (params.input.reviewEngine ?? params.defaultReviewEngine ?? new StubReviewEngine()),
      }),
    };
  } catch (error) {
    const reviewError = reviewExecutionError(error);
    const reviewResult = persistReviewExecutionFailure({
      ...params.attemptScope,
      diffSubject: params.diffSubject,
      error: reviewError,
    });
    appendAuditEvent(params.input.cwd, {
      eventType: "step_attempt_failed",
      runId: params.attemptScope.runId,
      timestamp: new Date().toISOString(),
      payload: {
        stepId: params.attemptScope.stepId,
        attemptId: params.attemptScope.attemptId,
        phase: "review",
        reason: reviewError.message,
      },
    });

    return { reviewResult, reviewError };
  }
}

function reviewExecutionError(error: unknown): StepRunnerExecutionError {
  return {
    code: "REVIEW_EXECUTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

function persistReviewExecutionFailure(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  diffSubject: EvidenceSubject | null;
  error: StepRunnerExecutionError;
}): {
  reviewVerdict: ReviewVerdict;
  reviewReportRef: string;
  metadata: ReviewExecutionMetadata;
  startedAt: string;
} {
  const startedAt = new Date().toISOString();
  const reviewVerdict = ReviewVerdictSchema.parse({
    verdict: ContractValues.Reject,
    safeToContinue: false,
    issues: [
      {
        code: params.error.code,
        title: "Review execution failed",
        severity: "high",
        detail: params.error.message,
      },
    ],
    recommendedNextSteps: ["Fix reviewer/provider configuration or retry the review after the provider is available."],
    confidence: 1,
    ...(params.diffSubject ? { subject: params.diffSubject } : {}),
  });
  const reviewReportRef = saveReviewVerdict({
    cwd: params.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    verdict: reviewVerdict,
  });

  return {
    reviewVerdict,
    reviewReportRef,
    metadata: {
      modelId: null,
      providerName: "review-error",
      modelUsage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      ...(params.diffSubject?.type === "diff" ? { diffHash: params.diffSubject.hash } : {}),
    },
    startedAt,
  };
}

export class StepAttemptOrchestrator<TCommandPolicy = unknown> {
  constructor(private readonly defaults: { reviewEngine?: ReviewEngine } = {}) {}

  private blockBudgetExceeded(params: {
    input: ExecuteStepAttemptInput<TCommandPolicy>;
    runId: string;
    stepId: string;
    attemptId: string;
    attemptScope: { cwd: string; runId: string; stepId: string; attemptId: string };
    now: Date;
  }): StepAttemptOrchestrationResult | null {
    const budget = params.input.schedulerDecision.budget;

    if (!budget) {
      return null;
    }
    if (params.input.schedulerDecision.routingReason.includes("risk_over_budget_hard_cap_override")) {
      return null;
    }
    const estimateAttemptCostUsdValue = estimateAttemptCostUsd({
      modelId: params.input.selectedModelId ?? null,
      capability: params.input.schedulerDecision.modelCapability,
      contextLevel: params.input.schedulerDecision.contextLevel,
    });

    try {
      assertWithinBudgetEstimate({
        budgetProfile: budget.profile,
        remainingUsdEstimate: budget.remainingUsdEstimate,
        modelId: params.input.selectedModelId ?? null,
        modelCapability: params.input.schedulerDecision.modelCapability,
        contextLevel: params.input.schedulerDecision.contextLevel,
        estimateAttemptCostUsdValue,
      });

      return null;
    } catch (error) {
      if (!(error instanceof BudgetExceededError)) {
        throw error;
      }

      const blockedReason = "budget_estimate_exceeds_remaining";
      const routingReason = params.input.schedulerDecision.routingReason.includes(blockedReason)
        ? params.input.schedulerDecision.routingReason
        : [...params.input.schedulerDecision.routingReason, blockedReason];
      const blockedDecision = SchedulerDecisionSchema.parse({
        ...params.input.schedulerDecision,
        status: ContractValues.Blocked,
        blockedReason,
        routingReason,
      });
      writeJsonSafely(
        resolveRunArtifactPath(
          params.runId,
          `steps/${params.stepId}/${params.attemptId}/scheduler-decision.json`,
          params.input.cwd,
        ),
        blockedDecision,
      );

      const completedAt = params.now.toISOString();
      const gateResultsRef = `steps/${params.stepId}/${params.attemptId}/gate-results.json`;
      const budgetGateResult = GateResultSchema.parse({
        gateId: "gate_budget_preflight",
        gateType: GateTypes.ForbiddenFileChecks,
        status: ContractValues.Blocked,
        evidenceRefs: [`steps/${params.stepId}/${params.attemptId}/scheduler-decision.json`],
        reason: blockedReason,
      });
      const gateResults: GateResult[] = [budgetGateResult];
      writeJsonSafely(resolveRunArtifactPath(params.runId, gateResultsRef, params.input.cwd), gateResults);

      const reviewVerdict = ReviewVerdictSchema.parse({
        verdict: ContractValues.Reject,
        safeToContinue: false,
        issues: [
          {
            code: "BUDGET_EXCEEDED",
            title: "Pre-flight budget guard blocked the attempt",
            severity: "high",
            detail: error.message,
          },
        ],
        recommendedNextSteps: ["Increase --budget-profile or reduce model/context demand for this step."],
        confidence: 0.95,
      });
      const reviewReportRef = saveReviewVerdict({
        cwd: params.input.cwd,
        runId: params.runId,
        stepId: params.stepId,
        attemptId: params.attemptId,
        verdict: reviewVerdict,
      });
      const costReportRef = saveRunnerCostReport({
        cwd: params.input.cwd,
        runId: params.runId,
        stepId: params.stepId,
        attemptId: params.attemptId,
        runner: params.input.runner.name,
        modelId: params.input.selectedModelId ?? null,
        providerName: "budget-preflight",
        agentRole: params.input.schedulerDecision.agentRole,
        modelCapability: params.input.schedulerDecision.modelCapability,
        reviewDepth: params.input.schedulerDecision.reviewDepth,
        modelInvocationRefs: [],
        modelUsage: { inputTokens: 0, outputTokens: 0 },
        usagePrecision: "unknown",
        estimatedCostUsd: 0,
        createdAt: completedAt,
      });

      const blockedError: StepRunnerExecutionError = {
        code: "BUDGET_EXCEEDED",
        message: error.message,
      };
      const runnerOutput: StepRunnerExecutionOutput = {
        status: ContractValues.Blocked,
        artifactRefs: [],
        rawLogsRef: null,
        modelUsage: { inputTokens: 0, outputTokens: 0 },
        modelId: params.input.selectedModelId ?? null,
        providerName: "budget-preflight",
        usagePrecision: "unknown",
        estimatedCostUsd: 0,
        gateResult: budgetGateResult,
        error: blockedError,
      };
      const nextAction: StepAttemptNextAction = {
        type: NextActionTypes.Replan,
        reason: "budget_estimate_exceeds_remaining",
        recommendedNextSteps: ["Increase budget profile or re-run with lower capability/context requirements."],
        issueCodes: ["BUDGET_EXCEEDED"],
      };
      const persistedAttempt = persistAttemptCompletion({
        ...params.attemptScope,
        existingAttempt: loadStepAttempt(params.attemptScope),
        status: ContractValues.Blocked,
        runnerOutput,
        additionalArtifacts: [],
        postRunnerArtifacts: [],
        reviewReportRef,
        costReportRef,
        gateResultsRef,
        modelInvocationRefs: [],
        nextAction,
        completedAt,
      });

      appendAuditEvent(params.input.cwd, {
        eventType: "scheduler_blocked",
        runId: params.runId,
        timestamp: completedAt,
        payload: {
          stepId: params.stepId,
          attemptId: params.attemptId,
          reason: blockedReason,
          budgetProfile: error.context.budgetProfile,
          remainingUsdEstimate: error.context.remainingUsdEstimate,
          estimatedAttemptCostUsd: error.context.estimatedAttemptCostUsd,
          modelId: error.context.modelId,
          modelCapability: error.context.modelCapability,
          contextLevel: error.context.contextLevel,
          routingReason,
        },
      });
      auditAttemptFinished({
        ...params.attemptScope,
        runner: params.input.runner.name,
        runnerOutput,
        reviewVerdict,
        reviewReportRef,
        gateResultsRef,
        nextAction,
        status: ContractValues.Blocked,
        completedAt,
      });

      return {
        runId: params.runId,
        stepId: params.stepId,
        attemptId: params.attemptId,
        status: ContractValues.Blocked,
        runnerStatus: ContractValues.Blocked,
        artifactRefs: persistedAttempt.artifacts,
        gateResults,
        gateResultsRef,
        reviewVerdict,
        reviewReportRef,
        attemptRef: persistedAttempt.attemptRef,
        nextAction,
        error: blockedError,
      };
    }
  }

  async execute(input: ExecuteStepAttemptInput<TCommandPolicy>): Promise<StepAttemptOrchestrationResult> {
    ensureRunnerMatchesDecision(input);
    ensureRunnerExecutionPath(input);
    ensureRunLayout(input.schedulerDecision.runId, input.cwd);

    const now = input.now ?? new Date();
    const startedAt = now.toISOString();
    const runId = input.schedulerDecision.runId;
    const stepId = input.step.stepId;
    const attemptId = input.schedulerDecision.attemptId;
    const attemptScope = { cwd: input.cwd, runId, stepId, attemptId };
    const budgetBlocked = this.blockBudgetExceeded({
      input,
      runId,
      stepId,
      attemptId,
      attemptScope,
      now,
    });

    if (budgetBlocked) {
      return budgetBlocked;
    }

    const contextPackage = loadContextPackage(attemptScope);
    const existingAttempt = markAttemptRunning(attemptScope);
    auditStepAttemptStarted({
      ...attemptScope,
      runner: input.runner.name,
      startedAt,
    });

    const runnerOutput = await executeStepRunner({ input, contextPackage, startedAt });
    const attemptDiff = loadAttemptDiff(attemptScope);
    const diffSubject: EvidenceSubject | null = attemptDiff ? { type: "diff", hash: attemptDiff.diffHash } : null;
    const { gateResults, gateResultsRef, postRunnerArtifacts } = await coordinateAttemptGates({
      input,
      ...attemptScope,
      runnerGateResult: runnerOutput.gateResult,
      attemptDiff,
      diffSubject,
    });

    const { reviewResult, reviewError } = await reviewAttemptWithFallback({
      input,
      attemptScope,
      runnerOutput,
      gateResults,
      attemptDiff,
      diffSubject,
      ...(this.defaults.reviewEngine ? { defaultReviewEngine: this.defaults.reviewEngine } : {}),
    });
    const completedAt = new Date().toISOString();
    const nextAction = nextActionFromReview(reviewResult.reviewVerdict);
    const status = mapRunnerStatusToAttemptStatus({
      runnerStatus: runnerOutput.status,
      reviewVerdict: reviewResult.reviewVerdict,
      gateResults,
    });
    const { modelInvocationRefs, costReportRef } = recordAttemptModelCost({
      ...attemptScope,
      runner: input.runner.name,
      agentRole: input.schedulerDecision.agentRole,
      requestedCapability: input.step.recommendedModelCapability,
      modelCapability: input.schedulerDecision.modelCapability,
      reviewDepth: input.schedulerDecision.reviewDepth,
      runnerOutput,
      reviewMetadata: reviewResult.metadata,
      reviewInvocationStatus: reviewError ? ContractValues.Failed : ContractValues.Completed,
      gateResultsRef,
      reviewReportRef: reviewResult.reviewReportRef,
      startedAt,
      reviewStartedAt: reviewResult.startedAt,
      completedAt,
    });
    const persistedAttempt = persistAttemptCompletion({
      ...attemptScope,
      existingAttempt,
      status,
      runnerOutput,
      additionalArtifacts: input.additionalArtifacts ?? [],
      postRunnerArtifacts,
      reviewReportRef: reviewResult.reviewReportRef,
      costReportRef,
      gateResultsRef,
      modelInvocationRefs,
      nextAction,
      completedAt,
    });

    auditAttemptFinished({
      ...attemptScope,
      runner: input.runner.name,
      runnerOutput,
      reviewVerdict: reviewResult.reviewVerdict,
      reviewReportRef: reviewResult.reviewReportRef,
      gateResultsRef,
      nextAction,
      status,
      completedAt,
    });

    const result: StepAttemptOrchestrationResult = {
      runId,
      stepId,
      attemptId,
      status,
      runnerStatus: runnerOutput.status,
      artifactRefs: persistedAttempt.artifacts,
      gateResults,
      gateResultsRef,
      reviewVerdict: reviewResult.reviewVerdict,
      reviewReportRef: reviewResult.reviewReportRef,
      attemptRef: persistedAttempt.attemptRef,
      nextAction,
    };

    if (runnerOutput.error) {
      return { ...result, error: runnerOutput.error };
    }
    if (reviewError) {
      return { ...result, error: reviewError };
    }

    return result;
  }
}
