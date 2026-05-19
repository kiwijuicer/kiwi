import { captureDiffArtifact } from "@kiwi/sandbox";
import type { Artifact } from "@kiwi/contracts";
import type { RunnerExecutionInput } from "./adapter.js";

export function captureRunnerDiffArtifact(input: RunnerExecutionInput): Artifact | null {
  const diffInput: Parameters<typeof captureDiffArtifact>[0] = {
    cwd: input.workspacePath,
    runId: input.runId,
    stepId: input.stepId,
    attemptId: input.attemptId,
    worktreePath: input.worktreePath,
  };

  if (input.repoPath) {
    diffInput.sourcePath = input.repoPath;
  }
  if (input.diffBaseTree !== undefined) {
    diffInput.baseTree = input.diffBaseTree;
  }

  return captureDiffArtifact(diffInput);
}
