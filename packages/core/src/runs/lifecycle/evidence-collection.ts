import { existsSync, readdirSync } from "fs";
import path from "path";
import {
  AttemptSummary,
  AttemptSummarySchema,
  ContractValues,
  GateResult,
  ReviewVerdict,
  ReviewVerdictSchema,
  SchedulerDecision,
  SchedulerDecisionSchema,
  StepAttempt,
  StepAttemptSchema,
} from "@kiwi/contracts";
import { resolveRunArtifactPath } from "../store.js";
import { readJson } from "../../storage/json-io.js";

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
  schedulerDecisionRef?: string;
  schedulerDecision?: SchedulerDecision;
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

  if (!existsSync(target)) {
    return { gateResults: [] };
  }

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

  if (!existsSync(target)) {
    return {};
  }

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

  if (!existsSync(target)) {
    return {};
  }
  try {
    return {
      ref,
      summary: AttemptSummarySchema.parse(readJson(target)),
    };
  } catch {
    return { ref };
  }
}

function tryReadSchedulerDecision(
  cwd: string,
  runId: string,
  stepId: string,
  attemptId: string,
): {
  ref?: string;
  schedulerDecision?: SchedulerDecision;
} {
  const ref = `steps/${stepId}/${attemptId}/scheduler-decision.json`;
  const target = resolveRunArtifactPath(runId, ref, cwd);

  if (!existsSync(target)) {
    return {};
  }
  try {
    return {
      ref,
      schedulerDecision: SchedulerDecisionSchema.parse(readJson(target)),
    };
  } catch {
    return { ref };
  }
}

function attemptEvidence(
  cwd: string,
  runId: string,
  stepId: string,
  attemptId: string,
  attemptPath: string,
): StepAttemptEvidence {
  const attempt = StepAttemptSchema.parse(readJson(attemptPath));
  const gateEvidence = tryReadGateResults(cwd, runId, stepId, attemptId);
  const reviewEvidence = tryReadReview(cwd, runId, stepId, attemptId);
  const summaryEvidence = tryReadAttemptSummary(cwd, runId, stepId, attemptId);
  const schedulerEvidence = tryReadSchedulerDecision(cwd, runId, stepId, attemptId);
  const entry: StepAttemptEvidence = {
    stepId,
    attemptId,
    attempt,
    gateResults: gateEvidence.gateResults,
  };

  if (gateEvidence.ref) {
    entry.gateResultsRef = gateEvidence.ref;
  }
  if (reviewEvidence.ref) {
    entry.reviewReportRef = reviewEvidence.ref;
  }
  if (reviewEvidence.reviewVerdict) {
    entry.reviewVerdict = reviewEvidence.reviewVerdict;
  }
  if (summaryEvidence.ref) {
    entry.summaryRef = summaryEvidence.ref;
  }
  if (summaryEvidence.summary) {
    entry.summary = summaryEvidence.summary;
  }
  if (schedulerEvidence.ref) {
    entry.schedulerDecisionRef = schedulerEvidence.ref;
  }
  if (schedulerEvidence.schedulerDecision) {
    entry.schedulerDecision = schedulerEvidence.schedulerDecision;
  }

  return entry;
}

function stepAttemptEvidence(cwd: string, runId: string, stepId: string, stepPath: string): StepAttemptEvidence[] {
  const entries: StepAttemptEvidence[] = [];

  for (const attemptEntry of readdirSync(stepPath, { withFileTypes: true })) {
    if (!attemptEntry.isDirectory()) {
      continue;
    }
    const attemptId = attemptEntry.name;
    const attemptPath = path.join(stepPath, attemptId, "attempt.json");

    if (existsSync(attemptPath)) {
      entries.push(attemptEvidence(cwd, runId, stepId, attemptId, attemptPath));
    }
  }

  return entries;
}

export function listStepAttemptEvidence(cwd: string, runId: string): StepAttemptEvidence[] {
  const stepsRoot = resolveRunArtifactPath(runId, "steps", cwd);

  if (!existsSync(stepsRoot)) {
    return [];
  }

  const entries = readdirSync(stepsRoot, { withFileTypes: true }).flatMap((stepEntry) => {
    if (!stepEntry.isDirectory()) {
      return [];
    }

    return stepAttemptEvidence(cwd, runId, stepEntry.name, path.join(stepsRoot, stepEntry.name));
  });

  return entries.sort((a, b) => a.attempt.startedAt.localeCompare(b.attempt.startedAt));
}

export function latestAttemptByStep(attempts: StepAttemptEvidence[]): Map<string, StepAttemptEvidence> {
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
  if (params.dependsOn.length === 0) {
    return;
  }

  const latest = latestAttemptByStep(listStepAttemptEvidence(params.cwd, params.runId));
  const incomplete = params.dependsOn.filter((stepId) => {
    const attempt = latest.get(stepId);

    return attempt?.attempt.status !== ContractValues.Completed;
  });

  if (incomplete.length > 0) {
    throw new Error(`Cannot execute ${params.stepId} before dependencies complete: ${incomplete.join(", ")}`);
  }
}
