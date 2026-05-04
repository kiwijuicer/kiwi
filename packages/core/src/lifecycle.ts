import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import path from "path";
import {
  ApprovalDecision,
  ApprovalDecisionSchema,
  AttemptSummary,
  AttemptSummarySchema,
  FinalCostReport,
  FinalCostReportSchema,
  FinalVerdict,
  FinalVerdictSchema,
  GateResult,
  ReviewVerdict,
  ReviewVerdictSchema,
  RunManifest,
  RunManifestSchema,
  RunStatus,
  StepAttempt,
  StepAttemptSchema,
} from "@kiwi/contracts";
import { appendAuditEvent } from "./cost-ledger";
import {
  ensureRunLayout,
  loadRunManifest,
  loadTaskGraph,
  resolveRunArtifactPath,
} from "./run-store";

export interface StepAttemptEvidence {
  stepId: string;
  attemptId: string;
  attempt: StepAttempt;
  gateResultsRef?: string;
  gateResults: GateResult[];
  reviewReportRef?: string;
  reviewVerdict?: ReviewVerdict;
  summaryRef?: string;
  summary?: AttemptSummary;
}

export interface FinalizeRunResult {
  verdict: FinalVerdict;
  costReport: FinalCostReport;
  summaryRef: string;
  verdictRef: string;
  costReportRef: string;
  run: RunManifest;
}

function writeJsonSafely(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, target);
}

function readJson(target: string): unknown {
  return JSON.parse(readFileSync(target, "utf-8")) as unknown;
}

function attemptRoot(cwd: string, runId: string, stepId: string, attemptId: string): string {
  return resolveRunArtifactPath(runId, `steps/${stepId}/${attemptId}`, cwd);
}

function tryReadGateResults(cwd: string, runId: string, stepId: string, attemptId: string): {
  ref?: string;
  gateResults: GateResult[];
} {
  const ref = `steps/${stepId}/${attemptId}/gate-results.json`;
  const target = resolveRunArtifactPath(runId, ref, cwd);
  if (!existsSync(target)) return { gateResults: [] };
  return {
    ref,
    gateResults: readJson(target) as GateResult[],
  };
}

function tryReadReview(cwd: string, runId: string, stepId: string, attemptId: string): {
  ref?: string;
  reviewVerdict?: ReviewVerdict;
} {
  const ref = `steps/${stepId}/${attemptId}/artifacts/review-report.json`;
  const target = resolveRunArtifactPath(runId, ref, cwd);
  if (!existsSync(target)) return {};
  return {
    ref,
    reviewVerdict: ReviewVerdictSchema.parse(readJson(target)),
  };
}

function tryReadAttemptSummary(cwd: string, runId: string, stepId: string, attemptId: string): {
  ref?: string;
  summary?: AttemptSummary;
} {
  const ref = `steps/${stepId}/${attemptId}/artifacts/attempt-summary.json`;
  const target = resolveRunArtifactPath(runId, ref, cwd);
  if (!existsSync(target)) return {};
  try {
    return {
      ref,
      summary: AttemptSummarySchema.parse(readJson(target)),
    };
  } catch {
    return { ref };
  }
}

export function listStepAttemptEvidence(cwd: string, runId: string): StepAttemptEvidence[] {
  const stepsRoot = resolveRunArtifactPath(runId, "steps", cwd);
  if (!existsSync(stepsRoot)) return [];

  const entries: StepAttemptEvidence[] = [];
  for (const stepEntry of readdirSync(stepsRoot, { withFileTypes: true })) {
    if (!stepEntry.isDirectory()) continue;
    const stepId = stepEntry.name;
    const stepPath = path.join(stepsRoot, stepId);
    for (const attemptEntry of readdirSync(stepPath, { withFileTypes: true })) {
      if (!attemptEntry.isDirectory()) continue;
      const attemptId = attemptEntry.name;
      const attemptPath = path.join(stepPath, attemptId, "attempt.json");
      if (!existsSync(attemptPath)) continue;

      const attempt = StepAttemptSchema.parse(readJson(attemptPath));
      const gateEvidence = tryReadGateResults(cwd, runId, stepId, attemptId);
      const reviewEvidence = tryReadReview(cwd, runId, stepId, attemptId);
      const summaryEvidence = tryReadAttemptSummary(cwd, runId, stepId, attemptId);
      const entry: StepAttemptEvidence = {
        stepId,
        attemptId,
        attempt,
        gateResults: gateEvidence.gateResults,
      };
      if (gateEvidence.ref) entry.gateResultsRef = gateEvidence.ref;
      if (reviewEvidence.ref) entry.reviewReportRef = reviewEvidence.ref;
      if (reviewEvidence.reviewVerdict) entry.reviewVerdict = reviewEvidence.reviewVerdict;
      if (summaryEvidence.ref) entry.summaryRef = summaryEvidence.ref;
      if (summaryEvidence.summary) entry.summary = summaryEvidence.summary;
      entries.push(entry);
    }
  }

  return entries.sort((a, b) => a.attempt.startedAt.localeCompare(b.attempt.startedAt));
}

