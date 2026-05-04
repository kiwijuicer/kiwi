import path from "path";
import {
  Artifact,
  ArtifactSchema,
  AccessMode,
  ContractValues,
  GateResult,
  GateResultSchema,
  KiwiPolicy,
  ReviewVerdict,
  ReviewVerdictSchema,
  RunnerName,
  Step,
  StepAttemptSchema,
  StepAttemptStatus,
  UsagePrecision,
} from "@kiwi/contracts";
import { appendAuditEvent } from "./cost-ledger";
import { appendModelInvocation } from "./model-invocations";
import { runForbiddenFileGate, runSecretsScanGate, saveGateResults, summarizeGateResults } from "./quality-gates";
import {
  classifyReviewAction,
  loadAttemptDiff,
  ReviewAction,
  ReviewEngine,
  ReviewExecutionMetadata,
  saveReviewVerdict,
  StubReviewEngine,
} from "./review-engine";
import { loadContextPackage, SchedulerDecision } from "./scheduler-policy";
import { ensureRunLayout } from "./run-store";
import {
  artifact,
  dedupeArtifacts,
  loadStepAttempt,
  saveAttemptSummary,
  saveRunnerCostReport,
  saveStepAttempt,
} from "./step-attempt-artifacts";

export type StepRunnerExecutionStatus = "completed" | "failed" | "blocked" | "approval_required" | "timeout";

export interface StepRunnerExecutionTimeouts {
  commandTimeoutMs: number;
}

export interface StepRunnerModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StepRunnerExecutionError {
  code: string;
  message: string;
}

export interface StepRunnerExecutionInput<TCommandPolicy = unknown> {
  runId: string;
  stepId: string;
  attemptId: string;
  workspacePath: string;
  repoPath?: string;
  worktreePath: string;
  stepPrompt: string;
  contextPackage: unknown;
  allowedTools: string[];
  timeouts: StepRunnerExecutionTimeouts;
  command?: string[];
  commandPolicy?: TCommandPolicy;
  env?: Record<string, string>;
  approved?: boolean;
  requestedAt?: string;
}

export interface StepRunnerExecutionOutput {
  status: StepRunnerExecutionStatus;
  artifactRefs: Artifact[];
  rawLogsRef: string | null;
  modelUsage: StepRunnerModelUsage;
  modelId?: string | null;
  providerName?: string;
  accessMode?: AccessMode;
  usagePrecision?: UsagePrecision;
  estimatedCostUsd?: number | null;
  gateResult: GateResult;
  error?: StepRunnerExecutionError;
}

export interface StepAttemptRunner<TCommandPolicy = unknown> {
  readonly name: RunnerName;
  execute(input: StepRunnerExecutionInput<TCommandPolicy>): Promise<StepRunnerExecutionOutput>;
}

export interface StepAttemptNextAction {
  type: ReviewAction;
  reason: string;
  recommendedNextSteps: string[];
  issueCodes: string[];
}

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

export interface ExecuteStepAttemptInput<TCommandPolicy = unknown> {
  cwd: string;
  repoPath?: string;
  step: Step;
  schedulerDecision: SchedulerDecision;
  runner: StepAttemptRunner<TCommandPolicy>;
  worktreePath: string;
  stepPrompt: string;
  allowedTools?: string[];
  timeouts?: StepRunnerExecutionTimeouts;
  command?: string[];
  commandPolicy?: TCommandPolicy;
  env?: Record<string, string>;
  approved?: boolean;
  additionalGateResults?: GateResult[];
  additionalArtifacts?: Artifact[];
  postRunnerGateExecutor?: (params: {
    diff: string | null;
    diffHash: string | null;
    startedAt: string;
  }) => Promise<{ gateResults: GateResult[]; artifacts: Artifact[] }>;
  reviewEngine?: ReviewEngine;
  policy?: KiwiPolicy;
  now?: Date;
}

function ensureRunnerMatchesDecision(input: ExecuteStepAttemptInput): void {
  if (input.schedulerDecision.status !== "scheduled") {
    throw new Error(`cannot execute blocked scheduler decision: ${input.schedulerDecision.blockedReason}`);
  }
  if (input.schedulerDecision.runner !== input.runner.name) {
    throw new Error(`runner mismatch: scheduler selected ${input.schedulerDecision.runner}, got ${input.runner.name}`);
  }
}

