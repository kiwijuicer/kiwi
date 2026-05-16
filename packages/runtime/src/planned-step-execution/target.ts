import { ExecutionIsolations } from "@kiwi/contracts";
import { createGitTreeSnapshot, createWorktreeSandbox, teardownWorktreeSandbox } from "@kiwi/sandbox";
import type { ExecutionMode, ExecutionTarget } from "./types";

export class ExecutionTargetResolver {
  create(params: {
    cwd: string;
    runId: string;
    attemptId: string;
    repoPath: string;
    mode: ExecutionMode;
  }): ExecutionTarget {
    if (params.mode === ExecutionIsolations.Worktree) {
      const sandbox = createWorktreeSandbox({
        cwd: params.cwd,
        runId: params.runId,
        attemptId: params.attemptId,
        sourcePath: params.repoPath,
      });

      return {
        mode: params.mode,
        runId: params.runId,
        attemptId: params.attemptId,
        worktreePath: sandbox.worktreePath,
        sourcePath: sandbox.sourcePath,
        isolation: sandbox.isolation,
        diffBaseTree: null,
      };
    }

    return {
      mode: params.mode,
      runId: params.runId,
      attemptId: params.attemptId,
      worktreePath: params.repoPath,
      sourcePath: params.repoPath,
      isolation: ExecutionIsolations.Direct,
      diffBaseTree: createGitTreeSnapshot(params.repoPath),
    };
  }

  teardown(params: { cwd: string; target: ExecutionTarget }): void {
    if (params.target.isolation === ExecutionIsolations.Direct) {
      return;
    }
    teardownWorktreeSandbox({
      cwd: params.cwd,
      runId: params.target.runId,
      attemptId: params.target.attemptId,
      sourcePath: params.target.sourcePath,
      isolation: params.target.isolation,
      worktreePath: params.target.worktreePath,
    });
  }
}
