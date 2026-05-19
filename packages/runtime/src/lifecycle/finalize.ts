import { createHash } from "crypto";
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
  appendModelInvocation,
  buildFinalCostReportFromModelInvocations,
  ensureRunLayout,
  latestAttemptByStep,
  loadEffectivePolicy,
  loadEffectiveRegistry,
  loadTaskGraph,
  listStepAttemptEvidence,
  resolveRunArtifactPath,
  StepAttemptEvidence,
  updateRunStatus,
  writeJsonSafely,
  writeModelUsageSummary,
} from "@kiwi/core";
import { loadAttemptDiff, ReviewEngine, ReviewExecutionResult } from "../review/review-engine";
import { ProviderReviewEngine } from "../review/provider-review-engine";

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

  if (!diff) {
    return failures;
  }

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
    if (attempt.gateResultsRef) {
      summary.gateResultRefs.push(attempt.gateResultsRef);
    }
    if (attempt.reviewReportRef) {
      summary.reviewReportRefs.push(attempt.reviewReportRef);
    }
    if (attempt.attempt.status === ContractValues.Completed) {
      summary.completedStepIds.push(step.stepId);
    }
    if (attempt.attempt.status === ContractValues.Failed) {
      summary.failedStepIds.push(step.stepId);
    }
    if (attempt.attempt.status === ContractValues.Blocked) {
      summary.blockedStepIds.push(step.stepId);
    }

    const failures = evidenceFailureReasons({
      cwd: params.cwd,
      runId: params.runId,
      stepId: step.stepId,
      attempt,
      requiredGates: attempt.schedulerDecision?.requiredGates ?? step.requiredGates,
    });

    if (failures.length > 0) {
      if (!summary.failedStepIds.includes(step.stepId)) {
        summary.failedStepIds.push(step.stepId);
      }
      summary.evidenceFailures.push(`${step.stepId}: ${failures.join("; ")}`);
    }
  }

  return summary;
}

