import { appendAuditEvent, resolveRunArtifactPath } from "@kiwi/core";
import { ArtifactTypes, ContractValues, ExecutionIsolations } from "@kiwi/contracts";
import { AttemptDiffStatuses, type AttemptDiffMaterialization, type StepAttemptExecutionResult } from "./types";

export class AttemptDiffMaterializer {
  materialize(params: {
    cwd: string;
    runId: string;
    stepId: string;
    attemptId: string;
    repoPath: string;
    directExecution: boolean;
    result: StepAttemptExecutionResult;
  }): AttemptDiffMaterialization {
    if (params.result.runnerStatus !== ContractValues.Completed) {
      return { status: AttemptDiffStatuses.Skipped, reason: `runner status is ${params.result.runnerStatus}` };
    }

    const diffArtifact = params.result.artifactRefs.find((artifact) => artifact.type === ArtifactTypes.Diff);

    if (!diffArtifact) {
      return { status: AttemptDiffStatuses.Skipped, reason: "attempt produced no diff artifact" };
    }

    if (params.directExecution) {
      appendAuditEvent(params.cwd, {
        eventType: "attempt_diff_applied",
        runId: params.runId,
        timestamp: new Date().toISOString(),
        payload: {
          stepId: params.stepId,
          attemptId: params.attemptId,
          diffRef: diffArtifact.ref,
          targetPath: params.repoPath,
          mode: ExecutionIsolations.Direct,
        },
      });

      return {
        status: AttemptDiffStatuses.Applied,
        diffRef: diffArtifact.ref,
        patchPath: resolveRunArtifactPath(params.runId, diffArtifact.ref, params.cwd),
        targetPath: params.repoPath,
      };
    }

    return {
      status: AttemptDiffStatuses.Skipped,
      reason: `diff persisted for review: ${diffArtifact.ref}`,
    };
  }
}
