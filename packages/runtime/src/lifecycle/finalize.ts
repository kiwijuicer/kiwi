import { writeFileSync } from "fs";
import {
  ContractValues,
  FinalCostReport,
  FinalCostReportSchema,
  FinalVerdict,
  FinalVerdictSchema,
  GateType,
  GateTypes,
} from "@kiwi/contracts";
import {
  appendAuditEvent,
  buildFinalCostReportFromModelInvocations,
  ensureRunLayout,
  latestAttemptByStep,
  loadTaskGraph,
  listStepAttemptEvidence,
  resolveRunArtifactPath,
  StepAttemptEvidence,
  updateRunStatus,
  writeJsonSafely,
  writeModelUsageSummary,
} from "@kiwi/core";
import { loadAttemptDiff } from "../review-engine";

export interface FinalizeRunResult {
  verdict: FinalVerdict;
  costReport: FinalCostReport;
  summaryRef: string;
  verdictRef: string;
  costReportRef: string;
  modelUsageSummaryRef: string;
  run: ReturnType<typeof updateRunStatus>;
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
      requiredGates: attempt.schedulerDecision?.requiredGates ?? step.requiredGates,
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

  const costReport = FinalCostReportSchema.parse(
    buildFinalCostReportFromModelInvocations({
      cwd: params.cwd,
      runId: params.runId,
      now,
    }),
  );

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
