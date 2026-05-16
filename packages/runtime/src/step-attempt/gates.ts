import {
  Artifact,
  ArtifactSchema,
  ContractValues,
  EvidenceSubject,
  GateResult,
  GateResultSchema,
  KiwiPolicy,
  ReviewVerdict,
  ReviewVerdictSchema,
  StepAttemptStatus,
} from "@kiwi/contracts";
import { runForbiddenFileGate, runSecretsScanGate, saveGateResults, summarizeGateResults } from "../quality-gates";
import type { AttemptDiff } from "../review-engine";
import type { ExecuteStepAttemptInput, StepRunnerExecutionStatus } from "../step-runner-types";
import { auditDiffGatesExecuted } from "./audit";

export function mapRunnerStatusToAttemptStatus(params: {
  runnerStatus: StepRunnerExecutionStatus;
  reviewVerdict: ReviewVerdict;
  gateResults: GateResult[];
}): StepAttemptStatus {
  if (params.runnerStatus === ContractValues.Blocked || params.runnerStatus === "approval_required") {
    return ContractValues.Blocked;
  }
  if (params.runnerStatus === ContractValues.Failed || params.runnerStatus === "timeout") return ContractValues.Failed;
  const gateSummary = summarizeGateResults(params.gateResults);
  if (gateSummary.blockedGateIds.length > 0) return ContractValues.Blocked;
  if (!gateSummary.safeToContinue) return ContractValues.Failed;
  if (!params.reviewVerdict.safeToContinue) return ContractValues.Failed;
  return ContractValues.Completed;
}

function bindGateSubject(gate: GateResult, subject: EvidenceSubject | null): GateResult {
  if (!subject || gate.subject) return GateResultSchema.parse(gate);
  return GateResultSchema.parse({ ...gate, subject });
}

export function enforceGateResultsBeforePositiveReview(params: {
  gateResults: GateResult[];
  reviewVerdict: ReviewVerdict;
  subject?: EvidenceSubject;
}): ReviewVerdict {
  const gateSummary = summarizeGateResults(params.gateResults);
  if (gateSummary.safeToContinue || !params.reviewVerdict.safeToContinue) {
    return ReviewVerdictSchema.parse(
      params.subject && !params.reviewVerdict.subject
        ? { ...params.reviewVerdict, subject: params.subject }
        : params.reviewVerdict,
    );
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
    ...(params.subject ? { subject: params.subject } : {}),
  });
}

function policyGateResults(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  attemptDiff: AttemptDiff | null;
  requiredGates: string[];
  policy?: KiwiPolicy;
  approved?: boolean;
  approvedFiles?: string[];
}): GateResult[] {
  if (!params.policy || !params.attemptDiff) return [];
  const gateResults: GateResult[] = [];
  if (params.requiredGates.includes("forbidden_file_checks")) {
    gateResults.push(
      runForbiddenFileGate({
        cwd: params.cwd,
        runId: params.runId,
        stepId: params.stepId,
        attemptId: params.attemptId,
        diff: params.attemptDiff.diff,
        diffHash: params.attemptDiff.diffHash,
        policy: params.policy,
        ...(params.approved !== undefined ? { approvedPaths: params.approved } : {}),
        ...(params.approvedFiles !== undefined ? { approvedFiles: params.approvedFiles } : {}),
      }),
    );
  }
  if (params.requiredGates.includes("secrets_check")) {
    gateResults.push(
      runSecretsScanGate({
        cwd: params.cwd,
        runId: params.runId,
        stepId: params.stepId,
        attemptId: params.attemptId,
        diff: params.attemptDiff.diff,
        diffHash: params.attemptDiff.diffHash,
        policy: params.policy,
      }),
    );
  }
  return gateResults;
}

export async function coordinateAttemptGates<TCommandPolicy>(params: {
  input: ExecuteStepAttemptInput<TCommandPolicy>;
  runId: string;
  stepId: string;
  attemptId: string;
  runnerGateResult: GateResult;
  attemptDiff: AttemptDiff | null;
  diffSubject: EvidenceSubject | null;
}): Promise<{ gateResults: GateResult[]; gateResultsRef: string; postRunnerArtifacts: Artifact[] }> {
  const postRunnerGateEvidence = params.input.postRunnerGateExecutor
    ? await params.input.postRunnerGateExecutor({
        diff: params.attemptDiff?.diff ?? null,
        diffHash: params.attemptDiff?.diffHash ?? null,
        startedAt: new Date().toISOString(),
      })
    : { gateResults: [], artifacts: [] };

  const diffGateResults = policyGateResults({
    cwd: params.input.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    attemptDiff: params.attemptDiff,
    requiredGates: params.input.schedulerDecision.requiredGates,
    ...(params.input.policy ? { policy: params.input.policy } : {}),
    ...(params.input.approved !== undefined ? { approved: params.input.approved } : {}),
    ...(params.input.approvedFiles !== undefined ? { approvedFiles: params.input.approvedFiles } : {}),
  });
  auditDiffGatesExecuted({
    cwd: params.input.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    diffHash: params.attemptDiff?.diffHash ?? null,
    gateResults: diffGateResults,
  });

  const gateResults = [
    bindGateSubject(params.runnerGateResult, params.diffSubject),
    ...(params.input.additionalGateResults ?? []).map((entry) => GateResultSchema.parse(entry)),
    ...postRunnerGateEvidence.gateResults.map((entry) => GateResultSchema.parse(entry)),
    ...diffGateResults,
  ];
  const gateResultsRef = saveGateResults({
    cwd: params.input.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    gateResults,
  });

  return {
    gateResults,
    gateResultsRef,
    postRunnerArtifacts: postRunnerGateEvidence.artifacts.map((entry) => ArtifactSchema.parse(entry)),
  };
}
