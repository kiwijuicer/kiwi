import type { Artifact, GateResult, ReviewVerdict, StepAttemptStatus } from "@kiwi/contracts";
import type { StepAttemptNextAction, StepRunnerExecutionError, StepRunnerExecutionStatus } from "../step-runner-types";

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