function ensureIsolatedWorktree(workspacePath: string, worktreePath: string): void {
  if (path.resolve(workspacePath) === path.resolve(worktreePath)) {
    throw new Error("runner worktreePath must not be the main workspace path");
  }
}

function ensureWorktreeIsNotSource(sourcePath: string, worktreePath: string): void {
  if (path.resolve(sourcePath) === path.resolve(worktreePath)) {
    throw new Error("runner worktreePath must not be the source repo path");
  }
}

function mapRunnerStatusToAttemptStatus(params: {
  runnerStatus: StepRunnerExecutionStatus;
  reviewVerdict: ReviewVerdict;
  gateResults: GateResult[];
}): StepAttemptStatus {
  if (params.runnerStatus === ContractValues.Blocked || params.runnerStatus === "approval_required") {
    return ContractValues.Blocked;
  }
  if (params.runnerStatus === ContractValues.Failed || params.runnerStatus === "timeout") return ContractValues.Failed;
  if (!summarizeGateResults(params.gateResults).safeToContinue) return ContractValues.Failed;
  if (!params.reviewVerdict.safeToContinue) return ContractValues.Failed;
  return ContractValues.Completed;
}

function nextActionFromReview(verdict: ReviewVerdict): StepAttemptNextAction {
  const action = classifyReviewAction(verdict);
  return {
    type: action,
    reason: verdict.verdict,
    recommendedNextSteps: verdict.recommendedNextSteps,
    issueCodes: verdict.issues.map((issue) => issue.code),
  };
}

function enforceGateResultsBeforePositiveReview(params: {
  gateResults: GateResult[];
  reviewVerdict: ReviewVerdict;
}): ReviewVerdict {
  const gateSummary = summarizeGateResults(params.gateResults);
  if (gateSummary.safeToContinue || !params.reviewVerdict.safeToContinue) {
    return ReviewVerdictSchema.parse(params.reviewVerdict);
  }

  return ReviewVerdictSchema.parse({
    verdict: gateSummary.overallStatus === ContractValues.Blocked ? ContractValues.Reject : ContractValues.NeedsChanges,
    safeToContinue: false,
    issues: [
      {
        code: "GATE_REVIEW_CONFLICT",
        title: "Positive review cannot override failing gates",
        severity: gateSummary.overallStatus === ContractValues.Blocked ? "high" : "medium",
        detail:
          `Failing gates: ${gateSummary.failingGateIds.join(", ")} Blocked gates: ${gateSummary.blockedGateIds.join(", ")}`.trim(),
      },
    ],
    recommendedNextSteps: [
      gateSummary.overallStatus === ContractValues.Blocked
        ? "Replan with policy-compliant steps"
        : "Create a fix step and re-run gates",
    ],
    confidence: 1,
  });
}

function gateResultFromRunnerException(error: StepRunnerExecutionError, evidenceRefs: string[]): GateResult {
  return GateResultSchema.parse({
    gateId: "gate_runner_execution",
    gateType: "forbidden_file_checks",
    status: ContractValues.Fail,
    evidenceRefs,
    reason: error.message,
  });
}

function normalizeRunnerException(error: unknown): {
  output: StepRunnerExecutionOutput;
} {
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const artifactRefs = Array.isArray(record.artifactRefs)
    ? record.artifactRefs.map((entry) => ArtifactSchema.parse(entry))
    : [];
  const message = error instanceof Error ? error.message : String(error);
  const structuredError: StepRunnerExecutionError = {
    code: typeof record.code === "string" ? record.code : "RUNNER_EXCEPTION",
    message,
  };
  return {
    output: {
      status: ContractValues.Failed,
      artifactRefs,
      rawLogsRef: artifactRefs[0]?.ref ?? null,
      modelUsage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      gateResult: gateResultFromRunnerException(
        structuredError,
        artifactRefs.map((entry) => entry.ref),
      ),
      error: structuredError,
    },
  };
}

