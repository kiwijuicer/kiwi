import { ContractValues, GateResult, ReviewVerdict, StepAttemptStatus } from "@kiwi/contracts";
import { appendAuditEvent } from "@kiwi/core";
import type { StepAttemptNextAction, StepRunnerExecutionOutput } from "../step-runner-types";

export function auditStepAttemptStarted(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  runner: string;
  startedAt: string;
}): void {
  appendAuditEvent(params.cwd, {
    eventType: "step_attempt_started",
    runId: params.runId,
    timestamp: params.startedAt,
    payload: {
      stepId: params.stepId,
      attemptId: params.attemptId,
      runner: params.runner,
    },
  });
}

export function auditDiffGatesExecuted(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  diffHash: string | null;
  gateResults: GateResult[];
}): void {
  if (params.gateResults.length === 0) {
    return;
  }
  appendAuditEvent(params.cwd, {
    eventType: "gate_command_executed",
    runId: params.runId,
    timestamp: new Date().toISOString(),
    payload: {
      stepId: params.stepId,
      attemptId: params.attemptId,
      diffHash: params.diffHash,
      gates: params.gateResults.map((entry) => ({ gateId: entry.gateId, status: entry.status })),
    },
  });
}

export function auditAttemptFinished(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  runner: string;
  runnerOutput: StepRunnerExecutionOutput;
  reviewVerdict: ReviewVerdict;
  reviewReportRef: string;
  gateResultsRef: string;
  nextAction: StepAttemptNextAction;
  status: StepAttemptStatus;
  completedAt: string;
}): void {
  appendAuditEvent(params.cwd, {
    eventType:
      params.runnerOutput.status === ContractValues.Completed ? "runner_attempt_completed" : "runner_attempt_failed",
    runId: params.runId,
    timestamp: params.completedAt,
    payload: {
      stepId: params.stepId,
      attemptId: params.attemptId,
      runner: params.runner,
      runnerStatus: params.runnerOutput.status,
      artifactRefs: params.runnerOutput.artifactRefs.map((entry) => entry.ref),
    },
  });
  appendAuditEvent(params.cwd, {
    eventType: "step_attempt_reviewed",
    runId: params.runId,
    timestamp: params.completedAt,
    payload: {
      stepId: params.stepId,
      attemptId: params.attemptId,
      verdict: params.reviewVerdict.verdict,
      safeToContinue: params.reviewVerdict.safeToContinue,
      reviewReportRef: params.reviewReportRef,
      gateResultsRef: params.gateResultsRef,
    },
  });
  appendAuditEvent(params.cwd, {
    eventType: "step_attempt_next_action",
    runId: params.runId,
    timestamp: params.completedAt,
    payload: {
      stepId: params.stepId,
      attemptId: params.attemptId,
      action: params.nextAction.type,
      status: params.status,
    },
  });
}
