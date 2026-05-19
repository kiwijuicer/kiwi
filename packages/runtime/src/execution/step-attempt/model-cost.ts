import { AgentRole, ContractValues, ModelCapability, RunnerName } from "@kiwi/contracts";
import { appendModelInvocation } from "@kiwi/core";
import type { ReviewExecutionMetadata } from "../../review/review-engine.js";
import { saveRunnerCostReport } from "../step-attempt-artifacts.js";
import type { StepRunnerExecutionOutput } from "../step-runner-types.js";

export function recordAttemptModelCost(params: {
  cwd: string;
  runId: string;
  stepId: string;
  attemptId: string;
  runner: RunnerName;
  agentRole: AgentRole;
  requestedCapability: ModelCapability;
  modelCapability: ModelCapability;
  reviewDepth: ModelCapability;
  runnerOutput: StepRunnerExecutionOutput;
  reviewMetadata: ReviewExecutionMetadata;
  reviewInvocationStatus?:
    | typeof ContractValues.Completed
    | typeof ContractValues.Failed
    | typeof ContractValues.Blocked;
  gateResultsRef: string;
  reviewReportRef: string;
  startedAt: string;
  reviewStartedAt: string;
  completedAt: string;
}): { modelInvocationRefs: string[]; costReportRef: string } {
  const runnerInvocationRef = appendModelInvocation(params.cwd, {
    schemaVersion: "1",
    runId: params.runId,
    phase: ContractValues.Executor,
    stepId: params.stepId,
    attemptId: params.attemptId,
    agentRole: params.agentRole,
    requestedCapability: params.requestedCapability,
    selectedCapability: params.modelCapability,
    modelId: params.runnerOutput.modelId ?? null,
    providerName: params.runnerOutput.providerName ?? ContractValues.Local,
    runner: params.runner,
    accessMode: params.runnerOutput.accessMode ?? null,
    usage: params.runnerOutput.modelUsage,
    usagePrecision: params.runnerOutput.usagePrecision ?? "unknown",
    estimatedCostUsd: params.runnerOutput.estimatedCostUsd ?? null,
    status: invocationStatus(params.runnerOutput.status),
    evidenceRefs: params.runnerOutput.artifactRefs.map((entry) => entry.ref),
    startedAt: params.startedAt,
    completedAt: params.completedAt,
  });
  const reviewerInvocationRef = appendModelInvocation(params.cwd, {
    schemaVersion: "1",
    runId: params.runId,
    phase: ContractValues.Reviewer,
    stepId: params.stepId,
    attemptId: params.attemptId,
    agentRole: ContractValues.Reviewer,
    requestedCapability: params.reviewMetadata.requestedCapability ?? params.reviewDepth,
    selectedCapability: params.reviewMetadata.selectedCapability ?? params.reviewDepth,
    modelId: params.reviewMetadata.modelId,
    providerName: params.reviewMetadata.providerName,
    runner: null,
    accessMode: params.reviewMetadata.accessMode ?? null,
    usage: params.reviewMetadata.modelUsage,
    usagePrecision: "estimated",
    estimatedCostUsd: params.reviewMetadata.estimatedCostUsd,
    status: params.reviewInvocationStatus ?? ContractValues.Completed,
    evidenceRefs: [params.gateResultsRef, params.reviewReportRef],
    startedAt: params.reviewStartedAt,
    completedAt: params.completedAt,
  });
  const modelInvocationRefs = [runnerInvocationRef, reviewerInvocationRef];
  const costReportRef = saveRunnerCostReport({
    cwd: params.cwd,
    runId: params.runId,
    stepId: params.stepId,
    attemptId: params.attemptId,
    runner: params.runner,
    modelId: params.runnerOutput.modelId ?? null,
    providerName: params.runnerOutput.providerName ?? ContractValues.Local,
    agentRole: params.agentRole,
    modelCapability: params.modelCapability,
    reviewDepth: params.reviewDepth,
    modelInvocationRefs,
    modelUsage: params.runnerOutput.modelUsage,
    usagePrecision: params.runnerOutput.usagePrecision ?? "unknown",
    estimatedCostUsd: params.runnerOutput.estimatedCostUsd ?? null,
    createdAt: params.completedAt,
  });

  return { modelInvocationRefs, costReportRef };
}

function invocationStatus(
  status: StepRunnerExecutionOutput["status"],
): typeof ContractValues.Completed | typeof ContractValues.Blocked | typeof ContractValues.Failed {
  if (status === ContractValues.Completed) {
    return ContractValues.Completed;
  }
  if (status === ContractValues.Blocked || status === "approval_required") {
    return ContractValues.Blocked;
  }

  return ContractValues.Failed;
}