function buildRunnerInput<TCommandPolicy>(
  input: ExecuteStepAttemptInput<TCommandPolicy>,
  contextPackage: unknown,
  requestedAt: string,
): StepRunnerExecutionInput<TCommandPolicy> {
  const runnerInput: StepRunnerExecutionInput<TCommandPolicy> = {
    runId: input.schedulerDecision.runId,
    stepId: input.step.stepId,
    attemptId: input.schedulerDecision.attemptId,
    workspacePath: input.cwd,
    worktreePath: input.worktreePath,
    stepPrompt: input.stepPrompt,
    contextPackage,
    allowedTools: input.allowedTools ?? [],
    timeouts: input.timeouts ?? { commandTimeoutMs: 120_000 },
    requestedAt,
  };

  if (input.repoPath) runnerInput.repoPath = input.repoPath;
  if (input.command) runnerInput.command = input.command;
  if (input.commandPolicy !== undefined) runnerInput.commandPolicy = input.commandPolicy;
  if (input.env) runnerInput.env = input.env;
  if (input.approved !== undefined) runnerInput.approved = input.approved;

  return runnerInput;
}

export class StepAttemptOrchestrator<TCommandPolicy = unknown> {
  constructor(private readonly defaults: { reviewEngine?: ReviewEngine } = {}) {}

  // eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity
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
    const contextPackage = loadContextPackage({
      cwd: input.cwd,
      runId,
      stepId,
      attemptId,
    });
    const existingAttempt = loadStepAttempt({
      cwd: input.cwd,
      runId,
      stepId,
      attemptId,
    });

    saveStepAttempt({
      cwd: input.cwd,
      runId,
      attempt: StepAttemptSchema.parse({
        ...existingAttempt,
        status: ContractValues.Running,
        modelInvocationRefs: existingAttempt.modelInvocationRefs,
        completedAt: null,
      }),
    });

    appendAuditEvent(input.cwd, {
      eventType: "step_attempt_started",
      runId,
      timestamp: startedAt,
      payload: {
        stepId,
        attemptId,
        runner: input.runner.name,
      },
    });

    let runnerOutput: StepRunnerExecutionOutput;
    try {
      runnerOutput = await input.runner.execute(buildRunnerInput(input, contextPackage, startedAt));
    } catch (error) {
      runnerOutput = normalizeRunnerException(error).output;
    }

    runnerOutput = {
      ...runnerOutput,
      artifactRefs: runnerOutput.artifactRefs.map((entry) => ArtifactSchema.parse(entry)),
      gateResult: GateResultSchema.parse(runnerOutput.gateResult),
    };

    const reviewEngine = input.reviewEngine ?? this.defaults.reviewEngine ?? new StubReviewEngine();
    const reviewStartedAt = new Date().toISOString();
    const attemptDiff = loadAttemptDiff({ cwd: input.cwd, runId, stepId, attemptId });

    const postRunnerGateEvidence = input.postRunnerGateExecutor
      ? await input.postRunnerGateExecutor({
          diff: attemptDiff?.diff ?? null,
          diffHash: attemptDiff?.diffHash ?? null,
          startedAt: new Date().toISOString(),
        })
      : { gateResults: [], artifacts: [] };

    const baseGateResults = [
      runnerOutput.gateResult,
      ...(input.additionalGateResults ?? []).map((entry) => GateResultSchema.parse(entry)),
      ...postRunnerGateEvidence.gateResults.map((entry) => GateResultSchema.parse(entry)),
    ];

