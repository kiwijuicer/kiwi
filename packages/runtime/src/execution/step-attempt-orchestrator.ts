import { ContractValues, EvidenceSubject, GateResult, ExecutionIsolations, ReviewVerdictSchema } from "@kiwi/contracts";
import type { ReviewVerdict } from "@kiwi/contracts";
import { appendAuditEvent, ensureRunLayout } from "@kiwi/core";
import {
  AttemptDiff,
  loadAttemptDiff,
  ReviewEngine,
  ReviewExecutionMetadata,
  saveReviewVerdict,
  StubReviewEngine,
} from "../review/review-engine";
import { loadContextPackage } from "../policies/scheduler-policy";
import { auditAttemptFinished, auditStepAttemptStarted } from "./step-attempt/audit";
import { writeBudgetBlockedAttempt } from "./step-attempt/budget-blocked-writer";
import { coordinateAttemptGates, mapRunnerStatusToAttemptStatus } from "./step-attempt/gates";
import { recordAttemptModelCost } from "./step-attempt/model-cost";
import { markAttemptRunning, persistAttemptCompletion } from "./step-attempt/persistence";
import type { StepAttemptOrchestrationResult } from "./step-attempt/result";
import { nextActionFromReview, runAttemptReview } from "./step-attempt/review";
import {
  executeStepRunner,
  ensureIsolatedWorktree,
  ensureRunnerMatchesDecision,
  ensureWorktreeIsNotSource,
} from "./step-attempt/runner";
import type { ExecuteStepAttemptInput, StepRunnerExecutionError, StepRunnerExecutionOutput } from "./step-runner-types";

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
export type { StepAttemptOrchestrationResult } from "./step-attempt/result";

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
    const budgetBlocked = writeBudgetBlockedAttempt({
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
      runnerStatus: runnerOutput.status,
      mutationRequirement: contextPackage.mutationRequirement,
      runnerRawLogsRef: runnerOutput.rawLogsRef,
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