export function recordApprovalDecision(params: {
  cwd: string;
  runId: string;
  attemptId: string;
  state?: ApprovalDecision["state"];
  reason: string;
  approvedBy?: string;
  now?: Date;
}): ApprovalDecision {
  ensureRunLayout(params.runId, params.cwd);
  const now = params.now ?? new Date();
  const decision = ApprovalDecisionSchema.parse({
    schemaVersion: "1",
    runId: params.runId,
    attemptId: params.attemptId,
    state: params.state ?? "auto",
    reason: params.reason,
    approvedBy: params.approvedBy ?? "local-operator",
    createdAt: now.toISOString(),
  });
  const ref = `approvals/${params.attemptId}.json`;
  writeJsonSafely(resolveRunArtifactPath(params.runId, ref, params.cwd), decision);
  appendAuditEvent(params.cwd, {
    eventType: "approval_decision_recorded",
    runId: params.runId,
    timestamp: decision.createdAt,
    payload: {
      attemptId: params.attemptId,
      state: decision.state,
      approvedBy: decision.approvedBy,
    },
  });
  return decision;
}

export function loadApprovalDecision(params: {
  cwd: string;
  runId: string;
  attemptId: string;
}): ApprovalDecision | null {
  const target = resolveRunArtifactPath(
    params.runId,
    `approvals/${params.attemptId}.json`,
    params.cwd,
  );
  if (!existsSync(target)) return null;
  return ApprovalDecisionSchema.parse(readJson(target));
}

export function updateRunStatus(params: {
  cwd: string;
  runId: string;
  status: RunStatus;
  now?: Date;
}): RunManifest {
  const current = loadRunManifest(params.runId, params.cwd);
  const updated = RunManifestSchema.parse({
    ...current,
    status: params.status,
    updatedAt: (params.now ?? new Date()).toISOString(),
  });
  writeJsonSafely(resolveRunArtifactPath(params.runId, "run.json", params.cwd), updated);
  appendAuditEvent(params.cwd, {
    eventType: "run_status_updated",
    runId: params.runId,
    timestamp: updated.updatedAt,
    payload: { status: params.status },
  });
  return updated;
}

export function refreshRunStatusFromAttempts(params: {
  cwd: string;
  runId: string;
  now?: Date;
}): RunManifest {
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const attempts = listStepAttemptEvidence(params.cwd, params.runId);
  if (attempts.length === 0) {
    return updateRunStatus({ ...params, status: "planned" });
  }

  if (attempts.some((entry) => entry.attempt.status === "blocked")) {
    return updateRunStatus({ ...params, status: "needs_approval" });
  }
  if (attempts.some((entry) => entry.attempt.status === "failed")) {
    return updateRunStatus({ ...params, status: "failed" });
  }
  if (attempts.some((entry) => entry.attempt.status === "running")) {
    return updateRunStatus({ ...params, status: "running" });
  }

  const completedStepIds = new Set(
    attempts
      .filter((entry) => entry.attempt.status === "completed")
      .map((entry) => entry.stepId),
  );
  const allStepsCompleted = taskGraph.steps.every((step) => completedStepIds.has(step.stepId));
  return updateRunStatus({
    ...params,
    status: allStepsCompleted ? "completed" : "running",
  });
}

function latestAttemptByStep(attempts: StepAttemptEvidence[]): Map<string, StepAttemptEvidence> {
  const latest = new Map<string, StepAttemptEvidence>();
  for (const attempt of attempts) {
    const current = latest.get(attempt.stepId);
    if (!current || current.attempt.startedAt.localeCompare(attempt.attempt.startedAt) <= 0) {
      latest.set(attempt.stepId, attempt);
    }
  }
  return latest;
}

export function assertStepDependenciesCompleted(params: {
  cwd: string;
  runId: string;
  stepId: string;
  dependsOn: string[];
}): void {
  if (params.dependsOn.length === 0) return;

  const latest = latestAttemptByStep(listStepAttemptEvidence(params.cwd, params.runId));
  const incomplete = params.dependsOn.filter((stepId) => {
    const attempt = latest.get(stepId);
    return attempt?.attempt.status !== "completed";
  });

  if (incomplete.length > 0) {
    throw new Error(
      `Cannot execute ${params.stepId} before dependencies complete: ${incomplete.join(", ")}`,
    );
  }
}

function sumRunnerCost(cwd: string, runId: string, attempts: StepAttemptEvidence[]): number {
  let total = 0;
  for (const attempt of attempts) {
    for (const artifact of attempt.attempt.artifacts) {
      if (artifact.type !== "cost_report") continue;
      const target = resolveRunArtifactPath(runId, artifact.ref, cwd);
      if (!existsSync(target)) continue;
      const parsed = readJson(target) as { estimatedCostUsd?: number };
      total += parsed.estimatedCostUsd ?? 0;
    }
  }
  return total;
}

