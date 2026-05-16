import { appendAuditEvent, resolveRunArtifactPath } from "@kiwi/core";
import { ArtifactTypes, ContractValues } from "@kiwi/contracts";
import type { AttemptDiffMaterialization, StepAttemptExecutionResult } from "./types";

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
      return { status: "skipped", reason: `runner status is ${params.result.runnerStatus}` };
    }

    const diffArtifact = params.result.artifactRefs.find((artifact) => artifact.type === ArtifactTypes.Diff);

    if (!diffArtifact) {
      return { status: "skipped", reason: "attempt produced no diff artifact" };
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
          mode: "direct",
        },
      });

      return {
        status: "applied",
        diffRef: diffArtifact.ref,
        patchPath: resolveRunArtifactPath(params.runId, diffArtifact.ref, params.cwd),
        targetPath: params.repoPath,
      };
    }

    return {
      status: "skipped",
      reason: `diff persisted for review: ${diffArtifact.ref}`,
    };
  }
}
