import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import {
  ApprovalDecision,
  ApprovalDecisionSchema,
  AttemptSummary,
  AttemptSummarySchema,
  ContractValues,
  FinalCostReport,
  FinalCostReportSchema,
  FinalVerdict,
  FinalVerdictSchema,
  GateTypes,
  GateType,
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
import { writeModelUsageSummary } from "./model-invocations";
import { loadAttemptDiff } from "./review-engine";
import { ensureRunLayout, loadRunManifest, loadTaskGraph, resolveRunArtifactPath } from "./run-store";

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
  modelUsageSummaryRef: string;
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

function tryReadGateResults(
  cwd: string,
  runId: string,
  stepId: string,
  attemptId: string,
): {
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

function tryReadReview(
  cwd: string,
  runId: string,
  stepId: string,
  attemptId: string,
): {
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

function tryReadAttemptSummary(
  cwd: string,
  runId: string,
  stepId: string,
  attemptId: string,
): {
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
  const target = resolveRunArtifactPath(params.runId, `approvals/${params.attemptId}.json`, params.cwd);
  if (!existsSync(target)) return null;
  return ApprovalDecisionSchema.parse(readJson(target));
}

export function updateRunStatus(params: { cwd: string; runId: string; status: RunStatus; now?: Date }): RunManifest {
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

export function refreshRunStatusFromAttempts(params: { cwd: string; runId: string; now?: Date }): RunManifest {
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const attempts = listStepAttemptEvidence(params.cwd, params.runId);
  if (attempts.length === 0) {
    return updateRunStatus({ ...params, status: "planned" });
  }

  if (attempts.some((entry) => entry.attempt.status === ContractValues.Blocked)) {
    return updateRunStatus({ ...params, status: "needs_approval" });
  }
  if (attempts.some((entry) => entry.attempt.status === ContractValues.Failed)) {
    return updateRunStatus({ ...params, status: ContractValues.Failed });
  }
  if (attempts.some((entry) => entry.attempt.status === ContractValues.Running)) {
    return updateRunStatus({ ...params, status: ContractValues.Running });
  }

  const completedStepIds = new Set(
    attempts.filter((entry) => entry.attempt.status === ContractValues.Completed).map((entry) => entry.stepId),
  );
  const allStepsCompleted = taskGraph.steps.every((step) => completedStepIds.has(step.stepId));
  return updateRunStatus({
    ...params,
    status: allStepsCompleted ? ContractValues.Completed : ContractValues.Running,
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

const REQUIRED_GATE_TYPES = new Set<GateType>([
  ContractValues.Typecheck,
  ContractValues.Lint,
  ContractValues.Tests,
  GateTypes.ForbiddenFileChecks,
  GateTypes.SecretsCheck,
]);

function requiredGateTypes(requiredGates: string[]): GateType[] {
  return requiredGates.filter((entry): entry is GateType => REQUIRED_GATE_TYPES.has(entry as GateType));
}

function evidenceFailureReasons(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attempt: StepAttemptEvidence;
  requiredGates: string[];
}): string[] {
  const failures: string[] = [];
  const required = requiredGateTypes(params.requiredGates);
  for (const gateType of required) {
    const gate = params.attempt.gateResults.find((entry) => entry.gateType === gateType);
    if (!gate) {
      failures.push(`missing gate ${gateType}`);
      continue;
    }
    if (gate.status !== ContractValues.Pass) {
      failures.push(`gate ${gate.gateId} is ${gate.status}`);
    }
  }

  if (!params.attempt.reviewVerdict) {
    failures.push("missing review verdict");
  } else if (!params.attempt.reviewVerdict.safeToContinue) {
    failures.push(`review verdict is ${params.attempt.reviewVerdict.verdict}`);
  }

  const diff = loadAttemptDiff({
    cwd: params.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attempt.attemptId,
  });
  if (!diff) return failures;

  if (params.attempt.reviewVerdict?.subject?.hash !== diff.diffHash) {
    failures.push("review verdict is not bound to current diff hash");
  }
  for (const gateType of required) {
    const gate = params.attempt.gateResults.find((entry) => entry.gateType === gateType);
    if (gate?.subject?.hash !== diff.diffHash) {
      failures.push(`gate ${gateType} is not bound to current diff hash`);
    }
  }

  return failures;
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
    return attempt?.attempt.status !== ContractValues.Completed;
  });

  if (incomplete.length > 0) {
    throw new Error(`Cannot execute ${params.stepId} before dependencies complete: ${incomplete.join(", ")}`);
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
  modelUsageSummaryRef: string;
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
    `modelUsageSummary: ${params.modelUsageSummaryRef}`,
    "",
  ];
  writeFileSync(resolveRunArtifactPath(params.runId, ref, params.cwd), lines.join("\n"), "utf-8");
  return ref;
}

interface FinalEvidenceSummary {
  completedStepIds: string[];
  failedStepIds: string[];
  blockedStepIds: string[];
  missingStepIds: string[];
  gateResultRefs: string[];
  reviewReportRefs: string[];
  evidenceFailures: string[];
}

function collectFinalEvidence(params: {
  cwd: string;
  runId: string;
  steps: ReturnType<typeof loadTaskGraph>["steps"];
  latest: Map<string, StepAttemptEvidence>;
}): FinalEvidenceSummary {
  const summary: FinalEvidenceSummary = {
    completedStepIds: [],
    failedStepIds: [],
    blockedStepIds: [],
    missingStepIds: [],
    gateResultRefs: [],
    reviewReportRefs: [],
    evidenceFailures: [],
  };

  for (const step of params.steps) {
    const attempt = params.latest.get(step.stepId);
    if (!attempt) {
      summary.missingStepIds.push(step.stepId);
      continue;
    }
    if (attempt.gateResultsRef) summary.gateResultRefs.push(attempt.gateResultsRef);
    if (attempt.reviewReportRef) summary.reviewReportRefs.push(attempt.reviewReportRef);
    if (attempt.attempt.status === ContractValues.Completed) summary.completedStepIds.push(step.stepId);
    if (attempt.attempt.status === ContractValues.Failed) summary.failedStepIds.push(step.stepId);
    if (attempt.attempt.status === ContractValues.Blocked) summary.blockedStepIds.push(step.stepId);

    const failures = evidenceFailureReasons({
      cwd: params.cwd,
      runId: params.runId,
      stepId: step.stepId,
      attempt,
      requiredGates: step.requiredGates,
    });
    if (failures.length > 0) {
      if (!summary.failedStepIds.includes(step.stepId)) summary.failedStepIds.push(step.stepId);
      summary.evidenceFailures.push(`${step.stepId}: ${failures.join("; ")}`);
    }
  }

  return summary;
}

export function finalizeRun(params: { cwd: string; runId: string; now?: Date }): FinalizeRunResult {
  ensureRunLayout(params.runId, params.cwd);
  const now = params.now ?? new Date();
  const taskGraph = loadTaskGraph(params.runId, params.cwd);
  const attempts = listStepAttemptEvidence(params.cwd, params.runId);
  const latest = latestAttemptByStep(attempts);
  const evidence = collectFinalEvidence({
    cwd: params.cwd,
    runId: params.runId,
    steps: taskGraph.steps,
    latest,
  });

  const safeToApply =
    evidence.failedStepIds.length === 0 && evidence.blockedStepIds.length === 0 && evidence.missingStepIds.length === 0;
  const verdict = FinalVerdictSchema.parse({
    schemaVersion: "1",
    runId: params.runId,
    verdict: safeToApply ? ContractValues.Pass : ContractValues.NeedsChanges,
    safeToApply,
    completedStepIds: evidence.completedStepIds,
    failedStepIds: evidence.failedStepIds,
    blockedStepIds: evidence.blockedStepIds,
    missingStepIds: evidence.missingStepIds,
    gateResultRefs: evidence.gateResultRefs,
    reviewReportRefs: evidence.reviewReportRefs,
    reason: safeToApply
      ? "All planned steps have completed attempts with current gate and review evidence"
      : `Run has failed, blocked, missing, or stale evidence${
          evidence.evidenceFailures.length > 0 ? `: ${evidence.evidenceFailures.join(" | ")}` : ""
        }`,
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
  const modelUsageSummary = writeModelUsageSummary({
    cwd: params.cwd,
    runId: params.runId,
    now,
  });
  writeJsonSafely(resolveRunArtifactPath(params.runId, verdictRef, params.cwd), verdict);
  writeJsonSafely(resolveRunArtifactPath(params.runId, costReportRef, params.cwd), costReport);
  const summaryRef = writeFinalSummary({
    cwd: params.cwd,
    runId: params.runId,
    verdict,
    costReportRef,
    modelUsageSummaryRef: modelUsageSummary.ref,
  });
  const run = updateRunStatus({
    cwd: params.cwd,
    runId: params.runId,
    status: safeToApply ? ContractValues.Completed : ContractValues.Failed,
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
      modelUsageSummaryRef: modelUsageSummary.ref,
    },
  });

  return {
    verdict,
    costReport,
    summaryRef,
    verdictRef,
    costReportRef,
    modelUsageSummaryRef: modelUsageSummary.ref,
    run,
  };
}