interface FinalFrontierReviewResult {
  verdictRef: string | null;
  safeToApply: boolean;
  reason: string;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function buildFinalReviewDigest(params: {
  cwd: string;
  runId: string;
  taskGraph: ReturnType<typeof loadTaskGraph>;
  latest: Map<string, StepAttemptEvidence>;
  evidence: FinalEvidenceSummary;
  costReport: FinalCostReport;
}): { digest: string; digestHash: string } {
  const steps = params.taskGraph.steps.map((step) => {
    const attempt = params.latest.get(step.stepId);
    const diff = attempt
      ? loadAttemptDiff({
          cwd: params.cwd,
          runId: params.runId,
          stepId: step.stepId,
          attemptId: attempt.attemptId,
        })
      : null;

    return {
      stepId: step.stepId,
      type: step.type,
      title: step.title,
      successCriteria: step.successCriteria,
      requiredGates: step.requiredGates,
      attemptId: attempt?.attemptId ?? null,
      attemptStatus: attempt?.attempt.status ?? null,
      diffHash: diff?.diffHash ?? null,
      gateResultsRef: attempt?.gateResultsRef ?? null,
      reviewReportRef: attempt?.reviewReportRef ?? null,
    };
  });
  const digest = JSON.stringify(
    {
      schemaVersion: "1",
      runId: params.runId,
      taskGraph: {
        planId: params.taskGraph.planId,
        summary: params.taskGraph.summary,
        acceptanceCriteria: params.taskGraph.acceptanceCriteria,
        riskScore: params.taskGraph.riskScore,
        complexityScore: params.taskGraph.complexityScore,
        steps,
      },
      deterministicEvidence: params.evidence,
      costSummary: params.costReport,
    },
    null,
    2,
  );

  return { digest, digestHash: sha256(digest) };
}

async function runFinalFrontierReview(params: {
  cwd: string;
  runId: string;
  taskGraph: ReturnType<typeof loadTaskGraph>;
  latest: Map<string, StepAttemptEvidence>;
  evidence: FinalEvidenceSummary;
  costReport: FinalCostReport;
  now: Date;
  reviewEngine?: ReviewEngine;
}): Promise<FinalFrontierReviewResult> {
  const firstStep = params.taskGraph.steps[0];

  if (!firstStep) {
    return {
      verdictRef: null,
      safeToApply: false,
      reason: "Frontier final review blocked because the task graph has no steps",
    };
  }
  const { digest, digestHash } = buildFinalReviewDigest(params);
  const engine =
    params.reviewEngine ??
    new ProviderReviewEngine({
      cwd: params.cwd,
      policy: loadEffectivePolicy(params.cwd),
      registryModels: loadEffectiveRegistry(params.cwd).models,
    });

  let result: ReviewExecutionResult;

  try {
    if (engine.reviewWithExecution) {
      result = await engine.reviewWithExecution({
        runId: params.runId,
        stepId: firstStep.stepId,
        attemptId: "attempt_final_review",
        step: firstStep,
        gateResults: [],
        diff: digest,
        diffHash: digestHash,
        requestedCapability: ContractValues.Frontier,
      });
    } else {
      result = {
        verdict: await engine.review({
          runId: params.runId,
          stepId: firstStep.stepId,
          attemptId: "attempt_final_review",
          step: firstStep,
          gateResults: [],
          diff: digest,
          diffHash: digestHash,
          requestedCapability: ContractValues.Frontier,
        }),
        metadata: {
          modelId: engine.name,
          providerName: engine.name,
          requestedCapability: ContractValues.Frontier,
          modelUsage: { inputTokens: 0, outputTokens: 0 },
          estimatedCostUsd: 0,
          diffHash: digestHash,
        },
      };
    }
  } catch (error) {
    return {
      verdictRef: null,
      safeToApply: false,
      reason: `Frontier final review unavailable or failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const verdictRef = "final/final-review-report.json";
  writeJsonSafely(resolveRunArtifactPath(params.runId, verdictRef, params.cwd), result.verdict);
  appendModelInvocation(params.cwd, {
    schemaVersion: "1",
    runId: params.runId,
    phase: ContractValues.Reviewer,
    stepId: firstStep.stepId,
    attemptId: "attempt_final_review",
    agentRole: ContractValues.Reviewer,
    requestedCapability: result.metadata.requestedCapability ?? ContractValues.Frontier,
    selectedCapability: result.metadata.selectedCapability ?? ContractValues.Frontier,
    modelId: result.metadata.modelId,
    providerName: result.metadata.providerName,
    runner: null,
    accessMode: result.metadata.accessMode ?? null,
    usage: result.metadata.modelUsage,
    usagePrecision: "estimated",
    estimatedCostUsd: result.metadata.estimatedCostUsd,
    status: result.verdict.safeToContinue ? ContractValues.Completed : ContractValues.Failed,
    evidenceRefs: [verdictRef],
    startedAt: params.now.toISOString(),
    completedAt: params.now.toISOString(),
  });

  if (!result.verdict.safeToContinue) {
    return {
      verdictRef,
      safeToApply: false,
      reason: `Frontier final review is ${result.verdict.verdict}`,
    };
  }

  return {
    verdictRef,
    safeToApply: true,
    reason: "All deterministic evidence is green and frontier final review is safe to continue",
  };
}

export async function finalizeRun(params: {
  cwd: string;
  runId: string;
  now?: Date;
  reviewEngine?: ReviewEngine;
}): Promise<FinalizeRunResult> {
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
  const preReviewCostReport = FinalCostReportSchema.parse(
    buildFinalCostReportFromModelInvocations({
      cwd: params.cwd,
      runId: params.runId,
      now,
    }),
  );
  const deterministicSafe =
    evidence.failedStepIds.length === 0 && evidence.blockedStepIds.length === 0 && evidence.missingStepIds.length === 0;
  const finalReview = deterministicSafe
    ? await runFinalFrontierReview({
        cwd: params.cwd,
        runId: params.runId,
        taskGraph,
        latest,
        evidence,
        costReport: preReviewCostReport,
        now,
        ...(params.reviewEngine ? { reviewEngine: params.reviewEngine } : {}),
      })
    : {
        verdictRef: null,
        safeToApply: false,
        reason: `Run has failed, blocked, missing, or stale evidence${
          evidence.evidenceFailures.length > 0 ? `: ${evidence.evidenceFailures.join(" | ")}` : ""
        }`,
      };
  const safeToApply = deterministicSafe && finalReview.safeToApply;
  const costReport = FinalCostReportSchema.parse(
    buildFinalCostReportFromModelInvocations({
      cwd: params.cwd,
      runId: params.runId,
      now,
    }),
  );
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
    reviewReportRefs: finalReview.verdictRef ? [...evidence.reviewReportRefs, finalReview.verdictRef] : evidence.reviewReportRefs,
    reason: finalReview.reason,
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
