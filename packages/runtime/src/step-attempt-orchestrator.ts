import { Artifact, EvidenceSubject, GateResult, ReviewVerdict, StepAttemptStatus } from "@kiwi/contracts";
import { ensureRunLayout } from "@kiwi/core";
import { loadAttemptDiff, ReviewEngine } from "./review-engine";
import { loadContextPackage } from "./scheduler-policy";
import { auditAttemptFinished, auditStepAttemptStarted } from "./step-attempt/audit";
import { coordinateAttemptGates, mapRunnerStatusToAttemptStatus } from "./step-attempt/gates";
import { recordAttemptModelCost } from "./step-attempt/model-cost";
import { markAttemptRunning, persistAttemptCompletion } from "./step-attempt/persistence";
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

export class StepAttemptOrchestrator<TCommandPolicy = unknown> {
  constructor(private readonly defaults: { reviewEngine?: ReviewEngine } = {}) {}

  async execute(input: ExecuteStepAttemptInput<TCommandPolicy>): Promise<StepAttemptOrchestrationResult> {
    ensureRunnerMatchesDecision(input);
    ensureIsolatedWorktree(input.cwd, input.worktreePath);
    if (input.repoPath) ensureWorktreeIsNotSource(input.repoPath, input.worktreePath);
    ensureRunLayout(input.schedulerDecision.runId, input.cwd);

    const now = input.now ?? new Date();
    const startedAt = now.toISOString();
    const runId = input.schedulerDecision.runId;
    const stepId = input.step.stepId;
    const attemptId = input.schedulerDecision.attemptId;
    const attemptScope = { cwd: input.cwd, runId, stepId, attemptId };
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

    const reviewResult = await runAttemptReview({
      ...attemptScope,
      step: input.step,
      gateResults,
      attemptDiff,
      diffSubject,
      reviewDepth: input.schedulerDecision.reviewDepth,
      ...(input.reviewEngine ? { reviewEngine: input.reviewEngine } : {}),
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
      return {
        ...result,
        error: runnerOutput.error,
      };
    }

    return result;
  }
}