    const diffGateResults: GateResult[] = [];
    if (input.policy && attemptDiff && input.step.requiredGates.includes("forbidden_file_checks")) {
      diffGateResults.push(
        runForbiddenFileGate({
          cwd: input.cwd,
          runId,
          stepId,
          attemptId,
          diff: attemptDiff.diff,
          diffHash: attemptDiff.diffHash,
          policy: input.policy,
          ...(input.approved !== undefined ? { approvedPaths: input.approved } : {}),
        }),
      );
    }
    if (input.policy && attemptDiff && input.step.requiredGates.includes("secrets_check")) {
      diffGateResults.push(
        runSecretsScanGate({
          cwd: input.cwd,
          runId,
          stepId,
          attemptId,
          diff: attemptDiff.diff,
          diffHash: attemptDiff.diffHash,
          policy: input.policy,
        }),
      );
    }
    if (diffGateResults.length > 0) {
      appendAuditEvent(input.cwd, {
        eventType: "gate_command_executed",
        runId,
        timestamp: new Date().toISOString(),
        payload: {
          stepId,
          attemptId,
          diffHash: attemptDiff?.diffHash ?? null,
          gates: diffGateResults.map((entry) => ({ gateId: entry.gateId, status: entry.status })),
        },
      });
    }
    const gateResults = [...baseGateResults, ...diffGateResults];
    const gateResultsRef = saveGateResults({
      cwd: input.cwd,
      runId,
      stepId,
      attemptId,
      gateResults,
    });
    const riskHigh = input.schedulerDecision.reviewDepth === ContractValues.Frontier;
    const reviewInput = {
      runId,
      stepId,
      attemptId,
      gateResults,
      step: input.step,
      diff: attemptDiff?.diff ?? null,
      diffHash: attemptDiff?.diffHash ?? null,
      riskHigh,
    };
    const richExecution = reviewEngine.reviewWithExecution
      ? await reviewEngine.reviewWithExecution(reviewInput)
      : null;
    const rawReviewVerdict = richExecution ? richExecution.verdict : await reviewEngine.review(reviewInput);
    const reviewMetadata: ReviewExecutionMetadata = richExecution?.metadata ?? {
      modelId: reviewEngine.name === "stub-review" ? "stub-reviewer" : reviewEngine.name,
      providerName: reviewEngine.name === "stub-review" ? "stub" : reviewEngine.name,
      modelUsage: { inputTokens: 0, outputTokens: 0 },
      estimatedCostUsd: 0,
      ...(attemptDiff ? { diffHash: attemptDiff.diffHash } : {}),
    };
    const reviewVerdict = enforceGateResultsBeforePositiveReview({
      gateResults,
      reviewVerdict: rawReviewVerdict,
    });
    const reviewReportRef = saveReviewVerdict({
      cwd: input.cwd,
      runId,
      stepId,
      attemptId,
      verdict: reviewVerdict,
    });

    const completedAt = new Date().toISOString();
    const runnerInvocationRef = appendModelInvocation(input.cwd, {
      schemaVersion: "1",
      runId,
      phase: ContractValues.Executor,
      stepId,
      attemptId,
      agentRole: input.schedulerDecision.agentRole,
      requestedCapability: input.step.recommendedModelCapability,
      selectedCapability: input.schedulerDecision.modelCapability,
      modelId: runnerOutput.modelId ?? null,
      providerName: runnerOutput.providerName ?? ContractValues.Local,
      runner: input.runner.name,
      usage: runnerOutput.modelUsage,
      usagePrecision: runnerOutput.usagePrecision ?? "unknown",
      estimatedCostUsd: runnerOutput.estimatedCostUsd ?? null,
      status:
        runnerOutput.status === ContractValues.Completed
          ? ContractValues.Completed
          : runnerOutput.status === ContractValues.Blocked || runnerOutput.status === "approval_required"
            ? ContractValues.Blocked
            : ContractValues.Failed,
      evidenceRefs: runnerOutput.artifactRefs.map((entry) => entry.ref),
      startedAt,
      completedAt,
    });
    const reviewerInvocationRef = appendModelInvocation(input.cwd, {
      schemaVersion: "1",
      runId,
      phase: ContractValues.Reviewer,
      stepId,
      attemptId,
      agentRole: ContractValues.Reviewer,
      requestedCapability: reviewMetadata.requestedCapability ?? input.schedulerDecision.reviewDepth,
      selectedCapability: reviewMetadata.selectedCapability ?? input.schedulerDecision.reviewDepth,
      modelId: reviewMetadata.modelId,
      providerName: reviewMetadata.providerName,
      runner: null,
      usage: reviewMetadata.modelUsage,
      usagePrecision: "estimated",
      estimatedCostUsd: reviewMetadata.estimatedCostUsd,
      status: ContractValues.Completed,
      evidenceRefs: [gateResultsRef, reviewReportRef],
      startedAt: reviewStartedAt,
      completedAt,
    });
    const modelInvocationRefs = [runnerInvocationRef, reviewerInvocationRef];
    const nextAction = nextActionFromReview(reviewVerdict);
    const status = mapRunnerStatusToAttemptStatus({
      runnerStatus: runnerOutput.status,
      reviewVerdict,
      gateResults,
    });
    const costReportRef = saveRunnerCostReport({
      cwd: input.cwd,
      runId,
      stepId,
      attemptId,
      runner: input.runner.name,
      modelId: runnerOutput.modelId ?? null,
      providerName: runnerOutput.providerName ?? ContractValues.Local,
      agentRole: input.schedulerDecision.agentRole,
      modelCapability: input.schedulerDecision.modelCapability,
      reviewDepth: input.schedulerDecision.reviewDepth,
      modelInvocationRefs,
      modelUsage: runnerOutput.modelUsage,
      usagePrecision: runnerOutput.usagePrecision ?? "unknown",
      estimatedCostUsd: runnerOutput.estimatedCostUsd ?? null,
      createdAt: completedAt,
    });