function readPlannerCost(cwd: string, runId: string): number {
  const target = resolveRunArtifactPath(runId, "plan/cost-report.json", cwd);
  if (!existsSync(target)) return 0;
  const parsed = readJson(target) as { cost?: { estimatedUsd?: number } };
  return parsed.cost?.estimatedUsd ?? 0;
}

function writeFinalSummary(params: {
  cwd: string;
  runId: string;
  verdict: FinalVerdict;
  costReportRef: string;
}): string {
  const ref = "final/final-summary.md";
  const lines = [
    `# Final Summary for ${params.runId}`,
    "",
    `verdict: ${params.verdict.verdict}`,
    `safeToApply: ${params.verdict.safeToApply}`,
    `reason: ${params.verdict.reason}`,
    `completedSteps: ${params.verdict.completedStepIds.length}`,
    `failedSteps: ${params.verdict.failedStepIds.length}`,
    `blockedSteps: ${params.verdict.blockedStepIds.length}`,
    `missingSteps: ${params.verdict.missingStepIds.length}`,
    `costReport: ${params.costReportRef}`,
    "",
  ];
  writeFileSync(resolveRunArtifactPath(params.runId, ref, params.cwd), lines.join("\n"), "utf-8");
  return ref;
}

export function finalizeRun(params: {
  cwd: string;
  runId: string;
  now?: Date;
}): FinalizeRunResult {
  ensureRunLayout(params.runId, params.cwd);
  const now = params.now ?? new Date();
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const attempts = listStepAttemptEvidence(params.cwd, params.runId);
  const latest = latestAttemptByStep(attempts);

  const completedStepIds: string[] = [];
  const failedStepIds: string[] = [];
  const blockedStepIds: string[] = [];
  const missingStepIds: string[] = [];
  const gateResultRefs: string[] = [];
  const reviewReportRefs: string[] = [];

  for (const step of taskGraph.steps) {
    const attempt = latest.get(step.stepId);
    if (!attempt) {
      missingStepIds.push(step.stepId);
      continue;
    }
    if (attempt.gateResultsRef) gateResultRefs.push(attempt.gateResultsRef);
    if (attempt.reviewReportRef) reviewReportRefs.push(attempt.reviewReportRef);
    if (attempt.attempt.status === "completed") completedStepIds.push(step.stepId);
    if (attempt.attempt.status === "failed") failedStepIds.push(step.stepId);
    if (attempt.attempt.status === "blocked") blockedStepIds.push(step.stepId);
  }

  const safeToApply =
    failedStepIds.length === 0 &&
    blockedStepIds.length === 0 &&
    missingStepIds.length === 0;
  const verdict = FinalVerdictSchema.parse({
    schemaVersion: "1",
    runId: params.runId,
    verdict: safeToApply ? "pass" : "needs_changes",
    safeToApply,
    completedStepIds,
    failedStepIds,
    blockedStepIds,
    missingStepIds,
    gateResultRefs,
    reviewReportRefs,
    reason: safeToApply
      ? "All planned steps have completed attempts"
      : "Run has failed, blocked, or missing step attempts",
    createdAt: now.toISOString(),
  });

  const plannerCostUsd = readPlannerCost(params.cwd, params.runId);
  const runnerCostUsd = sumRunnerCost(params.cwd, params.runId, attempts);
  const costReport = FinalCostReportSchema.parse({
    schemaVersion: "1",
    runId: params.runId,
    plannerCostUsd,
    runnerCostUsd,
    totalEstimatedUsd: plannerCostUsd + runnerCostUsd,
    currency: "USD",
    createdAt: now.toISOString(),
  });

  const verdictRef = "final/final-verdict.json";
  const costReportRef = "final/final-cost-report.json";
  writeJsonSafely(resolveRunArtifactPath(params.runId, verdictRef, params.cwd), verdict);
  writeJsonSafely(resolveRunArtifactPath(params.runId, costReportRef, params.cwd), costReport);
  const summaryRef = writeFinalSummary({
    cwd: params.cwd,
    runId: params.runId,
    verdict,
    costReportRef,
  });
  const run = updateRunStatus({
    cwd: params.cwd,
    runId: params.runId,
    status: safeToApply ? "completed" : "failed",
    now,
  });

  appendAuditEvent(params.cwd, {
    eventType: "run_finalized",
    runId: params.runId,
    timestamp: now.toISOString(),
    payload: {
      verdict: verdict.verdict,
      safeToApply,
      summaryRef,
      verdictRef,
      costReportRef,
    },
  });

  return {
    verdict,
    costReport,
    summaryRef,
    verdictRef,
    costReportRef,
    run,
  };
}
