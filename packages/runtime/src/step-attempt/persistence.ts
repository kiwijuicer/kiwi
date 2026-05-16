import {
  Artifact,
  ArtifactSchema,
  ContractValues,
  StepAttempt,
  StepAttemptSchema,
  StepAttemptStatus,
} from "@kiwi/contracts";
import {
  artifact,
  dedupeArtifacts,
  loadStepAttempt,
  saveAttemptSummary,
  saveStepAttempt,
} from "../step-attempt-artifacts";
import type { StepAttemptNextAction, StepRunnerExecutionOutput } from "../step-runner-types";

export function markAttemptRunning(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
}): StepAttempt {
  const existingAttempt = loadStepAttempt(params);
  saveStepAttempt({
    cwd: params.cwd,
    runId: params.runId,
    attempt: StepAttemptSchema.parse({
      ...existingAttempt,
      status: ContractValues.Running,
      modelInvocationRefs: existingAttempt.modelInvocationRefs,
      completedAt: null,
    }),
  });

  return existingAttempt;
}

export function persistAttemptCompletion(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  existingAttempt: StepAttempt;
  status: StepAttemptStatus;
  runnerOutput: StepRunnerExecutionOutput;
  additionalArtifacts: Artifact[];
  postRunnerArtifacts: Artifact[];
  reviewReportRef: string;
  costReportRef: string;
  gateResultsRef: string;
  modelInvocationRefs: string[];
  nextAction: StepAttemptNextAction;
  completedAt: string;
}): { artifacts: Artifact[]; attemptRef: string } {
  const artifactsWithoutSummary = dedupeArtifacts([
    ...params.runnerOutput.artifactRefs,
    ...params.additionalArtifacts.map((entry) => ArtifactSchema.parse(entry)),
    ...params.postRunnerArtifacts.map((entry) => ArtifactSchema.parse(entry)),
    artifact({ type: "review_report", ref: params.reviewReportRef, createdAt: params.completedAt }),
    artifact({ type: "cost_report", ref: params.costReportRef, createdAt: params.completedAt }),
  ]);
  const summaryRef = saveAttemptSummary({
    cwd: params.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    summary: {
      schemaVersion: "1",
      runId: params.runId,
      stepId: params.stepId,
      attemptId: params.attemptId,
      status: params.status,
      runnerStatus: params.runnerOutput.status,
      nextAction: params.nextAction,
      gateResultsRef: params.gateResultsRef,
      reviewReportRef: params.reviewReportRef,
      costReportRef: params.costReportRef,
      modelInvocationRefs: params.modelInvocationRefs,
      artifactRefs: artifactsWithoutSummary.map((entry) => entry.ref),
      completedAt: params.completedAt,
      ...(params.runnerOutput.error ? { error: params.runnerOutput.error } : {}),
    },
  });
  const artifacts = dedupeArtifacts([
    ...artifactsWithoutSummary,
    artifact({ type: "summary", ref: summaryRef, createdAt: params.completedAt }),
  ]);
  const attemptRef = saveStepAttempt({
    cwd: params.cwd,
    runId: params.runId,
    attempt: StepAttemptSchema.parse({
      ...params.existingAttempt,
      status: params.status,
      modelInvocationRefs: params.modelInvocationRefs,
      artifacts,
      completedAt: params.completedAt,
    }),
  });

  return { artifacts, attemptRef };
}

export function markAttemptFailed(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  existingAttempt: StepAttempt;
  artifacts?: Artifact[];
  completedAt: string;
}): string {
  return saveStepAttempt({
    cwd: params.cwd,
    runId: params.runId,
    attempt: StepAttemptSchema.parse({
      ...params.existingAttempt,
      status: ContractValues.Failed,
      artifacts: dedupeArtifacts([...params.existingAttempt.artifacts, ...(params.artifacts ?? [])]),
      modelInvocationRefs: params.existingAttempt.modelInvocationRefs,
      completedAt: params.completedAt,
    }),
  });
}