    const artifactsWithoutSummary = dedupeArtifacts([
      ...runnerOutput.artifactRefs,
      ...(input.additionalArtifacts ?? []).map((entry) => ArtifactSchema.parse(entry)),
      ...postRunnerGateEvidence.artifacts.map((entry) => ArtifactSchema.parse(entry)),
      artifact({ type: "review_report", ref: reviewReportRef, createdAt: completedAt }),
      artifact({ type: "cost_report", ref: costReportRef, createdAt: completedAt }),
    ]);
    const summaryRef = saveAttemptSummary({
      cwd: input.cwd,
      runId,
      stepId,
      attemptId,
      summary: {
        schemaVersion: "1",
        runId,
        stepId,
        attemptId,
        status,
        runnerStatus: runnerOutput.status,
        nextAction,
        gateResultsRef,
        reviewReportRef,
        costReportRef,
        modelInvocationRefs,
        artifactRefs: artifactsWithoutSummary.map((entry) => entry.ref),
        completedAt,
        ...(runnerOutput.error ? { error: runnerOutput.error } : {}),
      },
    });
    const artifacts = dedupeArtifacts([
      ...artifactsWithoutSummary,
      artifact({ type: "summary", ref: summaryRef, createdAt: completedAt }),
    ]);
    const finalAttempt = StepAttemptSchema.parse({
      ...existingAttempt,
      status,
      modelInvocationRefs,
      artifacts,
      completedAt,
    });
    const savedAttemptRef = saveStepAttempt({
      cwd: input.cwd,
      runId,
      attempt: finalAttempt,
    });

    appendAuditEvent(input.cwd, {
      eventType:
        runnerOutput.status === ContractValues.Completed ? "runner_attempt_completed" : "runner_attempt_failed",
      runId,
      timestamp: completedAt,
      payload: {
        stepId,
        attemptId,
        runner: input.runner.name,
        runnerStatus: runnerOutput.status,
        artifactRefs: runnerOutput.artifactRefs.map((entry) => entry.ref),
      },
    });
    appendAuditEvent(input.cwd, {
      eventType: "step_attempt_reviewed",
      runId,
      timestamp: completedAt,
      payload: {
        stepId,
        attemptId,
        verdict: reviewVerdict.verdict,
        safeToContinue: reviewVerdict.safeToContinue,
        reviewReportRef,
        gateResultsRef,
      },
    });
    appendAuditEvent(input.cwd, {
      eventType: "step_attempt_next_action",
      runId,
      timestamp: completedAt,
      payload: {
        stepId,
        attemptId,
        action: nextAction.type,
        status,
      },
    });

    const result: StepAttemptOrchestrationResult = {
      runId,
      stepId,
      attemptId,
      status,
      runnerStatus: runnerOutput.status,
      artifactRefs: artifacts,
      gateResults,
      gateResultsRef,
      reviewVerdict,
      reviewReportRef,
      attemptRef: savedAttemptRef,
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
