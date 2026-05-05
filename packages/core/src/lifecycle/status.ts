import { ContractValues, RunManifest, RunManifestSchema, RunStatus } from "@kiwi/contracts";
import { appendAuditEvent } from "../cost-ledger";
import { loadRunManifest, loadTaskGraph, resolveRunArtifactPath } from "../run-store";
import { listStepAttemptEvidence } from "./evidence-collection";
import { writeJsonSafely } from "./files";

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
