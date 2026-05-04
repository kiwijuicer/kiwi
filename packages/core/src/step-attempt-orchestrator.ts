import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import {
  Artifact,
  ArtifactSchema,
  GateResult,
  GateResultSchema,
  ReviewVerdict,
  ReviewVerdictSchema,
  RunnerName,
  Step,
  StepAttempt,
  StepAttemptSchema,
  StepAttemptStatus,
} from "@kiwi/contracts";
import { appendAuditEvent } from "./cost-ledger";
import { saveGateResults, summarizeGateResults } from "./quality-gates";
import {
  classifyReviewAction,
  ReviewAction,
  ReviewEngine,
  saveReviewVerdict,
  StubReviewEngine,
} from "./review-engine";
import { loadContextPackage, SchedulerDecision } from "./scheduler-policy";
import { ensureRunLayout, resolveRunArtifactPath } from "./run-store";

export type StepRunnerExecutionStatus =
  | "completed"
  | "failed"
  | "blocked"
  | "approval_required"
  | "timeout";

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
  reviewEngine?: ReviewEngine;
  now?: Date;
}

interface RunnerCostReport {
  schemaVersion: "1";
  runId: string;
  stepId: string;
  attemptId: string;
  runner: RunnerName;
  modelUsage: StepRunnerModelUsage;
  estimatedCostUsd: number;
  createdAt: string;
}

interface AttemptSummary {
  schemaVersion: "1";
  runId: string;
  stepId: string;
  attemptId: string;
  status: StepAttemptStatus;
  runnerStatus: StepRunnerExecutionStatus;
  nextAction: StepAttemptNextAction;
  gateResultsRef: string;
  reviewReportRef: string;
  costReportRef: string;
  artifactRefs: string[];
  completedAt: string;
  error?: StepRunnerExecutionError;
}

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

function attemptRef(stepId: string, attemptId: string): string {
  return `steps/${stepId}/${attemptId}/attempt.json`;
}

function loadStepAttempt(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}): StepAttempt {
  const relativePath = attemptRef(params.stepId, params.attemptId);
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  if (!existsSync(target)) {
    throw new Error(`step attempt not found: ${relativePath}`);
  }
  return StepAttemptSchema.parse(JSON.parse(readFileSync(target, "utf-8")));
}

function saveStepAttempt(params: {
  cwd: string;
  runId: string;
  attempt: StepAttempt;
}): string {
  const relativePath = attemptRef(params.attempt.stepId, params.attempt.attemptId);
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  writeJsonSafely(target, StepAttemptSchema.parse(params.attempt));
  return relativePath;
}

function artifact(params: {
  type: Artifact["type"];
  ref: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}): Artifact {
  const value: Artifact = {
    type: params.type,
    ref: params.ref,
    createdAt: params.createdAt,
  };
  if (params.metadata) value.metadata = params.metadata;
  return ArtifactSchema.parse(value);
}

function dedupeArtifacts(artifacts: Artifact[]): Artifact[] {
  const seen = new Set<string>();
  const deduped: Artifact[] = [];
  for (const entry of artifacts.map((item) => ArtifactSchema.parse(item))) {
    const key = `${entry.type}:${entry.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function saveRunnerCostReport(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  runner: RunnerName;
  modelUsage: StepRunnerModelUsage;
  createdAt: string;
}): string {
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/cost-report.json`;
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  const report: RunnerCostReport = {
    schemaVersion: "1",
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    runner: params.runner,
    modelUsage: params.modelUsage,
    estimatedCostUsd: 0,
    createdAt: params.createdAt,
  };
  writeJsonSafely(target, report);
  return relativePath;
}

function saveAttemptSummary(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  summary: AttemptSummary;
}): string {
  const relativePath = `steps/${params.stepId}/${params.attemptId}/artifacts/attempt-summary.json`;
  const target = resolveRunArtifactPath(params.runId, relativePath, params.cwd);
  writeJsonSafely(target, params.summary);
  return relativePath;
}

function ensureRunnerMatchesDecision(input: ExecuteStepAttemptInput): void {
  if (input.schedulerDecision.status !== "scheduled") {
    throw new Error(`cannot execute blocked scheduler decision: ${input.schedulerDecision.blockedReason}`);
  }
  if (input.schedulerDecision.runner !== input.runner.name) {
    throw new Error(
      `runner mismatch: scheduler selected ${input.schedulerDecision.runner}, got ${input.runner.name}`,
    );
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
  if (params.runnerStatus === "blocked" || params.runnerStatus === "approval_required") return "blocked";
  if (params.runnerStatus === "failed" || params.runnerStatus === "timeout") return "failed";
  if (!summarizeGateResults(params.gateResults).safeToContinue) return "failed";
  if (!params.reviewVerdict.safeToContinue) return "failed";
  return "completed";
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
    verdict: gateSummary.overallStatus === "blocked" ? "reject" : "needs_changes",
    safeToContinue: false,
    issues: [
      {
        code: "GATE_REVIEW_CONFLICT",
        title: "Positive review cannot override failing gates",
        severity: gateSummary.overallStatus === "blocked" ? "high" : "medium",
        detail: `Failing gates: ${gateSummary.failingGateIds.join(", ")} Blocked gates: ${gateSummary.blockedGateIds.join(", ")}`.trim(),
      },
    ],
    recommendedNextSteps: [
      gateSummary.overallStatus === "blocked"
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
    status: "fail",
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
      status: "failed",
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
        status: "running",
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
      runnerOutput = await input.runner.execute(
        buildRunnerInput(input, contextPackage, startedAt),
      );
    } catch (error) {
      runnerOutput = normalizeRunnerException(error).output;
    }

    runnerOutput = {
      ...runnerOutput,
      artifactRefs: runnerOutput.artifactRefs.map((entry) => ArtifactSchema.parse(entry)),
      gateResult: GateResultSchema.parse(runnerOutput.gateResult),
    };

    const gateResults = [
      runnerOutput.gateResult,
      ...(input.additionalGateResults ?? []).map((entry) => GateResultSchema.parse(entry)),
    ];
    const gateResultsRef = saveGateResults({
      cwd: input.cwd,
      runId,
      stepId,
      attemptId,
      gateResults,
    });

    const reviewEngine = input.reviewEngine ?? this.defaults.reviewEngine ?? new StubReviewEngine();
    const rawReviewVerdict = await reviewEngine.review({
      runId,
      stepId,
      attemptId,
      gateResults,
    });
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
      modelUsage: runnerOutput.modelUsage,
      createdAt: completedAt,
    });

    const artifactsWithoutSummary = dedupeArtifacts([
      ...runnerOutput.artifactRefs,
      ...(input.additionalArtifacts ?? []).map((entry) => ArtifactSchema.parse(entry)),
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
      artifacts,
      completedAt,
    });
    const savedAttemptRef = saveStepAttempt({
      cwd: input.cwd,
      runId,
      attempt: finalAttempt,
    });

    appendAuditEvent(input.cwd, {
      eventType: runnerOutput.status === "completed" ? "runner_attempt_completed" : "runner_attempt_failed",
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
